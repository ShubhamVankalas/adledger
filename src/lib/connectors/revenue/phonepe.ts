import { createHash } from "node:crypto";
import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { arr, intMinor, obj, safeEqual, str } from "./shared";

// PhonePe Payment Gateway (Standard Checkout v2): checkout.order.completed -> payment;
// pg.refund.completed -> refund. Webhooks carry `Authorization: <hex SHA256("username:password")>`
// built from the username/password set on the webhook in the PhonePe dashboard (this is how the
// official SDKs' validateCallback checks it). It authenticates the sender but, unlike an HMAC, does
// not cover the body. Amounts are integers in paise; timestamps are epoch milliseconds.
// https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook

export function phonepeAuthorization(username: string, password: string): string {
  return createHash("sha256").update(`${username}:${password}`, "utf8").digest("hex");
}

export function verifyPhonepeAuthorization(header: string | null, username: string | undefined, password: string | undefined): boolean {
  if (!header || !username || !password) return false;
  const provided = header.trim().replace(/^SHA256\s+/i, "");
  if (!/^[0-9a-f]{64}$/i.test(provided)) return false;
  return safeEqual(Buffer.from(phonepeAuthorization(username, password), "hex"), Buffer.from(provided, "hex"));
}

function epochMs(v: unknown): Date | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? new Date(v) : null;
}

/** Timestamp of the completed payment attempt (epoch ms), else now. */
function completedAt(details: unknown): Date {
  for (const d of arr(details)) {
    const detail = obj(d);
    const at = str(detail?.state) === "COMPLETED" ? epochMs(detail?.timestamp) : null;
    if (at) return at;
  }
  return new Date();
}

export function phonepeEventToEvents(payload: unknown): RevenueEventInput[] {
  const p = obj(payload);
  const event = str(p?.event);
  const body = obj(p?.payload);
  if (!body || str(body.state) !== "COMPLETED") return [];
  const amountMinor = intMinor(body.amount);
  if (!amountMinor) return [];

  if (event === "checkout.order.completed") {
    const orderId = str(body.merchantOrderId);
    if (!orderId) return [];
    return [
      {
        type: "payment",
        externalId: orderId,
        amountMinor,
        currency: "INR", // PhonePe PG settles in INR only
        occurredAt: completedAt(body.paymentDetails),
        customer: { visitorId: str(obj(body.metaInfo)?.udf1) },
      },
    ];
  }

  if (event === "pg.refund.completed") {
    // PhonePe's own refundId (always sent, globally unique); merchantRefundId only in some payloads.
    const refundId = str(body.refundId) ?? str(body.merchantRefundId);
    const orderId = str(body.originalMerchantOrderId);
    if (!refundId || !orderId) return [];
    return [
      {
        type: "refund",
        // Prefixed so a refund id can never collide with a merchant order id.
        externalId: `refund:${refundId}`,
        relatedExternalId: orderId,
        amountMinor,
        currency: "INR",
        // Refund payloads carry a top-level `timestamp` (epoch ms), not paymentDetails.
        occurredAt: epochMs(body.timestamp) ?? completedAt(body.paymentDetails),
        customer: {},
      },
    ];
  }
  return [];
}

export const phonepeConnector: RevenueConnector = {
  source: "phonepe",
  meta: {
    provider: "phonepe",
    name: "PhonePe",
    category: "revenue",
    description: "Completed orders and refunds from PhonePe Payment Gateway (Standard Checkout) via webhooks.",
    status: "beta",
    color: "#5f259f",
    docsUrl: "https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/webhook",
    fields: [
      { name: "webhookUsername", label: "Webhook username", hint: "The username you set on the webhook in the PhonePe dashboard." },
      { name: "webhookPassword", label: "Webhook password", secret: true, hint: "The password you set on the same webhook." },
    ],
    steps: [
      "In the PhonePe Business Dashboard go to Developer Settings → Webhook → Create Webhook and paste the webhook URL shown in AdLedger.",
      "Choose a username and a strong password for the webhook and enter the same values here.",
      "Select the events `checkout.order.completed` and `pg.refund.completed`, then save.",
      "To link buyers to ad clicks, send `metaInfo: { udf1: adledger.getVisitorId() }` when you create the payment. Test it in the free UAT sandbox (switch the dashboard to Test Mode) before going live.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyPhonepeAuthorization(
      req.headers.get("authorization"),
      conn.config.webhookUsername ?? conn.secrets.webhookUsername,
      conn.secrets.webhookPassword,
    );
  },
  parseWebhook(payload: unknown) {
    return phonepeEventToEvents(payload);
  },
};
