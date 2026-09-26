import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { intMinor, obj, str, toDate } from "./shared";
import { verifyUrlToken } from "./webhook-auth";

// Gumroad: Ping and the `sale` / `refund` resource subscriptions POST the sale, as an
// x-www-form-urlencoded body by default or as JSON when the seller picked that content type.
// `price` is the amount paid in USD cents (Gumroad converts; the payload's `currency` is only the
// product's display currency, so it is ignored). `refunded` is true only for a full refund, so a
// refund post yields a full refund of the sale; partial refunds are not reported in the payload.
// Pings are not signed; the endpoint is protected by a secret `?token=` in the ping URL.
// https://gumroad.com/ping  https://gumroad.com/api#resource-subscriptions

const truthy = (v: string | null) => v === "true" || v === "1";

/** Field reader over either body format; nested keys use the form spelling, e.g. `url_params[x]`. */
function gumroadFields(rawBody: string): (key: string) => string | null {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith("{")) {
    let json: Record<string, unknown> | null = null;
    try {
      json = obj(JSON.parse(trimmed));
    } catch {
      json = null;
    }
    return (key) => {
      const nested = /^(\w+)\[(\w+)\]$/.exec(key);
      const v = nested ? obj(json?.[nested[1]])?.[nested[2]] : json?.[key];
      return typeof v === "boolean" ? String(v) : str(v);
    };
  }
  const form = new URLSearchParams(rawBody);
  return (key) => form.get(key)?.trim() || null;
}

export function gumroadPingToEvents(rawBody: string): RevenueEventInput[] {
  const get = gumroadFields(rawBody);
  const saleId = get("sale_id");
  const amountMinor = intMinor(get("price"));
  // Pre-order authorizations only hold the card; the charge arrives later as its own sale.
  if (!saleId || !amountMinor || truthy(get("is_preorder_authorization"))) return [];

  const currency = "USD";
  const customer: RevenueEventInput["customer"] = {
    email: get("email"),
    name: get("full_name"),
    visitorId: get("url_params[adledger_vid]"),
    externalCustomerId: get("purchaser_id"),
  };
  const payment: RevenueEventInput = { type: "payment", externalId: saleId, amountMinor, currency, occurredAt: toDate(get("sale_timestamp")), customer };
  const refundPost = get("resource_name") === "refund";
  if (!truthy(get("refunded"))) return refundPost ? [] : [payment];
  const refund: RevenueEventInput = {
    type: "refund",
    externalId: `refund:${saleId}`,
    relatedExternalId: saleId,
    amountMinor,
    currency,
    // The payload carries no refund timestamp; it is posted when the refund happens.
    occurredAt: new Date(),
    customer,
  };
  // A refund post only adds the refund (re-sending the payment would re-fire payment alerts); a
  // sale post or test ping of an already refunded sale records both.
  return refundPost ? [refund] : [payment, refund];
}

export const gumroadConnector: RevenueConnector = {
  source: "gumroad",
  meta: {
    provider: "gumroad",
    name: "Gumroad",
    category: "revenue",
    description: "Sales, membership charges and refunds from Gumroad via Ping.",
    status: "beta",
    color: "#ff90e8",
    docsUrl: "https://gumroad.com/api#resource-subscriptions",
    fields: [
      { name: "webhookToken", label: "Ping token", secret: true, hint: "A long random value; add it to the ping URL as ?token=… (Gumroad pings are not signed)." },
      { name: "sellerId", label: "Seller ID", optional: true, hint: "Optional: your Gumroad seller_id; pings for any other seller are rejected." },
    ],
    steps: [
      "Choose a long random Ping token and paste it here. Your ping URL is the webhook URL shown in AdLedger with `YOUR_PING_TOKEN` replaced by that token.",
      "In Gumroad go to Settings → Advanced → Ping, paste that ping URL, save, and click `Send test ping to URL` to check it (it re-sends your latest sale).",
      "To also receive refunds, subscribe the same URL to the `refund` resource: `curl -X PUT https://api.gumroad.com/v2/resource_subscriptions -d access_token=… -d resource_name=refund -d post_url=<ping URL>`.",
      "To link buyers to ad clicks, add `?adledger_vid=<visitor id>` (from `adledger.getVisitorId()`) to your Gumroad product links; Gumroad passes it back in `url_params`.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    if (!verifyUrlToken(req.url, conn.secrets.webhookToken)) return false;
    const seller = conn.config.sellerId?.trim();
    return !seller || gumroadFields(req.rawBody)("seller_id") === seller;
  },
  parseWebhook(_payload: unknown, req: WebhookRequest) {
    return gumroadPingToEvents(req.rawBody);
  },
};
