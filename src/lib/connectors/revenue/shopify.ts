import { fromDecimalString } from "../../money";
import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { arr, fetchJson, obj, str, toDate, verifyHmac, type Json } from "./shared";

// Shopify: `orders/paid` -> payment, `refunds/create` -> refund.
// Webhooks are signed with X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(rawBody, secret)), where the
// secret is the app's client secret, or the signing key shown under Settings → Notifications → Webhooks
// for webhooks created in the Shopify admin.
// https://shopify.dev/docs/apps/build/webhooks/subscribe/https

const ADMIN_API_VERSION = "2026-07";
const VID_KEYS = new Set(["adledger_vid", "_adledger_vid"]);

type Money = { amount: string; currency: string };

/** Order money in the currency the buyer paid (presentment), falling back to shop currency. */
function orderTotal(o: Json): Money | null {
  const pm = obj(obj(o.total_price_set)?.presentment_money);
  const amount = str(pm?.amount);
  const currency = str(pm?.currency_code);
  if (amount && currency) return { amount, currency };
  // total_price is the original charge; current_total_price already has refunds taken off,
  // which would double-count against the separate refund events.
  const total = str(o.total_price) ?? str(o.current_total_price);
  const cur = str(o.presentment_currency) ?? str(o.currency);
  return total && cur ? { amount: total, currency: cur } : null;
}

function visitorId(attrs: unknown): string | null {
  for (const a of arr(attrs)) {
    const kv = obj(a);
    const key = str(kv?.name) ?? str(kv?.key);
    if (key && VID_KEYS.has(key)) return str(kv?.value);
  }
  return null;
}

function customerOf(o: Json): RevenueEventInput["customer"] {
  const c = obj(o.customer);
  const billing = obj(o.billing_address);
  const name = [str(c?.first_name), str(c?.last_name)].filter(Boolean).join(" ") || str(billing?.name);
  return {
    email: str(o.email) ?? str(o.contact_email) ?? str(c?.email),
    name: name || null,
    phone: str(o.phone) ?? str(c?.phone) ?? str(billing?.phone),
    visitorId: visitorId(o.note_attributes),
    externalCustomerId: str(c?.id),
  };
}

const PAID_STATUSES = new Set(["paid", "partially_refunded", "refunded"]);

/** A Shopify order (webhook/REST shape) -> payment event. */
export function shopifyOrderToEvents(order: unknown): RevenueEventInput[] {
  const o = obj(order);
  const id = str(o?.id);
  if (!o || !id) return [];
  const status = str(o.financial_status);
  if (status && !PAID_STATUSES.has(status)) return [];
  const total = orderTotal(o);
  if (!total) return [];
  const amountMinor = fromDecimalString(total.amount, total.currency);
  if (amountMinor <= 0) return [];
  return [
    {
      type: "payment",
      externalId: id,
      amountMinor,
      currency: total.currency.toUpperCase(),
      occurredAt: toDate(o.processed_at ?? o.created_at),
      customer: customerOf(o),
    },
  ];
}

/** A Shopify refund (refunds/create payload) -> refund event (sum of successful refund transactions). */
export function shopifyRefundToEvents(refund: unknown): RevenueEventInput[] {
  const r = obj(refund);
  const id = str(r?.id);
  const orderId = str(r?.order_id);
  if (!r || !id || !orderId) return [];
  let amountMinor = 0;
  let currency: string | null = null;
  for (const t of arr(r.transactions)) {
    const tx = obj(t);
    if (!tx || str(tx.kind) !== "refund" || str(tx.status) !== "success") continue;
    const cur = str(tx.currency);
    const amount = str(tx.amount);
    if (!cur || !amount) continue;
    currency ??= cur.toUpperCase();
    amountMinor += fromDecimalString(amount, cur);
  }
  if (!currency || amountMinor <= 0) return []; // e.g. restock-only refunds move no money
  return [
    {
      type: "refund",
      externalId: `refund:${id}`,
      relatedExternalId: orderId,
      amountMinor,
      currency,
      occurredAt: toDate(r.processed_at ?? r.created_at),
      customer: {},
    },
  ];
}

// ---- backfill via the GraphQL Admin API (REST Admin is legacy)

const ORDERS_QUERY = `query AdLedgerOrders($cursor: String, $q: String) {
  orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId email phone createdAt processedAt displayFinancialStatus
      totalPriceSet { presentmentMoney { amount currencyCode } }
      customAttributes { key value }
      customer { legacyResourceId firstName lastName }
      refunds { legacyResourceId createdAt totalRefundedSet { presentmentMoney { amount currencyCode } } }
    }
  }
}`;

type GqlMoney = { presentmentMoney?: { amount: string; currencyCode: string } | null } | null;
type GqlOrder = {
  legacyResourceId: string;
  email?: string | null;
  phone?: string | null;
  createdAt: string;
  processedAt?: string | null;
  displayFinancialStatus?: string | null;
  totalPriceSet?: GqlMoney;
  customAttributes?: { key: string; value: string | null }[];
  customer?: { legacyResourceId: string; firstName?: string | null; lastName?: string | null } | null;
  refunds?: { legacyResourceId: string; createdAt: string; totalRefundedSet?: GqlMoney }[];
};

