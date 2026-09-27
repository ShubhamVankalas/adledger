import { META_API_VERSION_DEFAULT } from "../connectors/ads";
import type { ConnectionLike } from "../connectors/types";
import { hashEmail, sha256 } from "../crypto";
import { toDecimalString } from "../money";
import { metaDataProcessing } from "./consent";
import type { Built, ConversionContext, FetchLike, SendOutcome } from "./types";

// Meta Conversions API: POST https://graph.facebook.com/{version}/{pixel_id}/events
// https://developers.facebook.com/docs/marketing-api/conversions-api/parameters

export const META_MAX_EVENT_AGE_MS = 7 * 24 * 3_600_000; // Meta rejects events older than 7 days
export const META_BATCH_SIZE = 100; // Meta allows up to 1,000 events per request

export type MetaUploadConfig = {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
  version: string;
};

export type MetaServerEvent = {
  event_name: "Lead" | "Purchase";
  event_time: number; // unix seconds
  event_id: string;
  action_source: "website" | "system_generated";
  event_source_url?: string;
  user_data: {
    em?: string[];
    ph?: string[];
    external_id?: string[];
    fbc?: string;
    fbp?: string;
    client_ip_address?: string;
    client_user_agent?: string;
  };
  custom_data?: { value: number; currency: string };
  // Limited Data Use: ["LDU"] (+ country/state 0 = Meta geolocates) for GPC visitors, [] otherwise.
  data_processing_options: "LDU"[];
  data_processing_options_country?: 0;
  data_processing_options_state?: 0;
};

const on = (v: string | undefined) => v === "on" || v === "true";

/** Upload settings from the Meta Ads connection, or null when CAPI is off / incomplete. */
export function metaUploadConfig(conn: ConnectionLike): MetaUploadConfig | null {
  const pixelId = (conn.config.pixelId ?? "").trim();
  const accessToken = conn.secrets.capiAccessToken || conn.secrets.accessToken || "";
  if (!on(conn.config.capiEnabled) || !pixelId) return null;
  return {
    pixelId,
    accessToken,
    testEventCode: conn.config.testEventCode?.trim() || null,
    version: conn.config.apiVersion?.trim() || META_API_VERSION_DEFAULT,
  };
}

/**
 * The page URL without query string or fragment: stored URLs are not PII-redacted, and a
 * query like `?email=…` must never reach Meta. Meta only needs the page for domain matching.
 */
export function pageUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

/** Deterministic event id, so retries and re-runs are de-duplicated by Meta. */
export function metaEventId(c: Pick<ConversionContext, "type" | "id">): string {
  return `${c.type}_${c.id}`;
}

/**
 * One CAPI server event. Identifiers are SHA-256 hashed per Meta's normalization rules.
 * `consent` is the upload's consent basis (see consent.ts): "limited" turns on Limited Data Use.
 */
export function buildMetaEvent(c: ConversionContext, now = new Date(), consent: "granted" | "implied" | "limited" = "implied"): Built<MetaServerEvent> {
  if (now.getTime() - c.occurredAt.getTime() > META_MAX_EVENT_AGE_MS) return { skip: "Older than 7 days (Meta limit)", reason: "too_old" };
  // em: lowercase + trim, then SHA-256. ph: digits only incl. country code (stored hash follows the same rule).
  const em = c.email ? hashEmail(c.email) : c.emailHash;
  const user: MetaServerEvent["user_data"] = {};
  if (em) user.em = [em];
  if (c.phoneHash) user.ph = [c.phoneHash];
  if (c.contactId) user.external_id = [sha256(c.contactId)];
  if (c.fbc) user.fbc = c.fbc;
  if (c.fbp) user.fbp = c.fbp;
  if (c.ip) user.client_ip_address = c.ip;
  if (c.userAgent) user.client_user_agent = c.userAgent;
  if (!user.em && !user.ph && !user.fbc && !user.fbp) return { skip: "No email, phone or Meta click/browser ID to match on", reason: "no_match_keys" };
  const sourceUrl = c.sourceUrl ? pageUrl(c.sourceUrl) : null;

  const event: MetaServerEvent = {
    event_name: c.type === "purchase" ? "Purchase" : "Lead",
    event_time: Math.floor(c.occurredAt.getTime() / 1000),
    event_id: metaEventId(c),
    // Meta requires client_user_agent and event_source_url for website events; anything else is system_generated.
    action_source: c.userAgent && sourceUrl ? "website" : "system_generated",
    user_data: user,
    ...metaDataProcessing(consent),
  };
  if (c.userAgent && sourceUrl) event.event_source_url = sourceUrl;
  if (c.type === "purchase") {
    if (c.amountMinor == null || !c.currency || c.amountMinor <= 0) return { skip: "Purchase has no positive amount", reason: "no_value" };
    // Major units from integer minor units via an exact decimal string (12345 USD -> 123.45).
    event.custom_data = { value: Number(toDecimalString(c.amountMinor, c.currency)), currency: c.currency.toUpperCase() };
  }
  return { payload: event };
}

