import { fromDecimalString } from "../../money";
import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { arr, obj, str, toDate, type Json } from "./shared";

// PayPal: PAYMENT.CAPTURE.COMPLETED -> payment; PAYMENT.CAPTURE.REFUNDED -> refund.
// Signatures are checked by PayPal itself: POST /v1/notifications/verify-webhook-signature with
// the PAYPAL-* transmission headers, the webhook id and the event, authorized by an OAuth token.
// Amounts are decimal strings ("10.99").
// https://developer.paypal.com/api/rest/webhooks/rest/

export function paypalApiBase(environment: string | undefined): string {
  return (environment ?? "").trim().toLowerCase() === "sandbox" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(base: string, clientId: string, clientSecret: string): Promise<string> {
  const key = `${base}|${clientId}`;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal token request failed: HTTP ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("PayPal did not return an access token");
  // Refresh a minute early.
  tokenCache.set(key, { token: body.access_token, expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 0) - 60) * 1000 });
  return body.access_token;
}

/** Test hook: forget cached OAuth tokens. */
export function clearPaypalTokenCache() {
  tokenCache.clear();
}

async function verifyWebhook(req: WebhookRequest, conn: ConnectionLike): Promise<boolean> {
  const h = (k: string) => req.headers.get(k);
  const fields = {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: conn.config.webhookId?.trim() || null,
  };
  const clientId = conn.config.clientId?.trim();
  const clientSecret = conn.secrets.clientSecret;
  if (!clientId || !clientSecret || Object.values(fields).some((v) => !v)) return false;
  try {
    JSON.parse(req.rawBody); // must be a JSON event before we splice it in verbatim
  } catch {
    return false;
  }
  try {
    const base = paypalApiBase(conn.config.environment);
    const token = await accessToken(base, clientId, clientSecret);
    // Splice the raw event in unchanged: re-serializing it can alter the bytes PayPal signed.
    const body = `${JSON.stringify(fields).slice(0, -1)},"webhook_event":${req.rawBody}}`;
    const res = await fetch(`${base}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
      body,
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { verification_status?: string };
    return out.verification_status === "SUCCESS";
  } catch {
    return false;
  }
}

/** custom_id may hold the bare visitor id, `adledger_vid=<id>` / `adledger_vid:<id>`, or JSON. */
export function paypalVisitorId(customId: unknown): string | null {
  const s = str(customId);
  if (!s) return null;
  const tagged = /adledger_vid["']?\s*[=:]\s*["']?([A-Za-z0-9_-]+)/.exec(s);
  if (tagged) return tagged[1];
  if (s.startsWith("{")) return null; // JSON without our key
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

function money(r: Json): { amountMinor: number; currency: string } | null {
  const amt = obj(r.amount);
  const value = str(amt?.value);
  const currency = str(amt?.currency_code)?.toUpperCase();
  if (!value || !currency) return null;
  const amountMinor = fromDecimalString(value, currency);
  return amountMinor > 0 ? { amountMinor, currency } : null;
}

/** Capture id a refund belongs to: the `up` link (/v2/payments/captures/<id>) or supplementary data. */
export function paypalRefundCaptureId(r: Json): string | null {
  for (const l of arr(r.links)) {
    const link = obj(l);
    const m = str(link?.rel) === "up" ? /\/captures\/([^/?#]+)/.exec(str(link?.href) ?? "") : null;
    if (m) return decodeURIComponent(m[1]);
  }
  return str(obj(obj(r.supplementary_data)?.related_ids)?.capture_id);
}

export function paypalEventToEvents(payload: unknown): RevenueEventInput[] {
  const p = obj(payload);
  const type = str(p?.event_type);
  const r = obj(p?.resource);
  const id = str(r?.id);
  if (!r || !id) return [];
  const payer = obj(r.payer);
  const payerName = obj(payer?.name);
  const name = [str(payerName?.given_name), str(payerName?.surname)].filter(Boolean).join(" ");
  const customer: RevenueEventInput["customer"] = {
    // Capture payloads usually carry no payer; the visitor id in custom_id links the buyer.
    email: str(payer?.email_address),
    name: name || null,
    visitorId: paypalVisitorId(r.custom_id),
    externalCustomerId: str(payer?.payer_id),
  };

  if (type === "PAYMENT.CAPTURE.COMPLETED") {
    const m = money(r);
    if (!m || str(r.status) !== "COMPLETED") return [];
    return [{ type: "payment", externalId: id, ...m, occurredAt: toDate(r.create_time ?? p?.create_time), customer }];
  }

  if (type === "PAYMENT.CAPTURE.REFUNDED") {
    // The resource is the refund; its amount is this refund only.
    const m = money(r);
    const captureId = paypalRefundCaptureId(r);
    if (!m || !captureId) return [];
    return [
      {
        type: "refund",
        externalId: id,
        relatedExternalId: captureId,
        ...m,
        occurredAt: toDate(r.create_time ?? p?.create_time),
        customer,
      },
    ];
  }
  return [];
}

export const paypalConnector: RevenueConnector = {
  source: "paypal",
  meta: {
    provider: "paypal",
    name: "PayPal",
    category: "revenue",
    description: "Completed PayPal captures and refunds via verified webhooks.",
    status: "beta",
    color: "#003087",
    docsUrl: "https://developer.paypal.com/api/rest/webhooks/",
    fields: [
      { name: "environment", label: "Environment", placeholder: "live", hint: "`live` or `sandbox`." },
      { name: "clientId", label: "Client ID", hint: "From your REST app in the PayPal Developer Dashboard." },
      { name: "clientSecret", label: "Client secret", secret: true },
      { name: "webhookId", label: "Webhook ID", placeholder: "8PT597110X687430LKGECATA", hint: "Shown next to the webhook in your app's settings." },
    ],
    steps: [
      "Sign in to developer.paypal.com → Apps & Credentials, pick Live or Sandbox, and open (or create) a REST app; copy its Client ID and Secret.",
      "In the app scroll to Webhooks → Add Webhook, paste the webhook URL shown in AdLedger and tick `Payment capture completed` and `Payment capture refunded`.",
      "Copy the Webhook ID shown in the list and paste it here with the environment (`live` or `sandbox`).",
      "To link buyers to ad clicks, set the order's `purchase_units[].custom_id` to `adledger.getVisitorId()`. Try it end to end with free sandbox accounts first.",
    ],
  },
  verifyWebhook,
  parseWebhook(payload: unknown) {
    return paypalEventToEvents(payload);
  },
};