export function shopDomain(raw: string | undefined): string {
  const d = (raw ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  const full = d.includes(".") ? d : d ? `${d}.myshopify.com` : "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(full)) throw new Error("Shop domain must look like your-store.myshopify.com");
  return full;
}

async function adminToken(conn: ConnectionLike, shop: string): Promise<string> {
  if (conn.secrets.accessToken) return conn.secrets.accessToken;
  const clientId = conn.config.clientId;
  const clientSecret = conn.secrets.clientSecret;
  if (!clientId || !clientSecret) throw new Error("Add an Admin API access token, or the app's client ID and secret, to import order history");
  // Client credentials grant (Dev Dashboard apps installed on a store in the same organization).
  const { body } = await fetchJson<{ access_token?: string }>(
    `https://${shop}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }).toString(),
    },
    "Shopify token request",
  );
  if (!body.access_token) throw new Error("Shopify did not return an access token");
  return body.access_token;
}

export function shopifyGqlOrderToEvents(n: GqlOrder): RevenueEventInput[] {
  const status = (n.displayFinancialStatus ?? "").toLowerCase();
  const money = n.totalPriceSet?.presentmentMoney;
  const order: Json = {
    id: n.legacyResourceId,
    email: n.email,
    phone: n.phone,
    created_at: n.createdAt,
    processed_at: n.processedAt,
    financial_status: status,
    total_price_set: money ? { presentment_money: { amount: money.amount, currency_code: money.currencyCode } } : null,
    note_attributes: (n.customAttributes ?? []).map((a) => ({ name: a.key, value: a.value })),
    customer: n.customer ? { id: n.customer.legacyResourceId, first_name: n.customer.firstName, last_name: n.customer.lastName } : null,
  };
  const events = shopifyOrderToEvents(order);
  if (!events.length) return events;
  for (const r of n.refunds ?? []) {
    const m = r.totalRefundedSet?.presentmentMoney;
    if (!m) continue;
    const amountMinor = fromDecimalString(m.amount, m.currencyCode);
    if (amountMinor <= 0) continue;
    events.push({
      type: "refund",
      externalId: `refund:${r.legacyResourceId}`,
      relatedExternalId: n.legacyResourceId,
      amountMinor,
      currency: m.currencyCode.toUpperCase(),
      occurredAt: toDate(r.createdAt),
      customer: {},
    });
  }
  return events;
}

type OrdersResponse = {
  data?: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlOrder[] } };
  errors?: { message: string }[];
};

async function fetchOrdersPage(shop: string, token: string, cursor: string | null, q: string): Promise<OrdersResponse> {
  const { body } = await fetchJson<OrdersResponse>(
    `https://${shop}/admin/api/${ADMIN_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: ORDERS_QUERY, variables: { cursor, q } }),
    },
    "Shopify orders query",
  );
  return body;
}

async function backfill(conn: ConnectionLike, opts: { sinceMs: number }): Promise<RevenueEventInput[]> {
  const shop = shopDomain(conn.config.shopDomain);
  const token = await adminToken(conn, shop);
  const q = `created_at:>='${new Date(opts.sinceMs).toISOString()}'`;
  const out: RevenueEventInput[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 500; page++) {
    const body = await fetchOrdersPage(shop, token, cursor, q);
    if (body.errors?.length || !body.data) throw new Error(`Shopify orders query failed: ${body.errors?.map((e) => e.message).join("; ") ?? "no data"}`);
    for (const n of body.data.orders.nodes) out.push(...shopifyGqlOrderToEvents(n));
    const info = body.data.orders.pageInfo;
    if (!info.hasNextPage || !info.endCursor) break;
    cursor = info.endCursor;
  }
  return out;
}

export const shopifyConnector: RevenueConnector = {
  source: "shopify",
  meta: {
    provider: "shopify",
    name: "Shopify",
    category: "revenue",
    description: "Paid orders and refunds from your Shopify store via webhooks, plus an optional order-history import.",
    status: "beta",
    color: "#95bf47",
    docsUrl: "https://help.shopify.com/en/manual/fulfillment/setup/notifications/webhooks",
    fields: [
      { name: "shopDomain", label: "Store domain", placeholder: "your-store.myshopify.com" },
      {
        name: "webhookSecret",
        label: "Webhook signing secret",
        secret: true,
        hint: "Shown under Settings → Notifications → Webhooks (\"Your webhooks will be signed with…\"), or your app's client secret.",
      },
      { name: "accessToken", label: "Admin API access token", secret: true, optional: true, placeholder: "shpat_…", hint: "Optional, for importing past orders (needs read_orders)." },
      { name: "clientId", label: "App client ID", optional: true, hint: "Optional alternative to the access token for Dev Dashboard apps." },
      { name: "clientSecret", label: "App client secret", secret: true, optional: true },
    ],
    steps: [
      "In Shopify admin go to Settings → Notifications → Webhooks and click Create webhook.",
      "Add two webhooks in JSON format pointing to the webhook URL shown in AdLedger: event `Order payment` (orders/paid) and `Refund create` (refunds/create).",
      "Copy the signing secret shown under the webhook list and paste it here. To link buyers to ad clicks, have your theme save `adledger.getVisitorId()` as the cart attribute `adledger_vid`.",
      "Optional: to import past orders, create an app in the Shopify Dev Dashboard with the `read_orders` scope and paste its token (or client ID and secret). A free development store is the easiest way to test.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyHmac(req.rawBody, conn.secrets.webhookSecret, req.headers.get("x-shopify-hmac-sha256"), "base64");
  },
  parseWebhook(payload: unknown, req: WebhookRequest) {
    const topic = (req.headers.get("x-shopify-topic") ?? "").toLowerCase();
    if (topic === "orders/paid") return shopifyOrderToEvents(payload);
    if (topic === "refunds/create") return shopifyRefundToEvents(payload);
    return [];
  },
  backfill,
};
