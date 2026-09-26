import type { ConnectionLike, RevenueEventInput, WebhookRequest } from "../types";
import { arr, fetchJson, obj, str, type Json } from "../revenue/shared";
import { chunks, currencyCode, dealAmountMinor, safeEqualStrings, utcDate, type CrmConnector } from "./shared";

// Pipedrive: won deals -> payments (externalId = deal id), matched through the deal's person
// (primary email, then Pipedrive person id).
// Auth: personal API token, sent as the `x-api-token` header (never in the URL).
// Backfill: API v2 GET /deals?status=won&updated_since=… (cursor pages), then /persons?ids=….
// Webhooks (optional): Pipedrive signs nothing; the webhook's HTTP auth username/password arrive
// as Basic auth and are compared in constant time. Payloads (v1 `current`/`meta.object`, v2
// `data`/`meta.entity`) only name the deal; the CRM webhook route re-reads it with `fetchDeals`.
// https://developers.pipedrive.com/docs/api/v1/Deals
// https://pipedrive.readme.io/docs/guide-for-webhooks-v2

export function pipedriveBaseUrl(domain: string | undefined): string {
  const d = (domain ?? "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/\.pipedrive\.com$/i, "")
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(d)) throw new Error("Pipedrive company domain must look like `yourcompany` (from yourcompany.pipedrive.com)");
  return `https://${d}.pipedrive.com/api/v2`;
}

/** Primary (else first) value of a Pipedrive email/phone list (v2 `emails`, v1 `email`). */
function primary(list: unknown): string | null {
  const items = arr(list).map(obj).filter((x): x is Json => Boolean(x && str(x.value)));
  return str((items.find((x) => x.primary === true) ?? items[0])?.value);
}

type Person = { id: string; name: string | null; email: string | null; phone: string | null };

function toPerson(v: unknown): Person | null {
  const p = obj(v);
  const id = str(p?.id) ?? str(p?.value); // v1 embeds the person as { value: id, name, email: [...] }
  if (!p || !id) return null;
  return { id, name: str(p.name), email: primary(p.emails ?? p.email), phone: primary(p.phones ?? p.phone) };
}

function personIdOf(deal: Json): string | null {
  return str(deal.person_id) ?? str(obj(deal.person_id)?.value);
}

/** A Pipedrive deal (v1 or v2 shape) + its person -> a payment, or null when not won / no amount. */
export function pipedriveDealToEvent(deal: unknown, person: Person | null): RevenueEventInput | null {
  const d = obj(deal);
  const id = str(d?.id);
  const currency = currencyCode(d?.currency);
  if (!d || !id || str(d.status) !== "won" || !currency) return null;
  const amountMinor = dealAmountMinor(d.value, currency);
  if (amountMinor === null) return null;
  const p = person ?? toPerson(d.person_id); // v1 list responses embed the person
  return {
    type: "payment",
    externalId: id,
    amountMinor,
    currency,
    occurredAt: utcDate(d.won_time) ?? utcDate(d.close_time) ?? utcDate(d.update_time) ?? new Date(),
    customer: {
      email: p?.email ?? null,
      name: p?.name ?? null,
      phone: p?.phone ?? null,
      visitorId: null,
      externalCustomerId: p?.id ?? personIdOf(d),
    },
  };
}

function client(conn: ConnectionLike) {
  const base = pipedriveBaseUrl(conn.config.companyDomain);
  const tok = conn.secrets.apiToken;
  if (!tok) throw new Error("Pipedrive API token is missing");
  return async (path: string, params: Record<string, string>, what: string) => {
    const qs = new URLSearchParams(params);
    const { body } = await fetchJson<Json>(`${base}${path}?${qs}`, { headers: { "x-api-token": tok } }, what);
    return body;
  };
}

type Get = ReturnType<typeof client>;

async function readPersons(get: Get, ids: string[]): Promise<Map<string, Person>> {
  const map = new Map<string, Person>();
  for (const batch of chunks(ids, 100)) {
    const body = await get("/persons", { ids: batch.join(","), limit: "100" }, "Pipedrive persons request");
    for (const r of arr(body.data)) {
      const p = toPerson(r);
      if (p) map.set(p.id, p);
    }
  }
  return map;
}

async function toEvents(get: Get, deals: Json[]): Promise<RevenueEventInput[]> {
  const won = deals.filter((d) => str(d.status) === "won");
  const personIds = [...new Set(won.map(personIdOf).filter((x): x is string => Boolean(x)))];
  const persons = personIds.length ? await readPersons(get, personIds) : new Map<string, Person>();
  const out: RevenueEventInput[] = [];
  for (const d of won) {
    const pid = personIdOf(d);
    const e = pipedriveDealToEvent(d, pid ? (persons.get(pid) ?? null) : null);
    if (e) out.push(e);
  }
  return out;
}

