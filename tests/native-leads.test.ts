import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET as leadsGet, POST as leadsPost } from "@/app/api/v1/webhooks/leads-native/[provider]/[workspaceId]/route";
import { recomputeAttribution } from "@/lib/attribution";
import { allIntegrations } from "@/lib/connectors/registry";
import { googleLeadsConnector, parseGoogleLead } from "@/lib/connectors/leads/google";
import { LEAD_CONNECTORS, getLeadConnector } from "@/lib/connectors/leads/index";
import { syntheticVisitorId } from "@/lib/connectors/leads/ingest";
import { metaLeadgenValues, metaLeadsConnector, mockMetaLead, parseMetaLead, type MetaGraphLead } from "@/lib/connectors/leads/meta";
import { parseJsonLossless, parseTime, rawId, secretEquals } from "@/lib/connectors/leads/shared";
import { parseTikTokLeads, tiktokLeadsConnector, verifyTikTokSignature } from "@/lib/connectors/leads/tiktok";
import type { ConnectionLike, WebhookRequest } from "@/lib/connectors/types";
import { hashEmail } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { saveConnection, type Workspace } from "@/lib/settings";
import { syncProvider } from "@/lib/sync";
import { setupWorkspace } from "./helpers";

const raw = (p: string) => readFileSync(`fixtures/${p}`, "utf8");
const req = (rawBody: string, headers: Record<string, string> = {}): WebhookRequest => ({
  rawBody,
  headers: new Headers(headers),
  url: "https://adledger.example.com/api/v1/webhooks/leads-native/x/y",
});
const conn = (secrets: Record<string, string>, config: Record<string, string> = {}): ConnectionLike => ({ config, secrets });
const hmacHex = (secret: string, data: string) => createHmac("sha256", secret).update(data, "utf8").digest("hex");
const APP_SECRET = "meta_app_secret_1f2e3d";

describe("lead connector registry", () => {
  it("registers three beta lead sources and surfaces them in the catalog", () => {
    expect(LEAD_CONNECTORS.map((c) => c.meta.provider)).toEqual(["meta_leads", "google_ads_leads", "tiktok_leads"]);
    const catalog = allIntegrations().map((i) => i.provider);
    for (const c of LEAD_CONNECTORS) {
      expect(getLeadConnector(c.meta.provider)).toBe(c);
      expect(catalog).toContain(c.meta.provider);
      expect(c.meta).toMatchObject({ category: "leads", status: "beta" });
      expect(c.meta.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.meta.steps.length).toBeGreaterThanOrEqual(3);
      expect(c.meta.steps.join(" ")).toContain(`/api/v1/webhooks/leads-native/${c.meta.provider}/`);
      expect(c.meta.fields.length).toBeGreaterThan(0);
      for (const f of c.meta.fields) if (/secret|token|key/i.test(f.name)) expect(f.secret).toBe(true);
    }
    expect(new Set(catalog).size).toBe(catalog.length);
  });
});

describe("shared helpers", () => {
  it("secretEquals is exact and rejects empties", () => {
    expect(secretEquals("abc", "abc")).toBe(true);
    expect(secretEquals("abc", "abcd")).toBe(false);
    expect(secretEquals("abc", "")).toBe(false);
    expect(secretEquals(undefined, "abc")).toBe(false);
  });
  it("rawId keeps int64 precision; parseTime handles Graph and unix formats", () => {
    expect(rawId('{"creative_id": 9007199254740993}', "creative_id", 9007199254740992)).toBe("9007199254740993");
    expect(rawId("{}", "x", 12)).toBe("12");
    expect(rawId('{"a":{"form_id":5},"form_id":7}', "form_id", 7)).toBe("7");
    expect(rawId('{"form_id":1}', "form_id", "9007199254740993")).toBe("9007199254740993");
    expect(rawId('{"form_id":1}', "form_id", undefined)).toBeNull();
    expect(parseJsonLossless('{"id":120210000000000301,"n":42,"f":1.5,"s":"x","a":[7420001112223334445]}')).toEqual({
      id: "120210000000000301",
      n: 42,
      f: 1.5,
      s: "x",
      a: ["7420001112223334445"],
    });
    expect(parseTime("2026-09-24T10:15:27+0000")).toEqual(new Date("2026-09-24T10:15:27Z"));
    expect(parseTime("1790150400")).toEqual(new Date(1790150400 * 1000));
    expect(parseTime(1790150400)).toEqual(new Date(1790150400 * 1000));
    expect(parseTime("2026-09-24 08:42:10Z")).toEqual(new Date("2026-09-24T08:42:10Z"));
  });
  it("synthetic visitor ids fit the 64-char column", () => {
    expect(syntheticVisitorId("meta_leads", "123")).toBe("lead:meta_leads:123");
    expect(syntheticVisitorId("google_ads_leads", "x".repeat(100)).length).toBeLessThanOrEqual(64);
  });
});

