import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST as crmHook } from "@/app/api/v1/webhooks/crm/[provider]/[workspaceId]/route";
import { CRM_CONNECTORS, getCrmConnector } from "@/lib/connectors/crm/index";
import { fetchJsonRetry } from "@/lib/connectors/crm/shared";
import { hubspotConnector, hubspotDealToEvent, hubspotWebhookDealIds, verifyHubspotSignature } from "@/lib/connectors/crm/hubspot";
import { pipedriveBaseUrl, pipedriveConnector, pipedriveDealToEvent, pipedriveWebhookDealIds, verifyPipedriveBasicAuth } from "@/lib/connectors/crm/pipedrive";
import { getRevenueConnector } from "@/lib/connectors/registry";
import type { WebhookRequest } from "@/lib/connectors/types";
import { schema, type DB } from "@/lib/db";
import { saveConnection, type Workspace } from "@/lib/settings";
import { syncProvider } from "@/lib/sync";
import { setupWorkspace } from "./helpers";

const fx = (p: string) => readFileSync(`fixtures/${p}`, "utf8");
const json = (p: string) => JSON.parse(fx(p));
const HS_SECRET = "hs-client-secret-5c1d";
const PD = { config: { companyDomain: "acme", webhookUser: "adledger" }, secrets: { apiToken: "pd-token-9a8b7c", webhookPassword: "pd-hook-pass" } };
const HS = { config: { currency: "GBP" }, secrets: { accessToken: "pat-na1-test-token", clientSecret: HS_SECRET } };

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
let calls: Call[] = [];

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Fake HubSpot + Pipedrive APIs serving the fixtures. */
function mockApis() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init: RequestInit = {}) => {
      const url = String(input);
      const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body });
      const u = new URL(url);
      if (u.host === "api.hubapi.com") {
        if (u.pathname === "/crm/v3/objects/deals/search") return ok(json(body.after ? "hubspot/deals_search_page2.json" : "hubspot/deals_search_page1.json"));
        if (u.pathname === "/crm/v3/objects/deals/batch/read") return ok(json("hubspot/deals_batch_read.json"));
        if (u.pathname === "/crm/v4/associations/deals/contacts/batch/read") return ok(json("hubspot/deal_contact_associations.json"));
        if (u.pathname === "/crm/v3/objects/contacts/batch/read") return ok(json("hubspot/contacts_batch_read.json"));
      }
      if (u.host === "acme.pipedrive.com") {
        if (u.pathname === "/api/v2/deals") {
          const ids = u.searchParams.get("ids");
          if (ids) {
            const all = [...json("pipedrive/deals_won_page1.json").data, ...json("pipedrive/deals_won_page2.json").data];
            return ok({ success: true, data: all.filter((d: { id: number }) => ids.split(",").includes(String(d.id))), additional_data: { next_cursor: null } });
          }
          return ok(json(u.searchParams.get("cursor") ? "pipedrive/deals_won_page2.json" : "pipedrive/deals_won_page1.json"));
        }
        if (u.pathname === "/api/v2/persons") return ok(json("pipedrive/persons.json"));
      }
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const hsSign = (url: string, body: string, ts: string, secret = HS_SECRET) =>
  createHmac("sha256", secret).update(`POST${url}${body}${ts}`, "utf8").digest("base64");
const hsReq = (url: string, body: string, headers: Record<string, string>): WebhookRequest => ({ rawBody: body, url, headers: new Headers(headers) });

const HUBSPOT_EVENTS = [
  {
    type: "payment",
    externalId: "18234567001",
    amountMinor: 480000,
    currency: "USD",
    occurredAt: new Date("2026-09-18T15:30:00Z"),
    customer: { email: "dana.ortiz@acmecorp.example", name: "Dana Ortiz", phone: "+1 415 555 0199", visitorId: "9b2f4c1e-7a3d-4e8b-9c6f-1d2e3f4a5b6c", externalCustomerId: "51002" },
  },
  {
    type: "payment",
    externalId: "18234567002",
    amountMinor: 125050,
    currency: "EUR",
    occurredAt: new Date("2026-09-20T11:00:00Z"),
    customer: { email: "m.keller@brightwave.example", name: "Mia Keller", phone: null, visitorId: null, externalCustomerId: "51003" },
  },
  {
    type: "payment",
    externalId: "18234567003",
    amountMinor: 99999,
    currency: "GBP", // no deal currency -> the connection's default
    occurredAt: new Date("2026-09-22T08:45:00Z"),
    customer: { email: null, name: null, phone: null, visitorId: null, externalCustomerId: null },
  },
];

