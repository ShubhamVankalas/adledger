import { fromDecimalString } from "../../money";
import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { obj, str, toDate, verifyHmac } from "./shared";

// Cashfree Payments (PG webhooks, API version 2023-08-01 and later):
// PAYMENT_SUCCESS_WEBHOOK -> payment; REFUND_STATUS_WEBHOOK with refund_status SUCCESS -> refund.
// x-webhook-signature = base64(HMAC-SHA256(x-webhook-timestamp + rawBody, client secret key)).
// Amounts are decimal rupees (e.g. 2499.00), so they are read as decimal strings from the raw body.
// https://www.cashfree.com/docs/payments/online/webhooks/overview
//
// No freshness window on x-webhook-timestamp: Cashfree documents none, retries (custom retry policy,
// possibly hours later) may resend the original timestamp, and a replayed event is harmless because
// ingestion is idempotent on the order / refund id. The timestamp is still covered by the HMAC.

export function verifyCashfreeSignature(rawBody: string, timestamp: string | null, signature: string | null, secret: string | undefined): boolean {
  const ts = timestamp?.trim();
  if (!ts || !/^\d+$/.test(ts)) return false;
  return verifyHmac(ts + rawBody, secret, signature, "base64");
}

/**
 * The decimal literal for `key` exactly as it appears in the raw JSON (e.g. "2499.00"), so money
 * never passes through a float. Falls back to the parsed value when the key is absent or the first
 * match is some other field with the same name (e.g. inside merchant-set order tags).
 */
export function rawDecimal(rawBody: string, key: string, parsed: unknown): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"?(\\d+(?:\\.\\d+)?)"?`).exec(rawBody);
  return m && Number(m[1]) === Number(parsed) ? m[1] : str(parsed);
}

function amountMinor(rawBody: string, key: string, parsed: unknown, currency: string): number | null {
  const value = rawDecimal(rawBody, key, parsed);
  if (!value) return null;
  try {
    const minor = fromDecimalString(value, currency);
    return minor > 0 ? minor : null;
  } catch {
    return null;
  }
}

export function cashfreeEventToEvents(payload: unknown, rawBody: string): RevenueEventInput[] {
  const p = obj(payload);
  const type = str(p?.type);
  const data = obj(p?.data);

  if (type === "PAYMENT_SUCCESS_WEBHOOK") {
    const order = obj(data?.order);
    const payment = obj(data?.payment);
    const cust = obj(data?.customer_details);
    const orderId = str(order?.order_id);
    const currency = str(payment?.payment_currency ?? order?.order_currency)?.toUpperCase();
    if (!payment || !orderId || !currency || str(payment.payment_status) !== "SUCCESS") return [];
    const amount = amountMinor(rawBody, "payment_amount", payment.payment_amount, currency);
    if (!amount) return [];
    return [
      {
        type: "payment",
        externalId: orderId,
        amountMinor: amount,
        currency,
        occurredAt: toDate(payment.payment_time ?? p?.event_time),
        customer: {
          email: str(cust?.customer_email),
          name: str(cust?.customer_name),
          phone: str(cust?.customer_phone),
          visitorId: str(obj(order?.order_tags)?.adledger_vid),
          externalCustomerId: str(cust?.customer_id),
        },
      },
    ];
  }

  if (type === "REFUND_STATUS_WEBHOOK") {
    const refund = obj(data?.refund);
    const refundId = str(refund?.refund_id);
    const orderId = str(refund?.order_id);
    const currency = str(refund?.refund_currency)?.toUpperCase();
    if (!refund || !refundId || !orderId || !currency || str(refund.refund_status) !== "SUCCESS") return [];
    const amount = amountMinor(rawBody, "refund_amount", refund.refund_amount, currency);
    if (!amount) return [];
    return [
      {
        type: "refund",
        // refund_id is merchant-chosen and only unique within its order (often "refund_1"), so
        // scope it by order and prefix it so it can never collide with an order id.
        externalId: `refund:${orderId}:${refundId}`,
        relatedExternalId: orderId,
        amountMinor: amount,
        currency,
        occurredAt: toDate(refund.processed_at ?? p?.event_time),
        customer: {},
      },
    ];
  }
  return [];
}

export const cashfreeConnector: RevenueConnector = {
  source: "cashfree",
  meta: {
    provider: "cashfree",
    name: "Cashfree Payments",
    category: "revenue",
    description: "Successful payments and refunds from Cashfree Payment Gateway via webhooks (INR and international).",
    status: "beta",
    color: "#6933d3",
    docsUrl: "https://www.cashfree.com/docs/payments/online/webhooks/overview",
    fields: [
      {
        name: "clientSecret",
        label: "Client secret key",
        secret: true,
        hint: "Developers → API Keys. Cashfree signs webhooks with this key; use the Test key while in sandbox.",
      },
    ],
    steps: [
      "In the Cashfree Merchant Dashboard go to Payment Gateway → Developers → Webhooks → Add Webhook Endpoint and paste the webhook URL shown in AdLedger.",
      "Choose the latest webhook version and enable `PAYMENT_SUCCESS_WEBHOOK` and `REFUND_STATUS_WEBHOOK`.",
      "Copy the Client secret key from Developers → API Keys and paste it here.",
      "To link buyers to ad clicks, send `order_tags: { adledger_vid: adledger.getVisitorId() }` when you create the order. Try it in Test (sandbox) mode first; it is free.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyCashfreeSignature(
      req.rawBody,
      req.headers.get("x-webhook-timestamp"),
      req.headers.get("x-webhook-signature"),
      conn.secrets.clientSecret,
    );
  },
  parseWebhook(payload: unknown, req: WebhookRequest) {
    return cashfreeEventToEvents(payload, req.rawBody);
  },
};