describe("Meta Lead Ads", () => {
  const body = raw("meta_leads/leadgen_webhook.json");
  const signed = (b: string, secret = APP_SECRET) => req(b, { "X-Hub-Signature-256": `sha256=${hmacHex(secret, b)}` });
  afterEach(() => vi.unstubAllGlobals());

  it("verifies X-Hub-Signature-256 and rejects tampering / wrong secret / missing or malformed header", () => {
    const c = conn({ appSecret: APP_SECRET });
    expect(metaLeadsConnector.verifyWebhook(signed(body), c)).toBe(true);
    expect(metaLeadsConnector.verifyWebhook({ ...signed(body), rawBody: body.replace("1234567890123456", "1234567890123457") }, c)).toBe(false);
    expect(metaLeadsConnector.verifyWebhook(signed(body, "other"), c)).toBe(false);
    expect(metaLeadsConnector.verifyWebhook(req(body), c)).toBe(false);
    expect(metaLeadsConnector.verifyWebhook(req(body, { "X-Hub-Signature-256": hmacHex(APP_SECRET, body) }), c)).toBe(false);
    expect(metaLeadsConnector.verifyWebhook(signed(body), conn({}))).toBe(false);
  });

  it("answers the hub.challenge handshake only with the right verify token", () => {
    const c = conn({ verifyToken: "vt-123" });
    const q = (token: string, mode = "subscribe") => new URLSearchParams({ "hub.mode": mode, "hub.verify_token": token, "hub.challenge": "1158201444" });
    expect(metaLeadsConnector.verifyChallenge!(q("vt-123"), c)).toBe("1158201444");
    expect(metaLeadsConnector.verifyChallenge!(q("nope"), c)).toBeNull();
    expect(metaLeadsConnector.verifyChallenge!(q("vt-123", "unsubscribe"), c)).toBeNull();
  });

  it("extracts leadgen changes and parses a Graph lead exactly", () => {
    const [v, ...rest] = metaLeadgenValues(JSON.parse(body));
    expect(rest).toHaveLength(0);
    expect(v).toEqual({
      leadgen_id: "1234567890123456",
      page_id: "104512345678901",
      form_id: "987654321012345",
      ad_id: "120210000000000301",
      adgroup_id: "120210000000000201",
      created_time: 1790158527,
    });
    expect(metaLeadgenValues({ object: "instagram", entry: [] })).toEqual([]);
    const lead = parseMetaLead(JSON.parse(raw("meta_leads/lead.json")) as MetaGraphLead, v);
    expect(lead).toEqual({
      platform: "meta",
      externalLeadId: "1234567890123456",
      email: "Maya.Fernandes@Example.com",
      phone: "+14155550199",
      name: "Maya Fernandes",
      formName: "Meta lead form 987654321012345",
      occurredAt: new Date("2026-09-24T10:15:27Z"),
      campaignExternalId: "120210000000000101",
      adGroupExternalId: "120210000000000201",
      adExternalId: "120210000000000301",
      organic: false,
      details: { formId: "987654321012345", pageId: "104512345678901", publisher: "ig", adName: "Free audit - video 1", campaignName: "Lead gen - Free audit" },
    });
  });

  it("organic form leads carry no ad ids", () => {
    const lead = parseMetaLead({ id: "55", is_organic: true, ad_id: "1", field_data: [{ name: "email", values: ["a@example.com"] }] });
    expect(lead).toMatchObject({ organic: true, adExternalId: null, campaignExternalId: null, email: "a@example.com" });
  });

  it("live mode fetches the lead from the Graph API with the Page token (not in the URL)", async () => {
    const fetchMock = vi.fn(async () => new Response(raw("meta_leads/lead.json"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const leads = await metaLeadsConnector.parseWebhook(JSON.parse(body), signed(body), { conn: conn({ pageAccessToken: "EAAB-page" }), mock: false });
    expect(leads).toHaveLength(1);
    expect(leads[0].campaignExternalId).toBe("120210000000000101");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/1234567890123456\?fields=.*field_data/);
    expect(url).not.toContain("EAAB");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer EAAB-page");
  });

  it("mock mode builds a Graph-format lead without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const [lead] = await metaLeadsConnector.parseWebhook(JSON.parse(body), signed(body), { conn: conn({}), mock: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lead).toMatchObject({ externalLeadId: "1234567890123456", email: "meta.lead.1234567890123456@example.com", adExternalId: "120210000000000301", organic: false });
    expect(lead.occurredAt).toEqual(new Date(1790158527 * 1000));
    expect(mockMetaLead({ leadgen_id: "9" }).is_organic).toBe(true);
  });
});

describe("Google Ads lead forms", () => {
  const body = raw("google_ads_leads/lead.json");
  it("verifies google_key in the body", () => {
    expect(googleLeadsConnector.verifyWebhook(req(body), conn({ googleKey: "gk_9f2c4e7a1b3d5f60" }))).toBe(true);
    expect(googleLeadsConnector.verifyWebhook(req(body), conn({ googleKey: "gk_wrong" }))).toBe(false);
    expect(googleLeadsConnector.verifyWebhook(req(body), conn({}))).toBe(false);
    expect(googleLeadsConnector.verifyWebhook(req("not json"), conn({ googleKey: "gk_9f2c4e7a1b3d5f60" }))).toBe(false);
    expect(googleLeadsConnector.verifyWebhook(req(body.replace(/"google_key": "[^"]+",/, "")), conn({ googleKey: "gk_9f2c4e7a1b3d5f60" }))).toBe(false);
  });

  it("parses user_column_data and ids exactly", () => {
    expect(parseGoogleLead(JSON.parse(body), body)).toEqual([
      {
        platform: "google",
        externalLeadId: "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxyz-0123456789-AaBbCcDdEe",
        email: "arjun.mehta@example.in",
        phone: "+919812345678",
        name: "Arjun Mehta",
        formName: "Google Ads lead form 40000000001",
        occurredAt: new Date("2026-09-24T08:42:10Z"),
        campaignExternalId: "21000000123",
        adGroupExternalId: "150000000456",
        adExternalId: "690000000789",
        clickId: { type: "gclid", id: "EAIaIQobChMI8pWz1b-test-gclid" },
        details: { formId: "40000000001", assetGroupId: null, leadSource: "LEAD_FORM", leadStage: "ACTIVE" },
      },
    ]);
  });

  it("acknowledges test leads without storing them; joins first + last name", () => {
    const test = body.replace('"is_test": false', '"is_test": true');
    expect(parseGoogleLead(JSON.parse(test), test)).toEqual([]);
    const p = { lead_id: "L1", campaign_id: 5, user_column_data: [{ column_id: "FIRST_NAME", string_value: "Ana" }, { column_id: "LAST_NAME", string_value: "Lima" }, { column_id: "WORK_EMAIL", string_value: "ana@corp.example" }] };
    const [l] = parseGoogleLead(p, JSON.stringify(p));
    expect(l).toMatchObject({ name: "Ana Lima", email: "ana@corp.example", phone: null, campaignExternalId: "5", adExternalId: null });
  });
});

describe("TikTok Lead Generation", () => {
  const body = raw("tiktok_leads/lead.json");
  const SECRET = "tt_app_secret_7c1d";
  const now = 1790150460;
  const sig = (b: string, t = now, secret = SECRET) => `t=${t},s=${hmacHex(secret, `${t}.${b}`)}`;

  it("verifies TikTok-Signature and rejects tampering, wrong secret, stale timestamps", () => {
    expect(verifyTikTokSignature(body, SECRET, sig(body), now)).toBe(true);
    expect(verifyTikTokSignature(body.replace("Lena", "Lina"), SECRET, sig(body), now)).toBe(false);
    expect(verifyTikTokSignature(body, SECRET, sig(body, now, "other"), now)).toBe(false);
    expect(verifyTikTokSignature(body, SECRET, sig(body, now - 3600), now)).toBe(false);
    expect(verifyTikTokSignature(body, SECRET, null, now)).toBe(false);
    expect(verifyTikTokSignature(body, SECRET, "t=abc,s=zz", now)).toBe(false);
    expect(verifyTikTokSignature(body, undefined, sig(body), now)).toBe(false);
    const fresh = sig(body, Math.floor(Date.now() / 1000));
    expect(tiktokLeadsConnector.verifyWebhook(req(body, { "TikTok-Signature": fresh }), conn({ appSecret: SECRET }))).toBe(true);
  });

  it("parses the lead exactly", () => {
    expect(parseTikTokLeads(JSON.parse(body))).toEqual([
      {
        platform: "tiktok",
        externalLeadId: "7420001112223334445",
        email: "lena.hoffmann@example.de",
        phone: "+4915112345678",
        name: "Lena Hoffmann",
        formName: "Spring demo request",
        occurredAt: new Date(1790150400 * 1000),
        campaignExternalId: "1810000000000001",
        adGroupExternalId: "1810000000000101",
        adExternalId: "1810000000001001",
        details: { pageId: "7415550001112223334", advertiserId: "7012345678901234567", adName: "UGC hook v3", campaignName: "Leads - Spring demo" },
      },
    ]);
  });

  it("accepts the lead as a JSON string in `content`", () => {
    const lead = JSON.parse(body).lead;
    const [l] = parseTikTokLeads({ subscribe_entity: "LEAD", content: JSON.stringify(lead) });
    expect(l.externalLeadId).toBe("7420001112223334445");
    expect(parseTikTokLeads({ content: "{bad" })).toEqual([]);
  });

  it("keeps int64 ids sent as bare numbers exact, and accepts a `data` array", () => {
    const content = '{"lead_id":7420001112223334445,"campaign_id":1810000000000000001,"ad_id":1810000000000001001,"user_info":[{"field_name":"email","field_value":"a@example.com"}]}';
    const [l] = parseTikTokLeads({ content });
    expect(l).toMatchObject({ externalLeadId: "7420001112223334445", campaignExternalId: "1810000000000000001", adExternalId: "1810000000000001001" });
    const many = parseTikTokLeads({ data: [{ lead_id: "1" }, { lead_id: "2" }] });
    expect(many.map((x) => x.externalLeadId)).toEqual(["1", "2"]);
  });
});

describe("native lead webhook route", () => {
  let db: DB;
  let ws: Workspace;
  let campaignId: string;
  let otherCampaignId: string;

  beforeAll(async () => {
    ({ db, ws } = await setupWorkspace());
    const [acct] = await db.insert(schema.adAccounts).values({ workspaceId: ws.id, platform: "meta", externalId: "act_1", name: "Meta", currency: "USD" }).returning();
    const [c1, c2] = await db
      .insert(schema.campaigns)
      .values([
        { workspaceId: ws.id, adAccountId: acct.id, platform: "meta", externalId: "120210000000000101", name: "Lead gen - Free audit" },
        { workspaceId: ws.id, adAccountId: acct.id, platform: "meta", externalId: "120210000000000999", name: "Retargeting" },
      ])
      .returning();
    campaignId = c1.id;
    otherCampaignId = c2.id;
    const [g] = await db.insert(schema.adGroups).values({ workspaceId: ws.id, campaignId, platform: "meta", externalId: "120210000000000201", name: "Founders" }).returning();
    await db.insert(schema.ads).values({ workspaceId: ws.id, adGroupId: g.id, campaignId, platform: "meta", externalId: "120210000000000301", name: "Free audit - video 1" });
    await saveConnection(ws.id, "meta_leads", { mode: "live", secrets: { appSecret: APP_SECRET, verifyToken: "vt-route", pageAccessToken: "EAAB-route" } }, db);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const params = (provider = "meta_leads", workspaceId?: string) => ({ params: Promise.resolve({ provider, workspaceId: workspaceId ?? ws.id }) });
  const post = (body: string, headers: Record<string, string>, p = params()) => leadsPost(new Request("http://localhost/x", { method: "POST", body, headers }), p);

  it("GET echoes hub.challenge for the right verify token only", async () => {
    const ok = await leadsGet(new Request("http://localhost/x?hub.mode=subscribe&hub.verify_token=vt-route&hub.challenge=42424242"), params());
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42424242");
    const bad = await leadsGet(new Request("http://localhost/x?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1"), params());
    expect(bad.status).toBe(403);
    expect((await leadsGet(new Request("http://localhost/x"), params("nope"))).status).toBe(404);
    expect((await leadsGet(new Request("http://localhost/x"), params("tiktok_leads"))).status).toBe(400);
  });

  it("rejects a bad signature without storing anything", async () => {
    const body = raw("meta_leads/leadgen_webhook.json");
    const res = await post(body, { "x-hub-signature-256": `sha256=${"0".repeat(64)}` });
    expect(res.status).toBe(401);
    expect(await db.select().from(schema.leads)).toHaveLength(0);
  });

  it("a Meta lead creates contact + lead + touchpoint credited to the right campaign (idempotent)", async () => {
    vi.stubEnv("CONNECTOR_MODE", "live");
    const fetchMock = vi.fn(async () => new Response(raw("meta_leads/lead.json"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = raw("meta_leads/leadgen_webhook.json");
    const headers = { "x-hub-signature-256": `sha256=${hmacHex(APP_SECRET, body)}` };
    const res = await post(body, headers);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, stored: 1, duplicates: 0, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const contacts = await db.select().from(schema.contacts).where(eq(schema.contacts.workspaceId, ws.id));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ email: "maya.fernandes@example.com", emailHash: hashEmail("maya.fernandes@example.com"), name: "Maya Fernandes" });
    expect(contacts[0].phoneHash).toMatch(/^[0-9a-f]{64}$/);

    const leads = await db.select().from(schema.leads);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({ contactId: contacts[0].id, source: "webhook", formName: "Meta lead form 987654321012345", occurredAt: new Date("2026-09-24T10:15:27Z") });
    expect(JSON.stringify(leads[0].raw)).not.toContain("maya");

    const [visitor] = await db.select().from(schema.visitors).where(eq(schema.visitors.anonymousId, "lead:meta_leads:1234567890123456"));
    expect(visitor.contactId).toBe(contacts[0].id);
    const tps = await db.select().from(schema.touchpoints).where(eq(schema.touchpoints.visitorId, visitor.id));
    expect(tps).toHaveLength(1);
    expect(tps[0]).toMatchObject({ channel: "paid_social", platform: "meta", utmSource: "facebook", utmMedium: "lead_form", campaignId, occurredAt: new Date("2026-09-24T10:15:27Z") });
    expect(tps[0].adId).not.toBeNull();
    expect(tps[0].adGroupId).not.toBeNull();

    // Retried delivery: nothing new.
    const again = await post(body, headers);
    expect(await again.json()).toMatchObject({ stored: 0, duplicates: 1 });
    expect(await db.select().from(schema.leads)).toHaveLength(1);
    expect(await db.select().from(schema.touchpoints)).toHaveLength(1);

    await recomputeAttribution(db, ws.id);
    const credits = await db
      .select()
      .from(schema.attributionCredits)
      .where(and(eq(schema.attributionCredits.workspaceId, ws.id), eq(schema.attributionCredits.conversionType, "lead"), eq(schema.attributionCredits.model, "last_touch")));
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({ conversionId: leads[0].id, campaignId, channel: "paid_social", platform: "meta", touchpointId: tps[0].id });
    expect(Number(credits[0].credit)).toBe(1);
    expect(credits.some((c) => c.campaignId === otherCampaignId)).toBe(false);
  });

  it("mock mode (CONNECTOR_MODE=mock) ingests without calling Graph", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const body = raw("meta_leads/leadgen_webhook.json").replace("1234567890123456", "1234567890129999");
    const res = await post(body, { "x-hub-signature-256": `sha256=${hmacHex(APP_SECRET, body)}` });
    expect(await res.json()).toMatchObject({ stored: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("int64 ids sent as bare JSON numbers stay exact (dedupe key and ad match)", async () => {
    const body = raw("meta_leads/leadgen_webhook.json")
      .replace('"leadgen_id": "1234567890123456"', '"leadgen_id": 1234567890123456789')
      .replace('"ad_id": "120210000000000301"', '"ad_id": 120210000000000301');
    expect(body).toContain('"leadgen_id": 1234567890123456789');
    expect(body).toContain('"ad_id": 120210000000000301');
    const headers = { "x-hub-signature-256": `sha256=${hmacHex(APP_SECRET, body)}` };
    expect(await (await post(body, headers)).json()).toMatchObject({ stored: 1 });
    const [visitor] = await db.select().from(schema.visitors).where(eq(schema.visitors.anonymousId, "lead:meta_leads:1234567890123456789"));
    expect(visitor).toBeDefined();
    const [tp] = await db.select().from(schema.touchpoints).where(eq(schema.touchpoints.visitorId, visitor.id));
    expect(tp).toMatchObject({ utmContent: "120210000000000301", campaignId });
    expect(tp.adId).not.toBeNull();
    expect(await (await post(body, headers)).json()).toMatchObject({ stored: 0, duplicates: 1 });
  });

  it("saving a lead connection's first sync succeeds with nothing to pull (no false 'sync failed')", async () => {
    const r = await syncProvider(db, ws.id, "meta_leads");
    expect(r).toMatchObject({ status: "success", rows: 0 });
  });

  it("a connection in one workspace does not accept deliveries for another", async () => {
    const [other] = await db
      .insert(schema.workspaces)
      .values({ organizationId: ws.organizationId, name: "Other", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" })
      .returning();
    const body = raw("meta_leads/leadgen_webhook.json");
    const res = await post(body, { "x-hub-signature-256": `sha256=${hmacHex(APP_SECRET, body)}` }, params("meta_leads", other.id));
    expect(res.status).toBe(400);
  });

  it("Google lead form: wrong key 401; valid key stores a paid_search lead", async () => {
    await saveConnection(ws.id, "google_ads_leads", { mode: "live", secrets: { googleKey: "gk_9f2c4e7a1b3d5f60" } }, db);
    const body = raw("google_ads_leads/lead.json");
    expect((await post(body.replace("gk_9f2c4e7a1b3d5f60", "gk_x"), {}, params("google_ads_leads"))).status).toBe(401);
    const res = await post(body, { "content-type": "application/json" }, params("google_ads_leads"));
    expect(await res.json()).toMatchObject({ stored: 1 });
    const [tp] = await db.select().from(schema.touchpoints).where(eq(schema.touchpoints.clickId, "EAIaIQobChMI8pWz1b-test-gclid"));
    expect(tp).toMatchObject({ channel: "paid_search", platform: "google", clickIdType: "gclid", utmCampaign: "21000000123", campaignId: null });
  });
});
