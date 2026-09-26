import { GOOGLE_ADS_API_VERSION_DEFAULT, googleAccessToken } from "../connectors/ads";
import type { ConnectionLike } from "../connectors/types";
import { sha256 } from "../crypto";
import { toDecimalString } from "../money";
import type { Built, ConversionContext, FetchLike, SendOutcome, UploadConversionType } from "./types";

// Google Ads offline click conversions + enhanced conversions for leads:
// POST https://googleads.googleapis.com/{version}/customers/{customerId}:uploadClickConversions
// https://developers.google.com/google-ads/api/docs/conversions/upload-clicks

export const GOOGLE_BATCH_SIZE = 200; // the API accepts up to 2,000 per request
export const GOOGLE_CLICK_MAX_AGE_MS = 90 * 24 * 3_600_000; // clicks older than 90 days can't be uploaded

export type GoogleUploadConfig = {
  customerId: string;
  loginCustomerId: string | null;
  version: string;
  actions: Partial<Record<UploadConversionType, string>>; // conversion action resource names
};

export type GoogleClickConversion = {
  conversionAction: string;
  conversionDateTime: string;
  orderId: string;
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  conversionValue?: number;
  currencyCode?: string;
  userIdentifiers?: { hashedEmail: string; userIdentifierSource: "FIRST_PARTY" }[];
};

const digits = (s: string) => s.replace(/\D/g, "");
const on = (v: string | undefined) => v === "on" || v === "true";

/** Accepts a numeric id or a full `customers/…/conversionActions/…` resource name. */
export function conversionActionResource(customerId: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^customers\/\d+\/conversionActions\/\d+$/.test(v)) return v;
  const id = digits(v);
  return id ? `customers/${customerId}/conversionActions/${id}` : null;
}

/** Upload settings from the Google Ads connection, or null when uploads are off / incomplete. */
export function googleUploadConfig(conn: ConnectionLike): GoogleUploadConfig | null {
  if (!on(conn.config.conversionUploads)) return null;
  const customerId = digits(conn.config.uploadCustomerId || (conn.config.customerIds ?? "").split(/[\s,]+/).find(Boolean) || "");
  if (!customerId) return null;
  const actions: GoogleUploadConfig["actions"] = {};
  const lead = conversionActionResource(customerId, conn.config.leadConversionActionId ?? "");
  const purchase = conversionActionResource(customerId, conn.config.purchaseConversionActionId ?? "");
  if (lead) actions.lead = lead;
  if (purchase) actions.purchase = purchase;
  if (!actions.lead && !actions.purchase) return null;
  return {
    customerId,
    loginCustomerId: digits(conn.config.loginCustomerId ?? "") || null,
    version: conn.config.apiVersion?.trim() || GOOGLE_ADS_API_VERSION_DEFAULT,
    actions,
  };
}

/**
 * Google's email normalization for enhanced conversions: trim, lowercase and, for
 * gmail.com / googlemail.com, drop the dots in the local part.
 */
export function normalizeGoogleEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  return domain === "gmail.com" || domain === "googlemail.com" ? `${local.replace(/\./g, "")}@${domain}` : e;
}

