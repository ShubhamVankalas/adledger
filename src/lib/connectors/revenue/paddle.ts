import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { hmacSha256, intMinor, obj, safeEqual, str, toDate } from "./shared";

// Paddle Billing: `transaction.completed` -> payment; approved refund adjustments -> refund.
// Paddle-Signature: `ts=<unix>;h1=<hex>` where h1 = HMAC-SHA256(`${ts}:${rawBody}`, endpoint secret key).
// Amounts are strings in the currency's lowest denomination ("65215" = $652.15).
// https://developer.paddle.com/webhooks/signature-verification

export const PADDLE_MAX_AGE_SECONDS = 300;

export function verifyPaddleSignature(rawBody: string, header: string | null, secret: string | undefined, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  let ts: string | null = null;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "ts") ts = v;
    else if (k === "h1") h1.push(v); // several h1 values may be present while a secret is rotated
  }
  if (!ts || !/^\d+$/.test(ts) || !h1.length) return false;
  if (Math.abs(nowMs / 1000 - Number(ts)) > PADDLE_MAX_AGE_SECONDS) return false; // replay protection
  const expected = hmacSha256(secret, `${ts}:${rawBody}`);
  return h1.some((sig) => /^[0-9a-f]+$/i.test(sig) && safeEqual(expected, Buffer.from(sig, "hex")));
}

export function paddleEventToEvents(payload: unknown): RevenueEventInput[] {
  const p = obj(payload);
  const type = str(p?.event_type);
  const d = obj(p?.data);
  const id = str(d?.id);
  const currency = str(d?.currency_code)?.toUpperCase();
  if (!d || !id || !currency) return [];
  const customerId = str(d.customer_id);

  if (type === "transaction.completed") {
    const totals = obj(obj(d.details)?.totals);
    // grand_total = what was charged after credits; free-trial/zero transactions are skipped.
    const amountMinor = intMinor(totals?.grand_total ?? totals?.total);
    if (!amountMinor) return [];
    return [
      {
        type: "payment",
        externalId: id,
        amountMinor,
        currency,
        occurredAt: toDate(d.billed_at ?? p?.occurred_at),
        // Paddle webhooks carry no email, only the customer id; the visitor id comes from customData.
        customer: { visitorId: str(obj(d.custom_data)?.adledger_vid), externalCustomerId: customerId },
      },
    ];
  }

  if (type === "adjustment.created" || type === "adjustment.updated") {
    if (str(d.action) !== "refund" || str(d.status) !== "approved") return [];
    const amountMinor = intMinor(obj(d.totals)?.total);
    const txn = str(d.transaction_id);
    if (!amountMinor || !txn) return [];
    return [
      {
        type: "refund",
        externalId: id,
        relatedExternalId: txn,
        amountMinor,
        currency,
        occurredAt: toDate(d.updated_at ?? d.created_at ?? p?.occurred_at),
        customer: { externalCustomerId: customerId },
      },
    ];
  }
  return [];
}

export const paddleConnector: RevenueConnector = {
  source: "paddle",
  meta: {
    provider: "paddle",
    name: "Paddle",
    category: "revenue",
    description: "Completed transactions and approved refunds from Paddle Billing via webhooks.",
    status: "beta",
    color: "#fddd35",
    docsUrl: "https://developer.paddle.com/webhooks/overview",
    fields: [
      {
        name: "webhookSecret",
        label: "Endpoint secret key",
        secret: true,
        placeholder: "pdl_ntfset_…",
        hint: "Shown on the notification destination after you create it.",
      },
    ],
    steps: [
      "In Paddle go to Developer tools → Notifications → New destination, choose Webhook and paste the webhook URL shown in AdLedger.",
      "Select the events `transaction.completed`, `adjustment.created` and `adjustment.updated`, then save.",
      "Open the destination, copy its secret key and paste it here.",
      "To link buyers to ad clicks, pass `customData: { adledger_vid: adledger.getVisitorId() }` when opening Paddle Checkout. Test first with a free Paddle sandbox account.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyPaddleSignature(req.rawBody, req.headers.get("paddle-signature"), conn.secrets.webhookSecret);
  },
  parseWebhook(payload: unknown) {
    return paddleEventToEvents(payload);
  },
};
