import type { ConnectionLike, RevenueEventInput, WebhookRequest } from "../types";
import { arr, hmacSha256, obj, safeEqual, str, type Json } from "../revenue/shared";
import { chunks, currencyCode, dealAmountMinor, fetchJsonRetry, utcDate, wrongWebhookUrl, type CrmConnector } from "./shared";

// HubSpot: closed-won deals -> payments (externalId = deal id), matched through the deal's
// associated contact (email, then HubSpot contact id).
// Auth: private app access token (scopes crm.objects.deals.read + crm.objects.contacts.read).
// Backfill: CRM search on hs_is_closed_won (covers every pipeline, not just the default
// `closedwon` stage), then v4 association + contact batch reads.
// Webhooks (optional): X-HubSpot-Signature-v3 = base64(HMAC-SHA256(client secret,
// method + uri + body + timestamp)), timestamp in X-HubSpot-Request-Timestamp (ms, max 5 min old).
// Webhook events only carry ids, so the CRM webhook route re-reads the deals with `fetchDeals`.
// https://developers.hubspot.com/docs/api/crm/deals
// https://developers.hubspot.com/docs/api/webhooks/validating-requests

const API = "https://api.hubapi.com";
const DEAL_PROPS = ["dealname", "amount", "closedate", "dealstage", "pipeline", "deal_currency_code", "hs_is_closed_won"];
const CONTACT_PROPS = ["email", "firstname", "lastname", "phone", "adledger_vid"];
const SEARCH_CAP = 10_000; // HubSpot's search API stops paging at 10k results per query
const MAX_AGE_MS = 5 * 60 * 1000;

type HsObject = { id: string; properties: Json; createdAt?: unknown; updatedAt?: unknown };
type HsContact = { id: string; properties: Json };

function hsObject(v: unknown): HsObject | null {
  const o = obj(v);
  const id = str(o?.id);
  return o && id ? { id, properties: obj(o.properties) ?? {}, createdAt: o.createdAt, updatedAt: o.updatedAt } : null;
}

function isWon(p: Json): boolean {
  return str(p.hs_is_closed_won) === "true" || str(p.dealstage) === "closedwon";
}

/** A HubSpot deal (+ its chosen contact) -> a payment, or null when not won / no usable amount. */
export function hubspotDealToEvent(deal: unknown, contact: HsContact | null, defaultCurrency?: string): RevenueEventInput | null {
  const d = hsObject(deal);
  if (!d || !isWon(d.properties)) return null;
  const currency = currencyCode(d.properties.deal_currency_code) ?? currencyCode(defaultCurrency) ?? "USD";
  const amountMinor = dealAmountMinor(d.properties.amount, currency);
  if (amountMinor === null) return null;
  const c = contact?.properties ?? {};
  const name = [str(c.firstname), str(c.lastname)].filter(Boolean).join(" ");
  return {
    type: "payment",
    externalId: d.id,
    amountMinor,
    currency,
    occurredAt: utcDate(d.properties.closedate) ?? utcDate(d.updatedAt) ?? new Date(),
    customer: {
      email: str(c.email),
      name: name || null,
      phone: str(c.phone),
      visitorId: str(c.adledger_vid),
      externalCustomerId: contact?.id ?? null,
    },
  };
}

function token(conn: ConnectionLike): string {
  const t = conn.secrets.accessToken;
  if (!t) throw new Error("HubSpot private app access token is missing");
  return t;
}

async function hsPost<T = Json>(tok: string, path: string, body: unknown, what: string): Promise<T> {
  return fetchJsonRetry<T>(
    `${API}${path}`,
    { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify(body) },
    what,
  );
}