const PIPEDRIVE_EVENTS = [
  {
    type: "payment",
    externalId: "1042",
    amountMinor: 720000,
    currency: "USD",
    occurredAt: new Date("2026-09-19T16:20:05Z"),
    customer: { email: "grace@northwind.example", name: "Grace Hopper", phone: "+44 20 7946 0958", visitorId: null, externalCustomerId: "301" },
  },
  {
    type: "payment",
    externalId: "1043",
    amountMinor: 189990,
    currency: "EUR",
    occurredAt: new Date("2026-09-21T09:15:00Z"),
    customer: { email: "lars@fjord.example", name: "Lars Ek", phone: null, visitorId: null, externalCustomerId: "302" },
  },
  {
    type: "payment",
    externalId: "1044",
    amountMinor: 150000, // JPY has no minor unit
    currency: "JPY",
    occurredAt: new Date("2026-09-23T03:30:00Z"),
    customer: { email: null, name: null, phone: null, visitorId: null, externalCustomerId: null },
  },
  {
    type: "payment",
    externalId: "1046",
    amountMinor: 49950,
    currency: "INR",
    occurredAt: new Date("2026-09-25T07:00:00Z"),
    customer: { email: "grace@northwind.example", name: "Grace Hopper", phone: "+44 20 7946 0958", visitorId: null, externalCustomerId: "301" },
  },
];

describe("CRM registry", () => {
  it("registers HubSpot and Pipedrive as syncable beta revenue sources", () => {
    expect(CRM_CONNECTORS.map((c) => c.meta.provider)).toEqual(["hubspot", "pipedrive"]);
    for (const c of CRM_CONNECTORS) {
      expect(getRevenueConnector(c.meta.provider)).toBe(c);
      expect(getCrmConnector(c.meta.provider)).toBe(c);
      expect(c.source).toBe(c.meta.provider);
      expect(c.meta).toMatchObject({ category: "revenue", status: "beta" });
      expect(c.meta.steps.length).toBeGreaterThanOrEqual(3);
      expect(c.meta.steps.length).toBeLessThanOrEqual(4);
      expect(c.meta.steps.some((s) => s.includes(`/webhooks/crm/${c.meta.provider}/`))).toBe(true);
      expect(typeof c.backfill).toBe("function");
      for (const f of c.meta.fields) if (/secret|token|password/i.test(f.name)) expect(f.secret).toBe(true);
    }
    expect(getCrmConnector("shopify")).toBeUndefined();
  });
});

