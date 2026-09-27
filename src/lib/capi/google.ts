import { randomUUID } from "node:crypto";
import { googleAccessToken } from "../connectors/ads";
import type { ConnectionLike } from "../connectors/types";
import { sha256 } from "../crypto";
import { toDecimalString } from "../money";
import { googleConsent, type GoogleConsent } from "./consent";
import type { Built, ConversionContext, FetchLike, SendOutcome, UploadConversionType } from "./types";

// Google Ads offline click conversions + enhanced conversions for leads, via the Data Manager API:
//   POST https://datamanager.googleapis.com/v1/events:ingest   (OAuth scope .../auth/datamanager)
//   https://developers.google.com/data-manager/api/devguides/events/google-ads/offline/send-events
//
// Since 15 June 2026 the Google Ads API's ConversionUploadService.UploadClickConversions rejects
// developer tokens that hadn't uploaded offline conversions before (CUSTOMER_NOT_ALLOWLISTED_FOR_
// THIS_FEATURE), so new installs must use the Data Manager API. It needs no developer token; the
// conversion account and manager account travel in `destinations`. It is fast-fail: one invalid
// event rejects the whole request, so a rejected batch is re-sent without the events Google named.

export const DATA_MANAGER_INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";
export const DATA_MANAGER_SCOPE = "https://www.googleapis.com/auth/datamanager";
export const GOOGLE_BATCH_SIZE = 2000; // "At most 2000 Event resources can be sent in a single request."
export const GOOGLE_CLICK_MAX_AGE_MS = 90 * 24 * 3_600_000; // clicks older than 90 days can't be uploaded

export type GoogleUploadConfig = {
  customerId: string; // operating account: owns the conversion actions
  loginCustomerId: string | null; // manager account used to reach it, if any
  actions: Partial<Record<UploadConversionType, string>>; // numeric conversion action IDs
};

/** One Data Manager `Event`. `destinationReferences` points at the conversion action's destination. */
export type GoogleEvent = {
  destinationReferences: UploadConversionType[];
  transactionId: string;
  eventTimestamp: string; // RFC 3339
  eventSource: "WEB";
  adIdentifiers?: { gclid?: string; gbraid?: string; wbraid?: string };
  userData?: { userIdentifiers: { emailAddress: string }[] };
  conversionValue?: number;
  currency?: string;
  consent: GoogleConsent;
};

export type GoogleDestination = {
  reference: UploadConversionType;
  operatingAccount: { accountType: "GOOGLE_ADS"; accountId: string };
  loginAccount?: { accountType: "GOOGLE_ADS"; accountId: string };
  productDestinationId: string;
};

export type GoogleIngestRequest = {
  destinations: GoogleDestination[];
  encoding: "HEX";
  events: GoogleEvent[];
};

const digits = (s: string) => s.replace(/\D/g, "");
const on = (v: string | undefined) => v === "on" || v === "true";

/** Accepts a numeric conversion action ID or a `customers/…/conversionActions/…` resource name. */
export function conversionActionId(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const m = /conversionActions\/(\d+)$/.exec(v);
  const id = m ? m[1] : digits(v);
  return id || null;
}