export function metaRequestBody(cfg: MetaUploadConfig, events: MetaServerEvent[]) {
  return { data: events, ...(cfg.testEventCode ? { test_event_code: cfg.testEventCode } : {}), access_token: cfg.accessToken };
}

type MetaError = { message?: string; code?: number; error_subcode?: number; is_transient?: boolean };

// Throttling, temporary, token and permission errors are retried (bounded by MAX_ATTEMPTS), so
// fixing the token, pixel ID or dataset access lets pending uploads through.
const RETRYABLE_CODES = new Set([1, 2, 4, 10, 17, 32, 190, 341, 613, 80004]);

function retryableMetaError(e: MetaError): boolean {
  if (e.is_transient === true) return true;
  if (e.code === undefined) return false;
  if (RETRYABLE_CODES.has(e.code)) return true;
  if (e.code >= 200 && e.code <= 299) return true; // permission errors
  return e.code === 100 && e.error_subcode === 33; // pixel doesn't exist or the token can't access it
}

/**
 * Mock Graph API for mock mode: answers exactly like POST /{pixel_id}/events, without a network
 * call, so mock uploads run the same request/response path as live ones.
 */
export const mockMetaFetch: FetchLike = async (_url, init) => {
  let data: unknown[] = [];
  try {
    const body = JSON.parse(String(init?.body ?? "{}")) as { data?: unknown };
    if (Array.isArray(body.data)) data = body.data;
  } catch {
    /* rejected below */
  }
  if (!data.length || data.length > 1000) {
    return Response.json({ error: { message: "Invalid parameter", type: "OAuthException", code: 100, fbtrace_id: "AmockTrace" } }, { status: 400 });
  }
  return Response.json({ events_received: data.length, messages: [], fbtrace_id: "AmockTrace" });
};

/** Classify a CAPI HTTP response into a per-batch outcome. */
export function classifyMetaResponse(status: number, body: unknown, expected: number): SendOutcome {
  const b = (body ?? {}) as { events_received?: number; error?: MetaError };
  if (status >= 200 && status < 300 && !b.error) {
    if (typeof b.events_received === "number" && b.events_received < expected) {
      return { ok: false, retryable: true, error: `Meta accepted ${b.events_received} of ${expected} events` };
    }
    return { ok: true };
  }
  const e = b.error ?? {};
  const retryable = status === 429 || status >= 500 || retryableMetaError(e);
  return { ok: false, retryable, error: `Meta API error (${status}${e.code ? `/${e.code}` : ""}): ${(e.message ?? "unknown error").slice(0, 300)}` };
}

/** POST one batch of events. Network failures are retryable. The access token is never logged. */
export async function sendMetaBatch(cfg: MetaUploadConfig, events: MetaServerEvent[], fetchImpl: FetchLike = fetch): Promise<SendOutcome> {
  if (!cfg.accessToken) return { ok: false, retryable: true, error: "Meta access token is missing" };
  try {
    const res = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${encodeURIComponent(cfg.pixelId)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(metaRequestBody(cfg, events)),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => null);
    return classifyMetaResponse(res.status, body, events.length);
  } catch (err) {
    return { ok: false, retryable: true, error: `Meta request failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
  }
}

/**
 * Send events in batches. Meta rejects a whole request when one event is invalid, so a
 * batch that fails permanently is re-sent one event at a time to isolate the bad one.
 */
export async function sendMetaEvents(cfg: MetaUploadConfig, events: MetaServerEvent[], fetchImpl: FetchLike = fetch): Promise<SendOutcome[]> {
  const out: SendOutcome[] = [];
  for (let i = 0; i < events.length; i += META_BATCH_SIZE) {
    const batch = events.slice(i, i + META_BATCH_SIZE);
    const r = await sendMetaBatch(cfg, batch, fetchImpl);
    if (r.ok || r.retryable || batch.length === 1) {
      out.push(...batch.map(() => r));
      continue;
    }
    for (const e of batch) out.push(await sendMetaBatch(cfg, [e], fetchImpl));
  }
  return out;
}