describe("HubSpot", () => {
  const url = "https://adledger.example.com/api/v1/webhooks/crm/hubspot/ws1";
  const body = fx("hubspot/webhook_deal_events.json");

  it("verifies X-HubSpot-Signature-v3 and rejects tampering, wrong secret, stale or missing headers", () => {
    const ts = "1790350262500";
    const now = Number(ts) + 1000;
    const good = hsReq(url, body, { "X-HubSpot-Signature-v3": hsSign(url, body, ts), "X-HubSpot-Request-Timestamp": ts });
    expect(verifyHubspotSignature(good, HS_SECRET, "POST", now)).toBe(true);
    expect(verifyHubspotSignature({ ...good, rawBody: body.replace("18234567001", "18234567999") }, HS_SECRET, "POST", now)).toBe(false);
    expect(verifyHubspotSignature(good, "other-secret", "POST", now)).toBe(false);
    expect(verifyHubspotSignature(good, undefined, "POST", now)).toBe(false);
    expect(verifyHubspotSignature(good, HS_SECRET, "POST", now + 6 * 60 * 1000)).toBe(false);
    expect(verifyHubspotSignature(hsReq(url, body, { "X-HubSpot-Request-Timestamp": ts }), HS_SECRET, "POST", now)).toBe(false);
    expect(verifyHubspotSignature(hsReq(url, body, { "X-HubSpot-Signature-v3": hsSign(url, body, ts) }), HS_SECRET, "POST", now)).toBe(false);
    // A signature over a different timestamp than the header claims.
    const other = hsReq(url, body, { "X-HubSpot-Signature-v3": hsSign(url, body, "1790350262000"), "X-HubSpot-Request-Timestamp": ts });
    expect(verifyHubspotSignature(other, HS_SECRET, "POST", now)).toBe(false);
  });

  it("signs the decoded public URI (PUBLIC_URL behind a proxy, %3A etc. decoded)", () => {
    vi.stubEnv("PUBLIC_URL", "https://ledger.example.org/");
    const ts = String(Date.now());
    const signedUri = "https://ledger.example.org/api/v1/webhooks/crm/hubspot/ws1?src=a:b";
    const r = hsReq("http://10.0.0.5:3000/api/v1/webhooks/crm/hubspot/ws1?src=a%3Ab", body, {
      "X-HubSpot-Signature-v3": hsSign(signedUri, body, ts),
      "X-HubSpot-Request-Timestamp": ts,
    });
    expect(hubspotConnector.verifyWebhook(r, HS)).toBe(true);
  });

  it("webhook batches -> deal ids (deal changes/creations only, no deletions or contacts)", () => {
    expect(hubspotWebhookDealIds(json("hubspot/webhook_deal_events.json"))).toEqual(["18234567001", "18234567005"]);
    expect(hubspotWebhookDealIds([{ subscriptionType: "object.propertyChange", objectTypeId: "0-3", objectId: 77 }, { subscriptionType: "object.propertyChange", objectTypeId: "0-1", objectId: 78 }])).toEqual(["77"]);
    expect(hubspotWebhookDealIds({ not: "an array" })).toEqual([]);
    // The generic /webhooks/hubspot/ route can't re-read deals: it must fail visibly, not drop them.
    expect(() => hubspotConnector.parseWebhook([], hsReq(url, "[]", {}))).toThrow(/webhooks\/crm\/hubspot/);
  });

  it("backfill restarts from the last close date when a search hits HubSpot's 10k cap", async () => {
    calls = [];
    const deal = (i: number) => ({ id: String(i), properties: { amount: "10", hs_is_closed_won: "true", closedate: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString() } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init: RequestInit = {}) => {
        const url = String(input);
        const body = JSON.parse(String(init.body));
        calls.push({ url, method: "POST", headers: {}, body });
        if (url.endsWith("/deals/search")) {
          const from = Number(body.filterGroups[0].filters[1].value);
          const offset = Number(body.after ?? 0);
          const all = Array.from({ length: 10_050 }, (_, i) => deal(i)).filter((d) => Date.parse(d.properties.closedate) >= from);
          const page = all.slice(offset, offset + 100);
          // Like HubSpot: no next page once 10k results have been served.
          const next = offset + 100 < Math.min(all.length, 10_000) ? { next: { after: String(offset + 100) } } : undefined;
          return ok({ total: all.length, results: page, ...(next ? { paging: next } : {}) });
        }
        return ok({ results: [] });
      }),
    );
    const events = await hubspotConnector.backfill(HS, { sinceMs: Date.UTC(2026, 0, 1) });
    expect(events).toHaveLength(10_050);
    expect(new Set(events.map((e) => e.externalId)).size).toBe(10_050);
    const restarts = calls.filter((c) => c.url.endsWith("/deals/search") && !(c.body as { after?: string }).after);
    expect(restarts).toHaveLength(2);
  });

  it("retries HubSpot rate limits (429) and then succeeds", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => (n++ === 0 ? new Response("{}", { status: 429, headers: { "retry-after": "0" } }) : ok(json("hubspot/deals_batch_read.json")))),
    );
    const slept: number[] = [];
    const body = await fetchJsonRetry<{ results: unknown[] }>("https://api.hubapi.com/x", {}, "t", async (ms) => void slept.push(ms));
    expect(body.results).toHaveLength(2);
    expect(slept).toEqual([1000]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow down", { status: 429 })));
    await expect(fetchJsonRetry("https://api.hubapi.com/x", {}, "HubSpot t", async () => undefined)).rejects.toThrow(/HTTP 429/);
  });

  it("deal parsing: won only, exact minor units, default currency, no amount -> skipped", () => {
    const [d1, d2] = json("hubspot/deals_batch_read.json").results;
    expect(hubspotDealToEvent(d2, null)).toBeNull(); // open deal
    expect(hubspotDealToEvent({ ...d1, properties: { ...d1.properties, amount: "" } }, null)).toBeNull();
    expect(hubspotDealToEvent({ ...d1, properties: { ...d1.properties, amount: "0" } }, null)).toBeNull();
    expect(hubspotDealToEvent({ ...d1, properties: { ...d1.properties, amount: "12,345.675", deal_currency_code: "kwd" } }, null)?.amountMinor).toBe(12345675);
    expect(hubspotDealToEvent({ ...d1, properties: { ...d1.properties, deal_currency_code: null } }, null, "inr")?.currency).toBe("INR");
  });

  it("backfill: searches won deals since the cutoff, pages, attaches the first contact with an email", async () => {
    mockApis();
    const since = Date.parse("2026-09-01T00:00:00Z");
    expect(await hubspotConnector.backfill(HS, { sinceMs: since })).toEqual(HUBSPOT_EVENTS);
    const searches = calls.filter((c) => c.url.endsWith("/deals/search"));
    expect(searches).toHaveLength(2);
    expect(searches[0].headers.Authorization).toBe("Bearer pat-na1-test-token");
    expect(searches[0].body).toMatchObject({
      filterGroups: [{ filters: [{ propertyName: "hs_is_closed_won", operator: "EQ", value: "true" }, { propertyName: "closedate", operator: "GTE", value: String(since) }] }],
      limit: 100,
    });
    expect(searches[1].body).toMatchObject({ after: "2" });
    const contactsCall = calls.find((c) => c.url.endsWith("/crm/v3/objects/contacts/batch/read"));
    expect(contactsCall?.body).toMatchObject({ inputs: [{ id: "51001" }, { id: "51002" }, { id: "51003" }] });
    for (const c of calls) expect(c.url).not.toContain("pat-na1");
  });

  it("fetchDeals (webhooks) returns only won deals", async () => {
    mockApis();
    expect(await hubspotConnector.fetchDeals(HS, ["18234567001", "18234567005"])).toEqual([HUBSPOT_EVENTS[0]]);
    await expect(hubspotConnector.fetchDeals({ config: {}, secrets: {} }, ["1"])).rejects.toThrow(/access token/);
  });
});