async function searchWonDeals(tok: string, sinceMs: number): Promise<HsObject[]> {
  const seen = new Map<string, HsObject>();
  let from = sinceMs;
  for (let round = 0; round < 100; round++) {
    let after: string | undefined;
    let last = from;
    let count = 0;
    let capped = false;
    for (;;) {
      const body = await hsPost(
        tok,
        "/crm/v3/objects/deals/search",
        {
          filterGroups: [
            {
              filters: [
                { propertyName: "hs_is_closed_won", operator: "EQ", value: "true" },
                { propertyName: "closedate", operator: "GTE", value: String(from) },
              ],
            },
          ],
          properties: DEAL_PROPS,
          sorts: [{ propertyName: "closedate", direction: "ASCENDING" }],
          limit: 100,
          ...(after ? { after } : {}),
        },
        "HubSpot deal search",
      );
      for (const r of arr(obj(body)?.results)) {
        count++;
        const d = hsObject(r);
        if (!d) continue;
        seen.set(d.id, d);
        const t = utcDate(d.properties.closedate)?.getTime();
        if (t && t > last) last = t;
      }
      after = str(obj(obj(obj(body)?.paging)?.next)?.after) ?? undefined;
      // HubSpot won't page past 10k results, and may simply stop offering a next page there.
      if (count >= SEARCH_CAP || (after && Number(after) >= SEARCH_CAP)) {
        capped = true;
        break;
      }
      if (!after) break;
    }
    // Past 10k results: restart from the last close date seen (ids are de-duplicated).
    if (!capped || last <= from) break;
    from = last;
  }
  return [...seen.values()];
}

async function readDeals(tok: string, ids: string[]): Promise<HsObject[]> {
  const out: HsObject[] = [];
  for (const batch of chunks(ids, 100)) {
    const body = await hsPost(tok, "/crm/v3/objects/deals/batch/read", { properties: DEAL_PROPS, inputs: batch.map((id) => ({ id })) }, "HubSpot deal read");
    for (const r of arr(obj(body)?.results)) {
      const d = hsObject(r);
      if (d) out.push(d);
    }
  }
  return out;
}

/** deal id -> associated contact ids, in HubSpot's order. */
async function dealContacts(tok: string, dealIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const batch of chunks(dealIds, 100)) {
    const body = await hsPost(tok, "/crm/v4/associations/deals/contacts/batch/read", { inputs: batch.map((id) => ({ id })) }, "HubSpot deal associations read");
    for (const r of arr(obj(body)?.results)) {
      const o = obj(r);
      const from = str(obj(o?.from)?.id);
      if (!from) continue;
      const to = arr(o?.to)
        .map((t) => str(obj(t)?.toObjectId))
        .filter((x): x is string => Boolean(x));
      map.set(from, to);
    }
  }
  return map;
}

async function readContacts(tok: string, ids: string[]): Promise<Map<string, HsContact>> {
  const map = new Map<string, HsContact>();
  for (const batch of chunks(ids, 100)) {
    const body = await hsPost(tok, "/crm/v3/objects/contacts/batch/read", { properties: CONTACT_PROPS, inputs: batch.map((id) => ({ id })) }, "HubSpot contact read");
    for (const r of arr(obj(body)?.results)) {
      const c = hsObject(r);
      if (c) map.set(c.id, { id: c.id, properties: c.properties });
    }
  }
  return map;
}

/** Won deals -> payments, attaching the first associated contact that has an email. */
async function toEvents(tok: string, deals: HsObject[], defaultCurrency?: string): Promise<RevenueEventInput[]> {
  const won = deals.filter((d) => isWon(d.properties));
  if (!won.length) return [];
  const assoc = await dealContacts(tok, won.map((d) => d.id));
  const contacts = await readContacts(tok, [...new Set([...assoc.values()].flat())]);
  const out: RevenueEventInput[] = [];
  for (const d of won) {
    const linked = (assoc.get(d.id) ?? []).map((id) => contacts.get(id)).filter((c): c is HsContact => Boolean(c));
    const contact = linked.find((c) => str(c.properties.email)) ?? linked[0] ?? null;
    const e = hubspotDealToEvent(d, contact, defaultCurrency);
    if (e) out.push(e);
  }
  return out;
}

