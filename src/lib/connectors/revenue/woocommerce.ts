import { fromDecimalString } from "../../money";
import type { ConnectionLike, RevenueConnector, RevenueEventInput, WebhookRequest } from "../types";
import { arr, fetchJson, obj, str, toDate, verifyHmac, type Json } from "./shared";

// WooCommerce: order.created / order.updated webhooks carry the full order.
// processing/completed -> payment; refunds[] (or status refunded) -> one cumulative refund per order.
// X-WC-Webhook-Signature = base64(HMAC-SHA256(rawBody, webhook secret)).
// https://woocommerce.github.io/woocommerce-rest-api-docs/#webhooks

const PAID = new Set(["processing", "completed", "refunded"]);

function customerOf(o: Json): RevenueEventInput["customer"] {
  const b = obj(o.billing);
  const name = [str(b?.first_name), str(b?.last_name)].filter(Boolean).join(" ");
  const vid = arr(o.meta_data)
    .map(obj)
    .find((m) => m && (str(m.key) === "adledger_vid" || str(m.key) === "_adledger_vid"));
  const customerId = str(o.customer_id);
  return {
    email: str(b?.email),
    name: name || null,
    phone: str(b?.phone),
    visitorId: vid ? str(vid.value) : null,
    externalCustomerId: customerId && customerId !== "0" ? customerId : null, // 0 = guest checkout
  };
}

/** A WooCommerce order (webhook or REST shape) -> payment + cumulative refund. */
export function wooOrderToEvents(order: unknown): RevenueEventInput[] {
  const o = obj(order);
  const id = str(o?.id);
  const status = str(o?.status);
  const currency = str(o?.currency)?.toUpperCase();
  const total = str(o?.total);
  if (!o || !id || !status || !currency || !total || !PAID.has(status)) return [];
  const customer = customerOf(o);
  const events: RevenueEventInput[] = [];
  const amountMinor = fromDecimalString(total, currency);
  if (amountMinor > 0) {
    events.push({
      type: "payment",
      externalId: id,
      amountMinor,
      currency,
      occurredAt: toDate(o.date_paid_gmt ?? o.date_created_gmt, { assumeUtc: true }),
      customer,
    });
  }
  // Order refund lines carry negative decimal strings, e.g. "-10.00".
  let refunded = 0;
  for (const r of arr(o.refunds)) {
    const t = str(obj(r)?.total);
    if (t) refunded += Math.abs(fromDecimalString(t, currency));
  }
  if (!refunded && status === "refunded") refunded = amountMinor;
  if (refunded > 0) {
    events.push({
      type: "refund",
      // Cumulative per order: partial refunds update the same row.
      externalId: `refunds:${id}`,
      relatedExternalId: id,
      amountMinor: refunded,
      currency,
      occurredAt: toDate(o.date_modified_gmt ?? o.date_paid_gmt, { assumeUtc: true }),
      customer,
    });
  }
  return events;
}

export function wooSiteUrl(raw: string | undefined): string {
  const s = (raw ?? "").trim().replace(/\/+$/, "");
  const url = /^https?:\/\//i.test(s) ? s : s ? `https://${s}` : "";
  try {
    return new URL(url).toString().replace(/\/+$/, "");
  } catch {
    throw new Error("Store URL must look like https://shop.example.com");
  }
}

async function backfill(conn: ConnectionLike, opts: { sinceMs: number }): Promise<RevenueEventInput[]> {
  const site = wooSiteUrl(conn.config.siteUrl);
  const key = conn.secrets.consumerKey;
  const secret = conn.secrets.consumerSecret;
  if (!key || !secret) throw new Error("WooCommerce consumer key and secret are needed to import order history");
  const auth = `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
  const out: RevenueEventInput[] = [];
  for (let page = 1; page <= 1000; page++) {
    const qs = new URLSearchParams({
      after: new Date(opts.sinceMs).toISOString(),
      dates_are_gmt: "true",
      status: "processing,completed,refunded",
      per_page: "100",
      page: String(page),
      orderby: "date",
      order: "asc",
    });
    const { body, res } = await fetchJson<unknown[]>(`${site}/wp-json/wc/v3/orders?${qs}`, { headers: { Authorization: auth } }, "WooCommerce orders request");
    for (const o of arr(body)) out.push(...wooOrderToEvents(o));
    const totalPages = Number(res.headers.get("x-wp-totalpages") ?? "1");
    if (arr(body).length === 0 || page >= totalPages) break;
  }
  return out;
}

export const woocommerceConnector: RevenueConnector = {
  source: "woocommerce",
  meta: {
    provider: "woocommerce",
    name: "WooCommerce",
    category: "revenue",
    description: "Paid orders and refunds from your WordPress store via webhooks, plus an order-history import.",
    status: "beta",
    color: "#7f54b3",
    docsUrl: "https://woocommerce.com/document/webhooks/",
    fields: [
      { name: "siteUrl", label: "Store URL", placeholder: "https://shop.example.com" },
      { name: "webhookSecret", label: "Webhook secret", secret: true, hint: "The Secret you typed when creating the webhooks (use the same one for both)." },
      { name: "consumerKey", label: "REST API consumer key", secret: true, optional: true, placeholder: "ck_…", hint: "Optional, for importing past orders (Read access)." },
      { name: "consumerSecret", label: "REST API consumer secret", secret: true, optional: true, placeholder: "cs_…" },
    ],
    steps: [
      "In WordPress go to WooCommerce → Settings → Advanced → Webhooks → Add webhook.",
      "Create two webhooks, `Order created` and `Order updated`, with Delivery URL set to the webhook URL shown in AdLedger, API version WP REST API v3, and the same Secret; paste that Secret here.",
      "To link buyers to ad clicks, save the visitor id on the order as the meta field `adledger_vid` (a checkout hook or plugin can copy it from the `_al_vid` cookie).",
      "Optional: WooCommerce → Settings → Advanced → REST API → Add key with Read permission, and paste the consumer key and secret to import past orders.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyHmac(req.rawBody, conn.secrets.webhookSecret, req.headers.get("x-wc-webhook-signature"), "base64");
  },
  parseWebhook(payload: unknown, req: WebhookRequest) {
    const topic = (req.headers.get("x-wc-webhook-topic") ?? "").toLowerCase();
    if (topic !== "order.created" && topic !== "order.updated") return [];
    return wooOrderToEvents(payload);
  },
  backfill,
};