describe("Pipedrive", () => {
  const auth = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  const r = (headers: Record<string, string>): WebhookRequest => ({ rawBody: "{}", url: "https://x/api/v1/webhooks/crm/pipedrive/ws", headers: new Headers(headers) });

  it("checks the webhook's basic auth in constant time", () => {
    expect(verifyPipedriveBasicAuth(r({ Authorization: auth("adledger", "pd-hook-pass") }), "adledger", "pd-hook-pass")).toBe(true);
    expect(pipedriveConnector.verifyWebhook(r({ Authorization: auth("adledger", "pd-hook-pass") }), PD)).toBe(true);
    expect(pipedriveConnector.verifyWebhook(r({ Authorization: auth("adledger", "wrong") }), PD)).toBe(false);
    expect(pipedriveConnector.verifyWebhook(r({ Authorization: auth("someone", "pd-hook-pass") }), PD)).toBe(false);
    expect(pipedriveConnector.verifyWebhook(r({ Authorization: "Bearer pd-hook-pass" }), PD)).toBe(false);
    expect(pipedriveConnector.verifyWebhook(r({}), PD)).toBe(false);
    // No password configured -> webhooks are refused, even with an empty-credential header.
    expect(verifyPipedriveBasicAuth(r({ Authorization: auth("", "") }), undefined, undefined)).toBe(false);
  });

  it("normalizes the company domain", () => {
    expect(pipedriveBaseUrl("acme")).toBe("https://acme.pipedrive.com/api/v2");
    expect(pipedriveBaseUrl("https://Acme.pipedrive.com/deals/list")).toBe("https://acme.pipedrive.com/api/v2");
    expect(() => pipedriveBaseUrl("evil.com/x?y=")).toThrow();
    expect(() => pipedriveBaseUrl("")).toThrow();
  });

  it("webhook payloads (v1 and v2) -> deal ids; non-won and deletes are skipped", () => {
    expect(pipedriveWebhookDealIds(json("pipedrive/webhook_v2_deal_change.json"))).toEqual(["1042"]);
    expect(pipedriveWebhookDealIds(json("pipedrive/webhook_v1_deal_updated.json"))).toEqual(["1043"]);
    const v2 = json("pipedrive/webhook_v2_deal_change.json");
    expect(pipedriveWebhookDealIds({ ...v2, data: { ...v2.data, status: "lost" } })).toEqual([]);
    expect(pipedriveWebhookDealIds({ ...v2, meta: { ...v2.meta, action: "delete" }, data: null })).toEqual([]);
    expect(pipedriveWebhookDealIds({ ...v2, meta: { ...v2.meta, entity: "person" } })).toEqual([]);
    // v2's meta.id is the event UUID, never a deal id.
    const metaNoEntityId = { ...v2.meta, entity_id: undefined };
    expect(pipedriveWebhookDealIds({ ...v2, meta: metaNoEntityId, data: { ...v2.data, id: 1042 } })).toEqual(["1042"]);
    expect(pipedriveWebhookDealIds({ ...v2, meta: metaNoEntityId, data: { status: "won" } })).toEqual([]);
    expect(() => pipedriveConnector.parseWebhook(v2, r({}))).toThrow(/webhooks\/crm\/pipedrive/);
  });

  it("deal parsing: v1 timestamps and embedded person, exact minor units", () => {
    const v1 = json("pipedrive/webhook_v1_deal_updated.json").current;
    const person = { value: 302, name: "Lars Ek", email: [{ label: "work", value: "lars@fjord.example", primary: true }], phone: [{ label: "", value: "", primary: true }] };
    expect(pipedriveDealToEvent({ ...v1, person_id: person }, null)).toEqual(PIPEDRIVE_EVENTS[1]);
    expect(pipedriveDealToEvent({ ...v1, status: "lost" }, null)).toBeNull();
    expect(pipedriveDealToEvent({ ...v1, value: 0 }, null)).toBeNull();
    expect(pipedriveDealToEvent({ ...v1, value: "0.105", currency: "BHD" }, null)?.amountMinor).toBe(105);
  });

  it("backfill: won deals since the cutoff via cursor pages, persons in one call, token in a header", async () => {
    mockApis();
    const since = Date.parse("2026-09-01T00:00:00Z");
    expect(await pipedriveConnector.backfill(PD, { sinceMs: since })).toEqual(PIPEDRIVE_EVENTS);
    const dealCalls = calls.filter((c) => new URL(c.url).pathname === "/api/v2/deals");
    expect(dealCalls).toHaveLength(2);
    const q = new URL(dealCalls[0].url).searchParams;
    expect(q.get("status")).toBe("won");
    expect(q.get("updated_since")).toBe("2026-09-01T00:00:00Z");
    expect(new URL(dealCalls[1].url).searchParams.get("cursor")).toBe(json("pipedrive/deals_won_page1.json").additional_data.next_cursor);
    const personCalls = calls.filter((c) => c.url.includes("/persons"));
    expect(personCalls).toHaveLength(1);
    expect(new URL(personCalls[0].url).searchParams.get("ids")).toBe("301,302");
    for (const c of calls) {
      expect(c.headers["x-api-token"]).toBe("pd-token-9a8b7c");
      expect(c.url).not.toContain("pd-token");
    }
  });
});

