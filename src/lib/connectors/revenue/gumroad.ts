import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { intMinor, toDate } from "./shared";
import { verifyUrlToken } from "./webhook-auth";

// Gumroad: Ping and the `sale` / `refund` resource subscriptions POST the sale as an
// x-www-form-urlencoded body. `price` is the amount paid in USD cents. A refund re-sends the sale
// with `refunded=true`, so it yields the payment (idempotent) plus a full refund of it.
// Pings are not signed; the endpoint is protected by a secret `?token=` in the ping URL.
// https://gumroad.com/api#resource-subscriptions  https://gumroad.com/ping

const truthy = (v: string | null) => v === "true" || v === "1";

export function gumroadPingToEvents(rawBody: string): RevenueEventInput[] {
  const f = new URLSearchParams(rawBody);
  const get = (k: string) => f.get(k)?.trim() || null;
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
  const occurredAt = toDate(get("sale_timestamp"));
  const events: RevenueEventInput[] = [{ type: "payment", externalId: saleId, amountMinor, currency, occurredAt, customer }];
  if (truthy(get("refunded"))) {
    events.push({
      type: "refund",
      externalId: `refund:${saleId}`,
      relatedExternalId: saleId,
      amountMinor,
      currency,
      // The ping carries no refund timestamp; it arrives when the refund happens.
      occurredAt: new Date(),
      customer,
    });
  }
  return events;
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
      "Choose a long random Ping token and paste it here. Your ping URL is the webhook URL shown in AdLedger followed by `?token=<your token>`.",
      "In Gumroad go to Settings → Advanced → Ping, paste that ping URL, save, and click `Send test ping to URL` to check it.",
      "To also receive refunds, subscribe the same URL to the `refund` resource: `curl -X PUT https://api.gumroad.com/v2/resource_subscriptions -d access_token=… -d resource_name=refund -d post_url=<ping URL>`.",
      "To link buyers to ad clicks, add `?adledger_vid=<visitor id>` (from `adledger.getVisitorId()`) to your Gumroad product links; Gumroad passes it back in `url_params`.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    if (!verifyUrlToken(req.url, conn.secrets.webhookToken)) return false;
    const seller = conn.config.sellerId?.trim();
    return !seller || new URLSearchParams(req.rawBody).get("seller_id") === seller;
  },
  parseWebhook(_payload: unknown, req: WebhookRequest) {
    return gumroadPingToEvents(req.rawBody);
  },
};
