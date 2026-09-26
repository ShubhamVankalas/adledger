import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { intMinor, obj, str, toDate, type Json } from "./shared";
import { verifyBasicAuth } from "./webhook-auth";

// Chargebee: payment_succeeded -> payment; payment_refunded -> refund (one row per refund
// transaction, linked through `refunded_txn_id`). `transaction.amount` is already in minor units
// ("in cents"); `date` is unix seconds. Chargebee webhooks are not HMAC-signed, so the endpoint is
// protected with the HTTP Basic auth credentials configured on the webhook.
// https://apidocs.chargebee.com/docs/api/events  https://www.chargebee.com/docs/2.0/webhook_settings.html

function visitorIdOf(...records: (Json | null)[]): string | null {
  for (const r of records) {
    const v = str(r?.cf_adledger_vid) ?? str(obj(r?.meta_data)?.adledger_vid);
    if (v) return v;
  }
  return null;
}

export function chargebeeEventToEvents(payload: unknown): RevenueEventInput[] {
  const p = obj(payload);
  const event = str(p?.event_type);
  if (event !== "payment_succeeded" && event !== "payment_refunded") return [];
  const content = obj(p?.content);
  const txn = obj(content?.transaction);
  const id = str(txn?.id);
  const currency = str(txn?.currency_code)?.toUpperCase();
  const amountMinor = intMinor(txn?.amount);
  if (!txn || !id || !currency || !amountMinor || str(txn.status) !== "success") return [];

  const c = obj(content?.customer);
  const name = [str(c?.first_name), str(c?.last_name)].filter(Boolean).join(" ");
  const customer: RevenueEventInput["customer"] = {
    email: str(c?.email) ?? str(obj(c?.billing_address)?.email),
    name: name || null,
    phone: str(c?.phone),
    visitorId: visitorIdOf(c, obj(content?.subscription)),
    externalCustomerId: str(txn.customer_id) ?? str(c?.id),
  };
  const occurredAt = toDate(txn.date ?? p?.occurred_at, { unixSeconds: true });

  if (event === "payment_succeeded") {
    if (str(txn.type) !== "payment") return [];
    return [{ type: "payment", externalId: id, amountMinor, currency, occurredAt, customer }];
  }
  if (str(txn.type) !== "refund") return [];
  const paymentId = str(txn.refunded_txn_id);
  if (!paymentId) return [];
  return [{ type: "refund", externalId: id, relatedExternalId: paymentId, amountMinor, currency, occurredAt, customer }];
}

export const chargebeeConnector: RevenueConnector = {
  source: "chargebee",
  meta: {
    provider: "chargebee",
    name: "Chargebee",
    category: "revenue",
    description: "Subscription payments and refunds from Chargebee via webhooks.",
    status: "beta",
    color: "#ff3300",
    docsUrl: "https://www.chargebee.com/docs/2.0/webhook_settings.html",
    fields: [
      { name: "webhookUsername", label: "Webhook username", hint: "The basic-auth username you set on the Chargebee webhook." },
      { name: "webhookPassword", label: "Webhook password", secret: true, hint: "The basic-auth password you set on the Chargebee webhook (use a long random value)." },
    ],
    steps: [
      "In Chargebee go to Settings → Configure Chargebee → Webhooks → Add Webhook and paste the webhook URL shown in AdLedger.",
      "Turn on `Protect webhook URL with basic authentication`, choose a username and a long random password, and paste both here.",
      "Select the events `Payment Succeeded` and `Payment Refunded` (API version v2), then create the webhook.",
      "To link buyers to ad clicks, add a customer custom field `cf_adledger_vid` and fill it from `adledger.getVisitorId()` at checkout. Try it on your free Chargebee test site first.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyBasicAuth(req.headers, conn.config.webhookUsername,conn.secrets.webhookPassword);
  },
  parseWebhook(payload: unknown) {
    return chargebeeEventToEvents(payload);
  },
};