/** HubSpot's v3 signing decodes these escapes in the URI before hashing. */
function hubspotUri(url: string): string {
  const map: Record<string, string> = { "%3A": ":", "%2F": "/", "%3F": "?", "%40": "@", "%21": "!", "%24": "$", "%27": "'", "%28": "(", "%29": ")", "%2A": "*", "%2C": ",", "%3B": ";" };
  return url.replace(/%(3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi, (m) => map[m.toUpperCase()] ?? m);
}

/** URLs HubSpot may have signed: as received, as seen through a proxy, and under PUBLIC_URL. */
function candidateUrls(req: WebhookRequest): string[] {
  const urls = [req.url];
  try {
    const u = new URL(req.url);
    const tail = `${u.pathname}${u.search}`;
    const host = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    if (host) urls.push(`${proto}://${host}${tail}`);
    if (process.env.PUBLIC_URL) urls.push(`${process.env.PUBLIC_URL.replace(/\/+$/, "")}${tail}`);
  } catch {
    // unparseable request URL: only the raw value is tried
  }
  return [...new Set(urls)];
}

export function verifyHubspotSignature(req: WebhookRequest, clientSecret: string | undefined, method = "POST", now = Date.now()): boolean {
  const sig = req.headers.get("x-hubspot-signature-v3")?.trim();
  const ts = req.headers.get("x-hubspot-request-timestamp")?.trim();
  if (!clientSecret || !sig || !ts || !/^\d+$/.test(ts) || !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) return false;
  if (Math.abs(now - Number(ts)) > MAX_AGE_MS) return false;
  const given = Buffer.from(sig, "base64");
  let ok = false;
  for (const url of candidateUrls(req)) {
    // Evaluate every candidate (no early exit) so timing doesn't depend on which one matched.
    if (safeEqual(hmacSha256(clientSecret, `${method}${hubspotUri(url)}${req.rawBody}${ts}`), given)) ok = true;
  }
  return ok;
}

/** Deal ids from a HubSpot webhook batch (classic `deal.*` or generic `object.*` with objectTypeId 0-3). */
export function hubspotWebhookDealIds(payload: unknown): string[] {
  const ids = new Set<string>();
  for (const e of arr(payload)) {
    const o = obj(e);
    if (!o) continue;
    const type = str(o.subscriptionType) ?? "";
    const isDeal = type.startsWith("deal.") || (type.startsWith("object.") && str(o.objectTypeId) === "0-3");
    if (!isDeal || type.endsWith(".deletion") || type.endsWith(".privacyDeletion")) continue;
    const id = str(o.objectId);
    if (id) ids.add(id);
  }
  return [...ids];
}

export const hubspotConnector: CrmConnector = {
  source: "hubspot",
  meta: {
    provider: "hubspot",
    name: "HubSpot CRM",
    category: "revenue",
    description: "Closed-won deals as revenue for sales-led and lead-gen businesses, matched to ad clicks by contact email.",
    status: "beta",
    color: "#ff7a59",
    docsUrl: "https://developers.hubspot.com/docs/api/crm/deals",
    fields: [
      { name: "accessToken", label: "Private app access token", secret: true, placeholder: "pat-na1-…" },
      { name: "currency", label: "Default currency", optional: true, placeholder: "USD", hint: "Used for deals without a currency of their own (single-currency portals)." },
      { name: "clientSecret", label: "App client secret", secret: true, optional: true, hint: "Optional, only for instant webhooks (the app's Auth tab)." },
    ],
    steps: [
      "In HubSpot open Settings → Integrations → Private Apps (Development → Legacy apps on newer accounts), create an app with the scopes `crm.objects.deals.read` and `crm.objects.contacts.read`, and paste its access token here.",
      "Click Sync: deals marked Closed won in any pipeline from the last 90 days become revenue (amount, close date), linked to ad clicks through the associated contact's email. Deals later moved out of Closed won are not removed.",
      "Optional, for instant updates: in the app's Webhooks tab set the target URL to the webhook URL shown in AdLedger (…/api/v1/webhooks/crm/hubspot/<workspace id>), subscribe to deal creation and `dealstage`/`amount`/`closedate` changes, and paste the app's client secret here.",
      "To try it for free, use a free HubSpot CRM or developer test account: mark a test deal with a contact as Closed won, then sync.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyHubspotSignature(req, conn.secrets.clientSecret);
  },
  // Webhook events carry only ids; the CRM webhook route calls fetchDeals instead. Reaching this
  // means the webhook targets the generic /webhooks/hubspot/ URL: fail so HubSpot's log shows it.
  parseWebhook() {
    throw wrongWebhookUrl("hubspot");
  },
  async backfill(conn: ConnectionLike, opts: { sinceMs: number }) {
    const tok = token(conn);
    return toEvents(tok, await searchWonDeals(tok, opts.sinceMs), conn.config.currency);
  },
  webhookDealIds: hubspotWebhookDealIds,
  async fetchDeals(conn: ConnectionLike, ids: string[]) {
    if (!ids.length) return [];
    const tok = token(conn);
    return toEvents(tok, await readDeals(tok, ids), conn.config.currency);
  },
};