/** "yyyy-mm-dd hh:mm:ss+00:00" in UTC. */
export function googleDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace("T", " ")}+00:00`;
}

export function buildGoogleConversion(c: ConversionContext, cfg: GoogleUploadConfig): Built<GoogleClickConversion> {
  const action = cfg.actions[c.type];
  if (!action) return { skip: `No ${c.type} conversion action configured` };
  const conv: GoogleClickConversion = {
    conversionAction: action,
    conversionDateTime: googleDateTime(c.occurredAt),
    // Order id de-duplicates re-uploads of the same conversion on Google's side.
    orderId: c.id,
  };
  if (c.googleClick) {
    conv[c.googleClick.type] = c.googleClick.id;
  } else if (c.type === "lead" && c.email) {
    // Enhanced conversions for leads: no click id, match on the hashed email.
    conv.userIdentifiers = [{ hashedEmail: sha256(normalizeGoogleEmail(c.email)), userIdentifierSource: "FIRST_PARTY" }];
  } else {
    return { skip: c.type === "lead" ? "No Google click ID or email" : "No Google click ID (gclid/gbraid/wbraid)" };
  }
  if (c.type === "purchase") {
    if (c.amountMinor == null || !c.currency || c.amountMinor <= 0) return { skip: "Purchase has no positive amount" };
    conv.conversionValue = Number(toDecimalString(c.amountMinor, c.currency));
    conv.currencyCode = c.currency.toUpperCase();
  }
  return { payload: conv };
}

type GoogleFailure = {
  errors?: {
    errorCode?: Record<string, string>;
    message?: string;
    location?: { fieldPathElements?: { fieldName?: string; index?: number }[] };
  }[];
};

// Per-conversion errors that can succeed later (Google hasn't processed the click / action yet).
const RETRYABLE_ITEM_ERRORS = new Set(["CLICK_NOT_FOUND", "TOO_RECENT_CONVERSION_ACTION", "TOO_RECENT_EVENT", "RESOURCE_TEMPORARILY_EXHAUSTED"]);

/** Map `partialFailureError` details to per-conversion outcomes (index -> error). */
export function parseGooglePartialFailure(body: unknown): Map<number, { retryable: boolean; error: string }> {
  const out = new Map<number, { retryable: boolean; error: string }>();
  const details = ((body as { partialFailureError?: { details?: GoogleFailure[] } })?.partialFailureError?.details ?? []) as GoogleFailure[];
  for (const d of details) {
    for (const e of d.errors ?? []) {
      const idx = e.location?.fieldPathElements?.find((p) => p.fieldName === "conversions")?.index;
      if (typeof idx !== "number" || out.has(idx)) continue;
      const code = Object.values(e.errorCode ?? {})[0] ?? "UNKNOWN";
      out.set(idx, { retryable: RETRYABLE_ITEM_ERRORS.has(code), error: `Google Ads: ${code}${e.message ? ` — ${e.message}` : ""}`.slice(0, 300) });
    }
  }
  return out;
}

/** Classify one uploadClickConversions response into per-conversion outcomes. */
export function classifyGoogleResponse(status: number, body: unknown, count: number): SendOutcome[] {
  if (status >= 200 && status < 300) {
    const failures = parseGooglePartialFailure(body);
    const whole = (body as { partialFailureError?: { message?: string } })?.partialFailureError;
    return Array.from({ length: count }, (_, i) => {
      const f = failures.get(i);
      if (f) return { ok: false as const, ...f };
      // A partial-failure error we couldn't map to an index: retry rather than claim success.
      if (whole && failures.size === 0) return { ok: false as const, retryable: true, error: `Google Ads: ${(whole.message ?? "partial failure").slice(0, 300)}` };
      return { ok: true as const };
    });
  }
  const b = (Array.isArray(body) ? body[0] : body) as { error?: { message?: string } } | null;
  // Request-level errors are configuration or availability problems; retry (bounded) so a fix applies.
  const error = `Google Ads API error (${status}): ${(b?.error?.message ?? "unknown error").slice(0, 300)}`;
  return Array.from({ length: count }, () => ({ ok: false as const, retryable: true, error }));
}

export async function sendGoogleConversions(
  conn: ConnectionLike,
  cfg: GoogleUploadConfig,
  conversions: GoogleClickConversion[],
  fetchImpl: FetchLike = fetch,
  accessToken: (c: ConnectionLike) => Promise<string> = googleAccessToken,
): Promise<SendOutcome[]> {
  const devToken = conn.secrets.developerToken;
  const all = (error: string, retryable = true): SendOutcome[] => conversions.map(() => ({ ok: false, retryable, error }));
  if (!devToken) return all("Google Ads developer token is missing");
  let token: string;
  try {
    token = await accessToken(conn);
  } catch (err) {
    return all(err instanceof Error ? err.message.slice(0, 300) : "Google OAuth error");
  }
  const out: SendOutcome[] = [];
  for (let i = 0; i < conversions.length; i += GOOGLE_BATCH_SIZE) {
    const batch = conversions.slice(i, i + GOOGLE_BATCH_SIZE);
    try {
      const res = await fetchImpl(`https://googleads.googleapis.com/${cfg.version}/customers/${cfg.customerId}:uploadClickConversions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "developer-token": devToken,
          "Content-Type": "application/json",
          ...(cfg.loginCustomerId ? { "login-customer-id": cfg.loginCustomerId } : {}),
        },
        body: JSON.stringify({ conversions: batch, partialFailure: true }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json().catch(() => null);
      out.push(...classifyGoogleResponse(res.status, body, batch.length));
    } catch (err) {
      const error = `Google Ads request failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300);
      out.push(...batch.map(() => ({ ok: false as const, retryable: true, error })));
    }
  }
  return out;
}