async function backfill(conn: ConnectionLike, opts: { sinceMs: number }): Promise<RevenueEventInput[]> {
  const get = client(conn);
  const deals: Json[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 1000; page++) {
    const params: Record<string, string> = {
      status: "won",
      // A deal's update_time is never before its won_time, so this can't miss a deal won since then.
      updated_since: new Date(opts.sinceMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
      sort_by: "update_time",
      sort_direction: "asc",
      limit: "500",
    };
    if (cursor) params.cursor = cursor;
    const body = await get("/deals", params, "Pipedrive deals request");
    for (const r of arr(body.data)) {
      const d = obj(r);
      const won = d ? utcDate(d.won_time) : null;
      if (d && (!won || won.getTime() >= opts.sinceMs)) deals.push(d);
    }
    cursor = str(obj(body.additional_data)?.next_cursor);
    if (!cursor) break;
  }
  return toEvents(get, deals);
}

/** Deal id from a v1 or v2 Pipedrive webhook, unless it's a delete or the deal is clearly not won. */
export function pipedriveWebhookDealIds(payload: unknown): string[] {
  const p = obj(payload);
  const meta = obj(p?.meta);
  if (!p || !meta) return [];
  const entity = str(meta.entity) ?? str(meta.object);
  const action = str(meta.action) ?? "";
  if (entity !== "deal" || /^delete/.test(action)) return [];
  const current = obj(p.data) ?? obj(p.current);
  const status = str(current?.status);
  if (status && status !== "won") return [];
  const id = str(meta.entity_id) ?? str(meta.id) ?? str(current?.id);
  return id ? [id] : [];
}

export function verifyPipedriveBasicAuth(req: WebhookRequest, user: string | undefined, password: string | undefined): boolean {
  const header = req.headers.get("authorization")?.trim();
  if (!password || !header || !/^basic\s+/i.test(header)) return false;
  const expected = Buffer.from(`${user ?? ""}:${password}`, "utf8").toString("base64");
  return safeEqualStrings(header.replace(/^basic\s+/i, ""), expected);
}

export const pipedriveConnector: CrmConnector = {
  source: "pipedrive",
  meta: {
    provider: "pipedrive",
    name: "Pipedrive",
    category: "revenue",
    description: "Won deals as revenue for sales-led and lead-gen businesses, matched to ad clicks by the person's email.",
    status: "beta",
    color: "#017737",
    docsUrl: "https://developers.pipedrive.com/docs/api/v1/Deals",
    fields: [
      { name: "companyDomain", label: "Company domain", placeholder: "yourcompany", hint: "The part before .pipedrive.com in your Pipedrive address." },
      { name: "apiToken", label: "API token", secret: true },
      { name: "webhookUser", label: "Webhook username", optional: true, hint: "Optional, only for instant webhooks." },
      { name: "webhookPassword", label: "Webhook password", secret: true, optional: true },
    ],
    steps: [
      "In Pipedrive open your profile → Personal preferences → API, copy your personal API token and paste it here with your company domain (the `yourcompany` in yourcompany.pipedrive.com).",
      "Click Sync: deals marked Won in the last 90 days become revenue (value, currency, won time), linked to ad clicks through the deal's person email. Deals later reopened or lost are not removed.",
      "Optional, for instant updates: Tools and apps → Webhooks → Create new webhook for object `deal`, endpoint = the webhook URL shown in AdLedger with `crm/` added after `/webhooks/` (…/api/v1/webhooks/crm/pipedrive/<workspace id>), and an HTTP auth username and password that you also enter here.",
      "To try it for free, use a Pipedrive free trial or a free developer sandbox account (developers.pipedrive.com): mark a test deal with a person as Won, then sync.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyPipedriveBasicAuth(req, conn.config.webhookUser, conn.secrets.webhookPassword);
  },
  // Webhook payloads only name the deal; the CRM webhook route calls fetchDeals instead.
  parseWebhook() {
    return [];
  },
  backfill,
  webhookDealIds: pipedriveWebhookDealIds,
  async fetchDeals(conn: ConnectionLike, ids: string[]) {
    if (!ids.length) return [];
    const get = client(conn);
    const deals: Json[] = [];
    for (const batch of chunks(ids, 100)) {
      const body = await get("/deals", { ids: batch.join(","), limit: "100" }, "Pipedrive deals request");
      for (const r of arr(body.data)) {
        const d = obj(r);
        if (d) deals.push(d);
      }
    }
    return toEvents(get, deals);
  },
};
