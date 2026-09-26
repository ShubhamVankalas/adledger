import { createHmac } from "node:crypto";
import { fromDecimalString } from "../../money";
import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { safeEqual, str } from "./shared";

// Instamojo: a form-encoded (application/x-www-form-urlencoded) POST per payment; status `Credit`
// means the payment succeeded. There are no refund webhooks.
// mac = hex(HMAC-SHA1(values of every other field, sorted by field name case-insensitively and
// joined with "|", private salt)). `amount` is a decimal rupee string (e.g. "2499.00").
// The payload carries no timestamp, so payments are dated when the webhook arrives.
// https://support.instamojo.com/hc/en-us/articles/207816249-What-is-the-Message-Authentication-Code-in-Webhook

/** Form fields in body order (duplicates kept, `+` decoded as space like any form parser). */
export function instamojoFields(rawBody: string): [string, string][] {
  return [...new URLSearchParams(rawBody).entries()];
}

export function instamojoMac(fields: [string, string][], salt: string): string {
  const message = fields
    .filter(([k]) => k !== "mac")
    .sort(([a], [b]) => {
      const x = a.toLowerCase();
      const y = b.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    })
    .map(([, v]) => v)
    .join("|");
  return createHmac("sha1", salt).update(message, "utf8").digest("hex");
}

export function verifyInstamojoMac(rawBody: string, salt: string | undefined): boolean {
  if (!salt) return false;
  const fields = instamojoFields(rawBody);
  const macs = fields.filter(([k]) => k === "mac");
  if (macs.length !== 1) return false;
  const provided = macs[0][1].trim();
  if (!/^[0-9a-f]{40}$/i.test(provided)) return false;
  return safeEqual(Buffer.from(instamojoMac(fields, salt), "hex"), Buffer.from(provided, "hex"));
}

export function instamojoPaymentToEvents(rawBody: string, now = new Date()): RevenueEventInput[] {
  const f = Object.fromEntries(instamojoFields(rawBody));
  const id = str(f.payment_id);
  const currency = str(f.currency)?.toUpperCase();
  const amount = str(f.amount);
  if (!id || !currency || !amount || str(f.status)?.toLowerCase() !== "credit") return [];
  let amountMinor: number;
  try {
    amountMinor = fromDecimalString(amount, currency);
  } catch {
    return [];
  }
  if (amountMinor <= 0) return [];
  return [
    {
      type: "payment",
      externalId: id,
      amountMinor,
      currency,
      occurredAt: now,
      customer: {
        email: str(f.buyer),
        name: str(f.buyer_name),
        phone: str(f.buyer_phone),
      },
    },
  ];
}

export const instamojoConnector: RevenueConnector = {
  source: "instamojo",
  meta: {
    provider: "instamojo",
    name: "Instamojo",
    category: "revenue",
    description: "Successful payments from Instamojo payment links and payment requests via webhooks (INR).",
    status: "beta",
    color: "#2f3c8f",
    docsUrl: "https://docs.instamojo.com/reference/payments-api",
    fields: [
      {
        name: "privateSalt",
        label: "Private salt",
        secret: true,
        hint: "Dashboard → API & Plugins. Instamojo signs each webhook (the `mac` field) with this salt.",
      },
    ],
    steps: [
      "Paste the webhook URL shown in AdLedger as the `webhook` parameter when you create a payment request, or in the Webhook URL field of a payment link's advanced settings.",
      "Copy the Private salt from API & Plugins in the Instamojo dashboard and paste it here.",
      "Payments are matched to visitors by the buyer's email and phone, so collect both at checkout. Instamojo sends no refund webhooks; record refunds with a CSV import.",
      "Try it first with a free sandbox account on test.instamojo.com (its salt is different from the live one).",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyInstamojoMac(req.rawBody, conn.secrets.privateSalt);
  },
  // Form-encoded body: parse the raw body rather than the (JSON) payload argument.
  parseWebhook(_payload: unknown, req: WebhookRequest) {
    return instamojoPaymentToEvents(req.rawBody);
  },
};
