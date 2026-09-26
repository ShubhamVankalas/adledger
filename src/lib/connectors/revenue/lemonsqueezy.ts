import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { intMinor, obj, str, toDate, verifyHmac } from "./shared";

// Lemon Squeezy: order_created (paid) and subscription_payment_success -> payment;
// order_refunded / subscription_payment_refunded -> cumulative refund.
// X-Signature = hex(HMAC-SHA256(rawBody, signing secret)). Amounts are integers in cents.
// https://docs.lemonsqueezy.com/help/webhooks/signing-requests

export function lemonSqueezyEventToEvents(payload: unknown): RevenueEventInput[] {
  const p = obj(payload);
  const meta = obj(p?.meta);
  const event = str(meta?.event_name);
  const data = obj(p?.data);
  const a = obj(data?.attributes);
  const id = str(data?.id);
  const currency = str(a?.currency)?.toUpperCase();
  if (!event || !a || !id || !currency) return [];

  // Orders and subscription invoices have separate id sequences, so prefix them.
  const isOrder = event === "order_created" || event === "order_refunded";
  const isInvoice = event === "subscription_payment_success" || event === "subscription_payment_refunded";
  if (!isOrder && !isInvoice) return [];
  const paymentId = `${isOrder ? "order" : "invoice"}:${id}`;
  const customer: RevenueEventInput["customer"] = {
    email: str(a.user_email),
    name: str(a.user_name),
    visitorId: str(obj(meta?.custom_data)?.adledger_vid),
    externalCustomerId: str(a.customer_id),
  };

  if (event === "order_created" || event === "subscription_payment_success") {
    if (str(a.status) !== "paid") return [];
    // The first subscription invoice duplicates the order that created the subscription.
    if (event === "subscription_payment_success" && str(a.billing_reason) === "initial") return [];
    const amountMinor = intMinor(a.total);
    if (!amountMinor) return [];
    return [{ type: "payment", externalId: paymentId, amountMinor, currency, occurredAt: toDate(a.created_at), customer }];
  }

  const refunded = intMinor(a.refunded_amount);
  if (!refunded) return [];
  return [
    {
      type: "refund",
      externalId: `refunds:${paymentId}`, // cumulative: partial refunds update the same row
      relatedExternalId: paymentId,
      amountMinor: refunded,
      currency,
      occurredAt: toDate(a.refunded_at ?? a.updated_at),
      customer,
    },
  ];
}

export const lemonSqueezyConnector: RevenueConnector = {
  source: "lemonsqueezy",
  meta: {
    provider: "lemonsqueezy",
    name: "Lemon Squeezy",
    category: "revenue",
    description: "Orders, subscription renewals and refunds from Lemon Squeezy via webhooks.",
    status: "beta",
    color: "#ffc233",
    docsUrl: "https://docs.lemonsqueezy.com/help/webhooks",
    fields: [{ name: "webhookSecret", label: "Signing secret", secret: true, hint: "The secret you typed when creating the webhook (6–40 characters)." }],
    steps: [
      "In Lemon Squeezy go to Settings → Webhooks and click + to add a webhook, using the webhook URL shown in AdLedger as the Callback URL.",
      "Type a signing secret (any random 6–40 characters) and paste the same value here.",
      "Tick the events `order_created`, `order_refunded`, `subscription_payment_success` and `subscription_payment_refunded`, then save.",
      "To link buyers to ad clicks, add `checkout[custom][adledger_vid]=<visitor id>` to checkout links (from `adledger.getVisitorId()`). Use Test mode to try it without real payments.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyHmac(req.rawBody, conn.secrets.webhookSecret, req.headers.get("x-signature"), "hex");
  },
  parseWebhook(payload: unknown) {
    return lemonSqueezyEventToEvents(payload);
  },
};
