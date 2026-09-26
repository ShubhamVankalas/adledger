import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { intMinor, toDate } from "./shared";
import { verifyBasicAuth } from "./webhook-auth";

// Recurly: successful_payment_notification -> payment; successful_refund_notification -> refund;
// void_payment_notification -> full refund linked to the voided payment.
// Recurly's JSON webhooks carry only ids (the payment must be fetched via the API), so AdLedger
// uses the XML notifications, which include the account and the transaction. XML notifications
// are not signed; the endpoint is protected with HTTP Basic auth configured on the endpoint.
// `amount_in_cents` is minor units. The XML has no currency and parseWebhook gets no connection,
// so a non-USD site adds `?currency=EUR` (etc.) to the webhook URL.
// https://docs.recurly.com/recurly-subscriptions/docs/payment-notifications

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
      if (e[0] !== "#") return XML_ENTITIES[e.toLowerCase()];
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    });
}

/** Inner XML of the first `<tag>…</tag>` element (null for missing, empty or `nil="true"`). */
function xmlText(xml: string | null, tag: string): string | null {
  if (!xml) return null;
  // Lazy attributes so a self-closing `<tag nil="true"/>` never swallows a later `</tag>`.
  const m = new RegExp(`<${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${tag}>)`).exec(xml);
  if (!m || /\bnil="(true|nil)"/.test(m[1] ?? "")) return null;
  const v = decodeXml(m[2] ?? "").trim();
  return v || null;
}

/** Site currency from the webhook URL's `currency` query parameter; USD when absent. */
export function recurlyCurrency(url: string): string {
  let c = "";
  try {
    c = (new URL(url).searchParams.get("currency") ?? "").trim().toUpperCase();
  } catch {
    // fall through to USD
  }
  return /^[A-Z]{3}$/.test(c) ? c : "USD";
}

export function recurlyXmlToEvents(rawBody: string, currency: string): RevenueEventInput[] {
  const root = /^\s*(?:<\?xml[^>]*\?>\s*)?<([a-z_]+)[\s>]/i.exec(rawBody)?.[1];
  if (root !== "successful_payment_notification" && root !== "successful_refund_notification" && root !== "void_payment_notification") return [];
  const account = xmlText(rawBody, "account");
  const txn = xmlText(rawBody, "transaction");
  const id = xmlText(txn, "id");
  const amountMinor = intMinor(xmlText(txn, "amount_in_cents"));
  const status = xmlText(txn, "status");
  if (!id || !amountMinor || status !== (root === "void_payment_notification" ? "void" : "success")) return [];

  const name = [xmlText(account, "first_name"), xmlText(account, "last_name")].filter(Boolean).join(" ");
  const customer: RevenueEventInput["customer"] = {
    email: xmlText(account, "email"),
    name: name || xmlText(account, "company_name"),
    phone: xmlText(account, "phone"),
    externalCustomerId: xmlText(account, "account_code"),
  };
  const occurredAt = toDate(xmlText(txn, "date"));
  const action = xmlText(txn, "action");

  if (root === "successful_payment_notification") {
    if (action !== "purchase" && action !== "capture") return [];
    return [{ type: "payment", externalId: id, amountMinor, currency, occurredAt, customer }];
  }
  if (root === "void_payment_notification") {
    // A void cancels a captured payment before it settles; the transaction id is the payment's.
    if (action !== "purchase" && action !== "capture") return [];
    return [{ type: "refund", externalId: `void:${id}`, relatedExternalId: id, amountMinor, currency, occurredAt: new Date(), customer }];
  }
  if (action !== "credit" && action !== "refund") return [];
  // The notification does not name the refunded transaction, so the refund is matched to the
  // customer (email / account code) but not linked to a specific payment.
  return [{ type: "refund", externalId: id, relatedExternalId: null, amountMinor, currency, occurredAt, customer }];
}

export const recurlyConnector: RevenueConnector = {
  source: "recurly",
  meta: {
    provider: "recurly",
    name: "Recurly",
    category: "revenue",
    description: "Subscription payments and refunds from Recurly via XML webhook notifications.",
    status: "beta",
    color: "#7b3fe4",
    docsUrl: "https://docs.recurly.com/recurly-subscriptions/docs/webhooks",
    fields: [
      { name: "webhookUsername", label: "Webhook username", hint: "The HTTP auth username you set on the Recurly endpoint." },
      { name: "webhookPassword", label: "Webhook password", secret: true, hint: "The HTTP auth password you set on the Recurly endpoint (use a long random value)." },
    ],
    steps: [
      "In Recurly go to Integrations → Webhooks → Configure → New Endpoint and paste the webhook URL shown in AdLedger. Choose the XML format.",
      "Set an HTTP Auth username and a long random password on the endpoint and paste both here. The URL ends in `?currency=` with your reporting currency; change it to your Recurly site's currency code if that differs, because Recurly's XML omits it.",
      "Make sure the `Successful Payment`, `Successful Refund` and `Void Payment` notifications are enabled, then save.",
      "Buyers are matched to ad clicks by the account email, so use the same email in Recurly as in your signup form. Try it on your free Recurly sandbox site first.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyBasicAuth(req.headers, conn.config.webhookUsername, conn.secrets.webhookPassword);
  },
  parseWebhook(_payload: unknown, req: WebhookRequest) {
    return recurlyXmlToEvents(req.rawBody, recurlyCurrency(req.url));
  },
};