/** Upload settings from the Google Ads connection, or null when uploads are off / incomplete. */
export function googleUploadConfig(conn: ConnectionLike): GoogleUploadConfig | null {
  if (!on(conn.config.conversionUploads)) return null;
  const customerId = digits(conn.config.uploadCustomerId || (conn.config.customerIds ?? "").split(/[\s,]+/).find(Boolean) || "");
  if (!customerId) return null;
  const actions: GoogleUploadConfig["actions"] = {};
  const lead = conversionActionId(conn.config.leadConversionActionId ?? "");
  const purchase = conversionActionId(conn.config.purchaseConversionActionId ?? "");
  if (lead) actions.lead = lead;
  if (purchase) actions.purchase = purchase;
  if (!actions.lead && !actions.purchase) return null;
  return { customerId, loginCustomerId: digits(conn.config.loginCustomerId ?? "") || null, actions };
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

/**
 * One Data Manager event. `consent` is the upload's consent basis (see consent.ts): "limited"
 * (Global Privacy Control) sends both consent fields DENIED and never any user identifiers,
 * so only a Google click ID can carry the conversion.
 */
export function buildGoogleConversion(
  c: ConversionContext,
  cfg: GoogleUploadConfig,
  consent: "granted" | "implied" | "limited" = "implied",
): Built<GoogleEvent> {
  if (!cfg.actions[c.type]) return { skip: `No ${c.type} conversion action configured`, reason: "no_action" };
  const ev: GoogleEvent = {
    destinationReferences: [c.type],
    // Transaction id de-duplicates re-uploads: Google treats a repeat as an adjustment, not a new conversion.
    transactionId: c.id,
    eventTimestamp: c.occurredAt.toISOString(),
    eventSource: "WEB",
    consent: googleConsent(consent),
  };
  if (c.googleClick) {
    ev.adIdentifiers = { [c.googleClick.type]: c.googleClick.id };
  } else if (consent === "limited") {
    return { skip: "Privacy signal (GPC) and no Google click ID", reason: "limited_no_click_id" };
  } else if (c.type === "lead" && c.email) {
    // Enhanced conversions for leads: no click id, match on the hashed email (hex SHA-256).
    ev.userData = { userIdentifiers: [{ emailAddress: sha256(normalizeGoogleEmail(c.email)) }] };
  } else {
    return { skip: c.type === "lead" ? "No Google click ID or email" : "No Google click ID (gclid/gbraid/wbraid)", reason: "no_match_keys" };
  }
  if (c.type === "purchase") {
    if (c.amountMinor == null || !c.currency || c.amountMinor <= 0) return { skip: "Purchase has no positive amount", reason: "no_value" };
    ev.conversionValue = Number(toDecimalString(c.amountMinor, c.currency));
    ev.currency = c.currency.toUpperCase();
  }
  return { payload: ev };
}

/** The ingest request for one batch: one destination per conversion action the batch uses. */
export function googleIngestRequest(cfg: GoogleUploadConfig, events: GoogleEvent[]): GoogleIngestRequest {
  const used = new Set(events.flatMap((e) => e.destinationReferences));
  const destinations: GoogleDestination[] = [];
  for (const type of ["lead", "purchase"] as const) {
    const action = cfg.actions[type];
    if (!action || !used.has(type)) continue;
    destinations.push({
      reference: type,
      operatingAccount: { accountType: "GOOGLE_ADS", accountId: cfg.customerId },
      ...(cfg.loginCustomerId && cfg.loginCustomerId !== cfg.customerId ? { loginAccount: { accountType: "GOOGLE_ADS" as const, accountId: cfg.loginCustomerId } } : {}),
      productDestinationId: action,
    });
  }
  return { destinations, encoding: "HEX", events };
}

type RpcDetail = { "@type"?: string; reason?: string; metadata?: Record<string, string>; fieldViolations?: { field?: string; description?: string; reason?: string }[] };
type RpcError = { error?: { code?: number; message?: string; status?: string; details?: RpcDetail[] } };

// Canonical codes worth retrying (Google's guidance) plus quota exhaustion.
const RETRYABLE_STATUS = new Set(["UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL", "UNKNOWN", "ABORTED", "RESOURCE_EXHAUSTED"]);

/** Event indexes Google blamed in a fast-fail error (`events[3].ad_identifiers.gclid` -> 3). */
export function googleEventViolations(body: unknown): Map<number, string> {
  const out = new Map<number, string>();
  for (const d of (body as RpcError)?.error?.details ?? []) {
    for (const v of d.fieldViolations ?? []) {
      const m = /^events\[(\d+)\]/.exec(v.field ?? "");
      if (!m || out.has(Number(m[1]))) continue;
      out.set(Number(m[1]), `${v.reason ?? "INVALID_ARGUMENT"}${v.description ? ` — ${v.description}` : ""}`);
    }
  }
  return out;
}

/** A request-level error as one readable, token-free message (with a fix hint for setup problems). */
export function googleRequestError(status: number, body: unknown): { retryable: boolean; error: string } {
  const e = (body as RpcError)?.error;
  const reasons = (e?.details ?? []).map((d) => d.reason).filter(Boolean) as string[];
  const canonical = e?.status ?? "";
  let hint = "";
  if (reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) hint = " Reconnect Google Ads so AdLedger gets the Data Manager permission.";
  else if (reasons.includes("SERVICE_DISABLED")) hint = " Enable the Data Manager API in your Google Cloud project.";
  else if (canonical === "PERMISSION_DENIED") hint = " The signed-in Google user needs access to the conversion account.";
  // Setup problems (auth, scope, disabled API, access) are retried a bounded number of times so a fix
  // applies to what's queued; invalid requests are not.
  const retryable = status === 429 || status >= 500 || RETRYABLE_STATUS.has(canonical) || status === 401 || status === 403;
  const msg = `${(e?.message ?? "unknown error").slice(0, 200)}${reasons.length ? ` (${reasons.join(", ")})` : ""}`;
  return { retryable, error: `Google Data Manager API error (${status}): ${msg}${hint}`.slice(0, 300) };
}

async function ingest(fetchImpl: FetchLike, token: string, request: GoogleIngestRequest): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(DATA_MANAGER_INGEST_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/**
 * Send one batch. On a fast-fail 400 that names specific events, those events fail permanently
 * and the rest are re-sent once, so one bad click ID never blocks the others.
 */
async function sendBatch(fetchImpl: FetchLike, token: string, cfg: GoogleUploadConfig, events: GoogleEvent[]): Promise<SendOutcome[]> {
  const all = (o: SendOutcome) => events.map(() => o);
  try {
    const first = await ingest(fetchImpl, token, googleIngestRequest(cfg, events));
    if (first.status >= 200 && first.status < 300) return all({ ok: true });
    const bad = first.status === 400 ? googleEventViolations(first.body) : new Map<number, string>();
    if (!bad.size) return all({ ok: false, ...googleRequestError(first.status, first.body) });
    const out: SendOutcome[] = events.map((_, i) =>
      bad.has(i) ? { ok: false, retryable: false, error: `Google Data Manager API: ${bad.get(i)}`.slice(0, 300) } : { ok: true },
    );
    const rest = events.map((e, i) => ({ e, i })).filter(({ i }) => !bad.has(i));
    if (!rest.length) return out;
    const second = await ingest(fetchImpl, token, googleIngestRequest(cfg, rest.map((r) => r.e)));
    if (second.status < 200 || second.status >= 300) {
      // Still rejected: retry the rest later rather than failing them for another event's error.
      const { error } = googleRequestError(second.status, second.body);
      for (const r of rest) out[r.i] = { ok: false, retryable: true, error };
    }
    return out;
  } catch (err) {
    return all({ ok: false, retryable: true, error: `Google Data Manager request failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) });
  }
}

export async function sendGoogleConversions(
  conn: ConnectionLike,
  cfg: GoogleUploadConfig,
  events: GoogleEvent[],
  fetchImpl: FetchLike = fetch,
  accessToken: (c: ConnectionLike) => Promise<string> = googleAccessToken,
): Promise<SendOutcome[]> {
  let token: string;
  try {
    token = await accessToken(conn);
  } catch (err) {
    const error = err instanceof Error ? err.message.slice(0, 300) : "Google OAuth error";
    return events.map(() => ({ ok: false, retryable: true, error }));
  }
  const out: SendOutcome[] = [];
  for (let i = 0; i < events.length; i += GOOGLE_BATCH_SIZE) {
    out.push(...(await sendBatch(fetchImpl, token, cfg, events.slice(i, i + GOOGLE_BATCH_SIZE))));
  }
  return out;
}

// ---------------------------------------------------------------- mock mode

const CONSENT_VALUES = new Set(["CONSENT_GRANTED", "CONSENT_DENIED", "CONSENT_STATUS_UNSPECIFIED"]);
const violation = (field: string, reason: string, description: string) => ({ field, reason, description });

/**
 * Mock Data Manager API for mock mode: validates the request the way `events:ingest` does
 * (fast-fail, snake_case field paths) and answers in its real response format — `{ requestId }`
 * on success, a google.rpc error with BadRequest field violations otherwise. No network call.
 */
export const mockDataManagerFetch: FetchLike = async (url, init) => {
  const requestId = `t-${randomUUID()}`;
  let req: Partial<GoogleIngestRequest> = {};
  try {
    req = JSON.parse(String(init?.body ?? "{}"));
  } catch {
    /* rejected below */
  }
  const violations: ReturnType<typeof violation>[] = [];
  const events = Array.isArray(req.events) ? req.events : [];
  const refs = new Set((req.destinations ?? []).map((d) => d.reference));
  if (url !== DATA_MANAGER_INGEST_URL) violations.push(violation("", "INVALID_ARGUMENT", "Unknown method."));
  if (!events.length) violations.push(violation("events", "INVALID_ARGUMENT", "At least one event is required."));
  if (events.length > GOOGLE_BATCH_SIZE) violations.push(violation("events", "TOO_MANY_ELEMENTS", `At most ${GOOGLE_BATCH_SIZE} events per request.`));
  (req.destinations ?? []).forEach((d, i) => {
    if (d.operatingAccount?.accountType !== "GOOGLE_ADS" || !/^\d+$/.test(d.operatingAccount?.accountId ?? "")) {
      violations.push(violation(`destinations[${i}].operating_account.account_id`, "INVALID_NUMBER_FORMAT", "String is not a valid number."));
    }
    if (!/^\d+$/.test(d.productDestinationId ?? "")) violations.push(violation(`destinations[${i}].product_destination_id`, "INVALID_NUMBER_FORMAT", "String is not a valid number."));
  });
  events.forEach((e, i) => {
    if (!e.eventTimestamp || Number.isNaN(Date.parse(e.eventTimestamp))) violations.push(violation(`events[${i}].event_timestamp`, "INVALID_ARGUMENT", "Invalid timestamp."));
    if (!e.adIdentifiers && !e.userData) violations.push(violation(`events[${i}]`, "INVALID_ARGUMENT", "An ad identifier or user data is required."));
    if (!CONSENT_VALUES.has(e.consent?.adUserData ?? "") || !CONSENT_VALUES.has(e.consent?.adPersonalization ?? "")) {
      violations.push(violation(`events[${i}].consent`, "INVALID_ARGUMENT", "Invalid consent status."));
    }
    for (const r of e.destinationReferences ?? []) if (!refs.has(r)) violations.push(violation(`events[${i}].destination_references`, "DESTINATION_NOT_FOUND", "Unknown destination reference."));
    for (const u of e.userData?.userIdentifiers ?? []) {
      if (!/^[0-9a-fA-F]{64}$/.test(u.emailAddress)) violations.push(violation(`events[${i}].user_data.user_identifiers`, "INVALID_SHA256_FORMAT", "Email is not a hex encoded SHA-256 hash."));
    }
  });
  if (!violations.length) return Response.json({ requestId });
  return Response.json(
    {
      error: {
        code: 400,
        message: "There was a problem with the request.",
        status: "INVALID_ARGUMENT",
        details: [
          { "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "INVALID_ARGUMENT", domain: "datamanager.googleapis.com", metadata: { requestId } },
          { "@type": "type.googleapis.com/google.rpc.RequestInfo", requestId },
          { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: violations },
        ],
      },
    },
    { status: 400 },
  );
};
