import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { intMinor, obj, str, toDate, verifyHmac } from "./shared";

// Razorpay: payment.captured -> payment; refund.processed / refund.created -> refund.
// X-Razorpay-Signature = hex(HMAC-SHA256(rawBody, webhook secret)). Amounts are already in
// the smallest unit (paise for INR).
// https://razorpay.com/docs/webhooks/validate-test/

export function razorpayEventToEvents(payload: unknown): RevenueEventInput[] {
  const p = obj(payload);
  const event = str(p?.event);
  const body = obj(p?.payload);
  const payment = obj(obj(body?.payment)?.entity);
  // `notes` is an object, or an empty array when no notes were set.
  const notes = obj(payment?.notes);
  const customer: RevenueEventInput["customer"] = {
    email: str(payment?.email),
    phone: str(payment?.contact),
    visitorId: str(notes?.adledger_vid),
    externalCustomerId: str(payment?.customer_id),
  };

  if (event === "payment.captured") {
    const id = str(payment?.id);
    const currency = str(payment?.currency)?.toUpperCase();
    const amountMinor = intMinor(payment?.amount);
    if (!payment || !id || !currency || !amountMinor || str(payment.status) !== "captured") return [];
    return [{ type: "payment", externalId: id, amountMinor, currency, occurredAt: toDate(payment.created_at, { unixSeconds: true }), customer }];
  }

  if (event === "refund.processed" || event === "refund.created") {
    const refund = obj(obj(body?.refund)?.entity);
    const id = str(refund?.id);
    const paymentId = str(refund?.payment_id) ?? str(payment?.id);
    const currency = str(refund?.currency)?.toUpperCase();
    const amountMinor = intMinor(refund?.amount);
    if (!refund || !id || !paymentId || !currency || !amountMinor || str(refund.status) === "failed") return [];
    return [
      {
        type: "refund",
        externalId: id,
        relatedExternalId: paymentId,
        amountMinor,
        currency,
        occurredAt: toDate(refund.created_at, { unixSeconds: true }),
        customer: { ...customer, visitorId: customer.visitorId ?? str(obj(refund.notes)?.adledger_vid) },
      },
    ];
  }
  return [];
}

export const razorpayConnector: RevenueConnector = {
  source: "razorpay",
  meta: {
    provider: "razorpay",
    name: "Razorpay",
    category: "revenue",
    description: "Captured payments and refunds from Razorpay via webhooks (INR and international).",
    status: "beta",
    color: "#0c2451",
    docsUrl: "https://razorpay.com/docs/webhooks/",
    fields: [{ name: "webhookSecret", label: "Webhook secret", secret: true, hint: "The secret you set when creating the webhook." }],
    steps: [
      "In the Razorpay Dashboard go to Account & Settings → Webhooks → Add New Webhook and paste the webhook URL shown in AdLedger.",
      "Type a webhook secret (any strong random text) and paste the same value here.",
      "Tick the events `payment.captured`, `refund.created` and `refund.processed`, then create the webhook.",
      "To link buyers to ad clicks, pass `notes: { adledger_vid: adledger.getVisitorId() }` in Checkout options. Set it up in Test mode first; test-mode webhooks are free.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyHmac(req.rawBody, conn.secrets.webhookSecret, req.headers.get("x-razorpay-signature"), "hex");
  },
  parseWebhook(payload: unknown) {
    return razorpayEventToEvents(payload);
  },
};