describe("CRM webhooks route + sync", () => {
  let db: DB;
  let ws: Workspace;
  beforeAll(async () => {
    ({ db, ws } = await setupWorkspace());
    await saveConnection(ws.id, "hubspot", { mode: "live", ...HS }, db);
    await saveConnection(ws.id, "pipedrive", { mode: "live", ...PD }, db);
  });
  const revenue = (source: string) => db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.source, source));

  it("HubSpot: 401 on a bad signature, then ingests the won deal once (replays are idempotent)", async () => {
    mockApis();
    const url = `http://localhost/api/v1/webhooks/crm/hubspot/${ws.id}`;
    const body = fx("hubspot/webhook_deal_events.json");
    const params = Promise.resolve({ provider: "hubspot", workspaceId: ws.id });
    const bad = await crmHook(new Request(url, { method: "POST", body, headers: { "X-HubSpot-Signature-v3": "AAAA", "X-HubSpot-Request-Timestamp": String(Date.now()) } }), { params });
    expect(bad.status).toBe(401);
    expect(calls).toHaveLength(0);
    for (let i = 0; i < 2; i++) {
      const ts = String(Date.now());
      const res = await crmHook(new Request(url, { method: "POST", body, headers: { "X-HubSpot-Signature-v3": hsSign(url, body, ts), "X-HubSpot-Request-Timestamp": ts } }), { params });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, deals: 2, stored: 1 });
    }
    const rows = await revenue("hubspot");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "18234567001", amountMinor: 480000, currency: "USD", type: "payment" });
    const [contact] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, rows[0].contactId!));
    expect(contact).toMatchObject({ email: "dana.ortiz@acmecorp.example", lifecycle: "customer" });
  });

  it("Pipedrive: basic auth required; v1 webhook ingests the deal", async () => {
    mockApis();
    const url = `http://localhost/api/v1/webhooks/crm/pipedrive/${ws.id}`;
    const body = fx("pipedrive/webhook_v1_deal_updated.json");
    const params = Promise.resolve({ provider: "pipedrive", workspaceId: ws.id });
    const basic = (p: string) => `Basic ${Buffer.from(`adledger:${p}`).toString("base64")}`;
    expect((await crmHook(new Request(url, { method: "POST", body, headers: { Authorization: basic("nope") } }), { params })).status).toBe(401);
    const res = await crmHook(new Request(url, { method: "POST", body, headers: { Authorization: basic("pd-hook-pass") } }), { params });
    expect(await res.json()).toEqual({ received: true, deals: 1, stored: 1 });
    expect((await revenue("pipedrive")).map((r) => [r.externalId, r.amountMinor, r.currency])).toEqual([["1043", 189990, "EUR"]]);
  });

  it("unknown provider / workspace -> 404", async () => {
    const req = () => new Request("http://localhost/x", { method: "POST", body: "{}" });
    expect((await crmHook(req(), { params: Promise.resolve({ provider: "shopify", workspaceId: ws.id }) })).status).toBe(404);
    expect((await crmHook(req(), { params: Promise.resolve({ provider: "hubspot", workspaceId: "not-a-uuid" }) })).status).toBe(404);
  });

  it("syncProvider backfills a live Pipedrive connection (and is a no-op in mock mode)", async () => {
    mockApis();
    expect(await syncProvider(db, ws.id, "pipedrive", { backfillDays: 36500 })).toMatchObject({ status: "success", rows: 0 });
    expect(calls).toHaveLength(0);
    vi.stubEnv("CONNECTOR_MODE", "live");
    const result = await syncProvider(db, ws.id, "pipedrive", { backfillDays: 36500 });
    expect(result).toMatchObject({ status: "success", rows: 5 }); // 1042-1046, 1045 included: cutoff is a century ago
    const rows = await revenue("pipedrive");
    expect(rows.map((r) => r.externalId).sort()).toEqual(["1042", "1043", "1044", "1045", "1046"]);
    expect(rows.find((r) => r.externalId === "1046")).toMatchObject({ amountMinor: 49950, currency: "INR" });
  });
});
