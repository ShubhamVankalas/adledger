import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { backoffMs, MAX_ATTEMPTS, nextState, runConversionUploads, uploadStats, type ConversionContext } from "@/lib/capi";
import { googleConsent, uploadConsent } from "@/lib/capi/consent";
import {
  buildGoogleConversion,
  conversionActionId,
  DATA_MANAGER_INGEST_URL,
  googleEventViolations,
  googleIngestRequest,
  googleRequestError,
  googleUploadConfig,
  mockDataManagerFetch,
  normalizeGoogleEmail,
  sendGoogleConversions,
  type GoogleEvent,
  type GoogleIngestRequest,
  type GoogleUploadConfig,
} from "@/lib/capi/google";
import { buildMetaEvent, classifyMetaResponse, metaEventId, metaUploadConfig, pageUrl, sendMetaEvents, type MetaServerEvent } from "@/lib/capi/meta";
import { hashEmail, hashPhone, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { fromDecimalString, toDecimalString } from "@/lib/money";
import { saveConnection, type Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

const fixture = (p: string) => JSON.parse(readFileSync(`fixtures/${p}`, "utf8"));
const NOW = new Date("2026-09-27T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

const ctx = (over: Partial<ConversionContext> = {}): ConversionContext => ({
  id: "0b6f8f5e-6c1a-4d8e-9d59-3f7c2b1a0e11",
  type: "lead",
  occurredAt: ago(HOUR),
  amountMinor: null,
  currency: null,
  contactId: "5d1c0c52-1111-4c2a-9e0d-7e1f2a3b4c5d",
  email: "  Jane.Doe@Gmail.com ",
  emailHash: null,
  phoneHash: hashPhone("+1 (415) 555-0100"),
  ip: "203.0.113.0",
  userAgent: "Mozilla/5.0 (Macintosh)",
  sourceUrl: "https://shop.example/landing?fbclid=abc",
  fbc: "fb.1.1790000000000.abc",
  fbp: "fb.1.1790000000000.123456789",
  googleClick: null,
  adsConsent: null,
  gpc: false,
  ...over,
});

describe("money: minor units -> exact decimal string", () => {
  it("formats 2-, 0- and 3-decimal currencies and negatives", () => {
    expect(toDecimalString(12345, "USD")).toBe("123.45");
    expect(toDecimalString(5, "USD")).toBe("0.05");
    expect(toDecimalString(0, "EUR")).toBe("0.00");
    expect(toDecimalString(500, "JPY")).toBe("500");
    expect(toDecimalString(1234, "KWD")).toBe("1.234");
    expect(toDecimalString(-199, "USD")).toBe("-1.99");
  });
  it("round-trips with fromDecimalString", () => {
    for (const cur of ["USD", "JPY", "KWD", "INR"]) {
      for (const minor of [0, 1, 7, 10, 99, 100, 101, 123456789, 9_007_199_254_740]) {
        expect(fromDecimalString(toDecimalString(minor, cur), cur)).toBe(minor);
      }
    }
  });
});

describe("Meta CAPI payload", () => {
  it("hashes identifiers per Meta's normalization and keeps click/browser ids raw", () => {
    const b = buildMetaEvent(ctx(), NOW);
    if (!("payload" in b)) throw new Error("expected payload");
    const e = b.payload;
    expect(e).toMatchObject({ event_name: "Lead", event_time: Math.floor(ago(HOUR).getTime() / 1000), action_source: "website" });
    expect(e.event_id).toBe(`lead_${ctx().id}`);
    expect(e.event_id).toBe(metaEventId(ctx())); // deterministic → Meta de-duplicates retries
    expect(e.user_data.em).toEqual([sha256("jane.doe@gmail.com")]);
    expect(e.user_data.ph).toEqual([sha256("14155550100")]);
    expect(e.user_data.external_id).toEqual([sha256(ctx().contactId!)]);
    expect(e.user_data).toMatchObject({ fbc: ctx().fbc, fbp: ctx().fbp, client_ip_address: "203.0.113.0", client_user_agent: "Mozilla/5.0 (Macintosh)" });
    expect(e.event_source_url).toBe("https://shop.example/landing"); // query string never leaves
    expect(e.custom_data).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain("jane");
  });
  it("sends purchase value in exact major units", () => {
    const usd = buildMetaEvent(ctx({ type: "purchase", amountMinor: 12345, currency: "usd" }), NOW);
    if (!("payload" in usd)) throw new Error("expected payload");
    expect(usd.payload.event_name).toBe("Purchase");
    expect(usd.payload.event_id).toBe(`purchase_${ctx().id}`);
    expect(usd.payload.custom_data).toEqual({ value: 123.45, currency: "USD" });
    expect(JSON.stringify(usd.payload)).toContain('"value":123.45');
    const jpy = buildMetaEvent(ctx({ type: "purchase", amountMinor: 4980, currency: "JPY" }), NOW);
    expect("payload" in jpy && jpy.payload.custom_data).toEqual({ value: 4980, currency: "JPY" });
    const tiny = buildMetaEvent(ctx({ type: "purchase", amountMinor: 10, currency: "USD" }), NOW);
    expect(JSON.stringify("payload" in tiny && tiny.payload.custom_data)).toBe('{"value":0.1,"currency":"USD"}');
  });
  it("uses the stored email hash when no raw email, and system_generated without a user agent", () => {
    const b = buildMetaEvent(ctx({ email: null, emailHash: hashEmail("x@y.com"), userAgent: null, ip: null, fbc: null, fbp: null }), NOW);
    if (!("payload" in b)) throw new Error("expected payload");
    expect(b.payload.user_data.em).toEqual([hashEmail("x@y.com")]);
    expect(b.payload.action_source).toBe("system_generated");
    expect(b.payload.event_source_url).toBeUndefined();
  });
  it("strips query strings from the page URL and needs one for website events", () => {
    const b = buildMetaEvent(ctx({ sourceUrl: "https://shop.example/thanks?email=jane%40gmail.com#done" }), NOW);
    if (!("payload" in b)) throw new Error("expected payload");
    expect(b.payload.event_source_url).toBe("https://shop.example/thanks");
    expect(JSON.stringify(b.payload)).not.toContain("jane");
    expect(pageUrl("not a url")).toBeNull();
    expect(pageUrl("javascript:alert(1)")).toBeNull();
    const noUrl = buildMetaEvent(ctx({ sourceUrl: null }), NOW);
    if (!("payload" in noUrl)) throw new Error("expected payload");
    expect(noUrl.payload.action_source).toBe("system_generated");
    expect(noUrl.payload.user_data.client_user_agent).toBe(ctx().userAgent);
  });
  it("skips events with nothing to match on, too old, or without a value", () => {
    expect(buildMetaEvent(ctx({ email: null, phoneHash: null, fbc: null, fbp: null }), NOW)).toHaveProperty("skip");
    expect(buildMetaEvent(ctx({ occurredAt: ago(8 * 24 * HOUR) }), NOW)).toHaveProperty("skip");
    expect(buildMetaEvent(ctx({ type: "purchase", amountMinor: 0, currency: "USD" }), NOW)).toHaveProperty("skip");
  });
  it("reads config from the connection", () => {
    expect(metaUploadConfig({ config: { pixelId: "1" }, secrets: { accessToken: "t" } })).toBeNull();
    expect(metaUploadConfig({ config: { capiEnabled: "on", pixelId: " 42 ", testEventCode: "" }, secrets: { accessToken: "a", capiAccessToken: "b" } })).toEqual({
      pixelId: "42",
      accessToken: "b",
      testEventCode: null,
      version: "v26.0",
    });
  });
  it("classifies responses", () => {
    expect(classifyMetaResponse(200, fixture("meta/capi_events_response.json"), 2)).toEqual({ ok: true });
    expect(classifyMetaResponse(200, { events_received: 1 }, 2)).toMatchObject({ ok: false, retryable: true });
    expect(classifyMetaResponse(400, fixture("meta/capi_error_invalid_parameter.json"), 1)).toMatchObject({ ok: false, retryable: false });
    expect(classifyMetaResponse(400, { error: { code: 613, message: "rate" } }, 1)).toMatchObject({ retryable: true });
    expect(classifyMetaResponse(503, null, 1)).toMatchObject({ retryable: true });
    // Token / permission / unknown pixel errors are retried (bounded) so fixing the setup lets them through.
    expect(classifyMetaResponse(400, { error: { code: 190, message: "token" } }, 1)).toMatchObject({ retryable: true });
    expect(classifyMetaResponse(403, { error: { code: 10, message: "permission" } }, 1)).toMatchObject({ retryable: true });
    expect(classifyMetaResponse(403, { error: { code: 200, message: "permission" } }, 1)).toMatchObject({ retryable: true });
    expect(classifyMetaResponse(400, { error: { code: 100, error_subcode: 33, message: "no pixel" } }, 1)).toMatchObject({ retryable: true });
    expect(classifyMetaResponse(400, { error: { code: 100, message: "invalid" } }, 1)).toMatchObject({ retryable: false });
  });
  it("isolates a bad event when Meta rejects the batch", async () => {
    const events = ["a", "b", "c"].map((id) => ({ event_id: id }) as MetaServerEvent);
    const calls: number[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const data = JSON.parse(String(init?.body)).data as MetaServerEvent[];
      calls.push(data.length);
      if (data.some((e) => e.event_id === "b")) return Response.json(fixture("meta/capi_error_invalid_parameter.json"), { status: 400 });
      return Response.json({ events_received: data.length });
    };
    const out = await sendMetaEvents({ pixelId: "1", accessToken: "t", testEventCode: null, version: "v26.0" }, events, fetchImpl);
    expect(calls).toEqual([3, 1, 1, 1]);
    expect(out.map((o) => o.ok)).toEqual([true, false, true]);
    expect(out[1]).toMatchObject({ retryable: false });
  });
});

describe("Google Data Manager API payload", () => {
  const cfg: GoogleUploadConfig = { customerId: "1234567890", loginCustomerId: null, actions: { lead: "111", purchase: "222" } };
  const granted = { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" };
  it("uses the click id, exact value, RFC 3339 time and consent", () => {
    const b = buildGoogleConversion(ctx({ type: "purchase", amountMinor: 1999, currency: "eur", googleClick: { type: "gclid", id: "Cj0KCQ" } }), cfg, "granted");
    expect(b).toEqual({
      payload: {
        destinationReferences: ["purchase"],
        transactionId: ctx().id,
        eventTimestamp: "2026-09-27T11:00:00.000Z",
        eventSource: "WEB",
        adIdentifiers: { gclid: "Cj0KCQ" },
        conversionValue: 19.99,
        currency: "EUR",
        consent: granted,
      },
    });
    const w = buildGoogleConversion(ctx({ googleClick: { type: "wbraid", id: "WB1" } }), cfg);
    expect("payload" in w && w.payload).toMatchObject({ adIdentifiers: { wbraid: "WB1" }, destinationReferences: ["lead"] });
    expect("payload" in w && w.payload.userData).toBeUndefined();
  });
  it("falls back to enhanced conversions for leads with a Google-normalized hex email hash", () => {
    const b = buildGoogleConversion(ctx(), cfg);
    expect("payload" in b && b.payload.userData).toEqual({ userIdentifiers: [{ emailAddress: sha256("janedoe@gmail.com") }] });
    expect(normalizeGoogleEmail(" A.B+x@GoogleMail.com")).toBe("ab+x@googlemail.com");
    expect(normalizeGoogleEmail("a.b@acme.com")).toBe("a.b@acme.com");
  });
  it("limited consent (GPC): both consent fields denied, never user identifiers", () => {
    const click = buildGoogleConversion(ctx({ googleClick: { type: "gclid", id: "G1" } }), cfg, "limited");
    expect("payload" in click && click.payload).toMatchObject({ adIdentifiers: { gclid: "G1" }, consent: { adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" } });
    expect("payload" in click && click.payload.userData).toBeUndefined();
    expect(buildGoogleConversion(ctx(), cfg, "limited")).toEqual({ skip: expect.any(String), reason: "limited_no_click_id" });
  });
  it("skips purchases without a click id and types without an action", () => {
    expect(buildGoogleConversion(ctx({ type: "purchase", amountMinor: 100, currency: "USD" }), cfg)).toMatchObject({ reason: "no_match_keys" });
    expect(buildGoogleConversion(ctx({ email: null }), cfg)).toMatchObject({ reason: "no_match_keys" });
    expect(buildGoogleConversion(ctx({ googleClick: { type: "gclid", id: "x" } }), { ...cfg, actions: { purchase: "222" } })).toMatchObject({ reason: "no_action" });
    expect(buildGoogleConversion(ctx({ type: "purchase", amountMinor: 0, currency: "USD", googleClick: { type: "gclid", id: "x" } }), cfg)).toMatchObject({ reason: "no_value" });
  });
  it("reads conversion action ids and config (old resource names still work)", () => {
    expect(conversionActionId("456")).toBe("456");
    expect(conversionActionId("customers/9/conversionActions/8")).toBe("8");
    expect(conversionActionId(" ")).toBeNull();
    expect(googleUploadConfig({ config: { customerIds: "123-456-7890", conversionUploads: "on" }, secrets: {} })).toBeNull();
    expect(googleUploadConfig({ config: { customerIds: "123-456-7890, 555", conversionUploads: "on", leadConversionActionId: "77", loginCustomerId: "111-222-3333" }, secrets: {} })).toEqual({
      customerId: "1234567890",
      loginCustomerId: "1112223333",
      actions: { lead: "77" },
    });
  });
  it("builds destinations only for the actions a batch uses, with the manager account as login account", () => {
    const ev = buildGoogleConversion(ctx({ googleClick: { type: "gclid", id: "x" } }), cfg);
    if (!("payload" in ev)) throw new Error("expected payload");
    const req = googleIngestRequest({ ...cfg, loginCustomerId: "9998887777" }, [ev.payload]);
    expect(req).toEqual({
      destinations: [
        {
          reference: "lead",
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
          loginAccount: { accountType: "GOOGLE_ADS", accountId: "9998887777" },
          productDestinationId: "111",
        },
      ],
      encoding: "HEX",
      events: [ev.payload],
    });
  });
  it("reads fast-fail errors: event violations by index, setup hints, retryability", () => {
    expect([...googleEventViolations(fixture("google_ads/datamanager_error_event_violations.json"))]).toEqual([[1, "INVALID_HEX_ENCODING — Email is not hex encoded."]]);
    const scope = googleRequestError(403, fixture("google_ads/datamanager_error_scope.json"));
    expect(scope).toMatchObject({ retryable: true, error: expect.stringContaining("Reconnect Google Ads") });
    expect(googleRequestError(503, { error: { status: "UNAVAILABLE", message: "down" } }).retryable).toBe(true);
    expect(googleRequestError(400, { error: { status: "INVALID_ARGUMENT", message: "bad" } }).retryable).toBe(false);
    expect(googleRequestError(403, { error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } }).error).toContain("Enable the Data Manager API");
  });
  it("fails only the events Google named and re-sends the rest", async () => {
    const events = ["a", "b", "c"].map((id) => ({ transactionId: id, destinationReferences: ["lead"] }) as GoogleEvent);
    const calls: string[][] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as GoogleIngestRequest;
      calls.push(body.events.map((e) => e.transactionId));
      if (body.events.some((e) => e.transactionId === "b")) return Response.json(fixture("google_ads/datamanager_error_event_violations.json"), { status: 400 });
      return Response.json(fixture("google_ads/datamanager_ingest_response.json"));
    };
    const out = await sendGoogleConversions({ config: {}, secrets: {} }, cfg, events, fetchImpl, async () => "tok");
    expect(calls).toEqual([["a", "b", "c"], ["a", "c"]]);
    expect(out.map((o) => o.ok)).toEqual([true, false, true]);
    expect(out[1]).toMatchObject({ retryable: false, error: expect.stringContaining("INVALID_HEX_ENCODING") });
  });
  it("needs no developer token and reports OAuth problems as retryable", async () => {
    const out = await sendGoogleConversions({ config: {}, secrets: {} }, cfg, [{ transactionId: "a" } as GoogleEvent], async () => Response.json({}), async () => {
      throw new Error("Google OAuth error: invalid_grant");
    });
    expect(out).toEqual([{ ok: false, retryable: true, error: "Google OAuth error: invalid_grant" }]);
  });
});

describe("consent rules for uploads", () => {
  it("denied beats everything, strict mode needs a yes, GPC limits, otherwise implied", () => {
    expect(uploadConsent({ adsConsent: "denied", gpc: false, strict: false })).toMatchObject({ basis: "denied", skip: "consent_denied" });
    expect(uploadConsent({ adsConsent: "denied", gpc: true, strict: true })).toMatchObject({ basis: "denied", skip: "consent_denied" });
    expect(uploadConsent({ adsConsent: null, gpc: false, strict: true })).toMatchObject({ basis: "none", skip: "no_ads_consent" });
    expect(uploadConsent({ adsConsent: "granted", gpc: false, strict: true })).toEqual({ basis: "granted" });
    expect(uploadConsent({ adsConsent: "granted", gpc: true, strict: true })).toEqual({ basis: "limited" }); // GPC wins over a banner yes
    expect(uploadConsent({ adsConsent: null, gpc: true, strict: false })).toEqual({ basis: "limited" });
    expect(uploadConsent({ adsConsent: null, gpc: false, strict: false })).toEqual({ basis: "implied" });
  });
  it("maps the basis onto each platform's fields", () => {
    expect(googleConsent("granted")).toEqual({ adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" });
    expect(googleConsent("implied")).toEqual({ adUserData: "CONSENT_STATUS_UNSPECIFIED", adPersonalization: "CONSENT_STATUS_UNSPECIFIED" });
    expect(googleConsent("limited")).toEqual({ adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" });
    const ldu = buildMetaEvent(ctx(), NOW, "limited");
    expect("payload" in ldu && ldu.payload).toMatchObject({ data_processing_options: ["LDU"], data_processing_options_country: 0, data_processing_options_state: 0 });
    const full = buildMetaEvent(ctx(), NOW, "granted");
    expect("payload" in full && full.payload.data_processing_options).toEqual([]);
    expect("payload" in full && full.payload).not.toHaveProperty("data_processing_options_country");
  });
});

describe("retry state machine", () => {
  it("retries with growing backoff, then gives up", () => {
    const fail = { ok: false as const, retryable: true, error: "HTTP 503" };
    let state = { attempts: 0 };
    const waits: number[] = [];
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const next = nextState(state, fail, NOW);
      expect(next).toMatchObject({ status: "pending", attempts: i, error: "HTTP 503" });
      waits.push(next.nextAttemptAt.getTime() - NOW.getTime());
      state = next;
    }
    expect(waits).toEqual([15 * MIN, HOUR, 4 * HOUR, 16 * HOUR]);
    expect(nextState(state, fail, NOW)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(backoffMs(10)).toBe(24 * HOUR);
  });
  it("fails permanent errors at once, marks sends and skips", () => {
    expect(nextState({ attempts: 0 }, { ok: false, retryable: false, error: "bad" }, NOW)).toMatchObject({ status: "failed", attempts: 1 });
    expect(nextState({ attempts: 2 }, { ok: true }, NOW)).toMatchObject({ status: "sent", attempts: 3, error: null, sentAt: NOW, mock: false });
    expect(nextState({ attempts: 0 }, { ok: true, mock: true }, NOW)).toMatchObject({ status: "sent", mock: true });
    expect(nextState({ attempts: 0 }, { skip: "nothing", reason: "no_match_keys" }, NOW)).toMatchObject({ status: "skipped", attempts: 0, error: "nothing", skipReason: "no_match_keys" });
  });
});

// ---------------------------------------------------------------- end to end (embedded Postgres)

describe("conversion uploads (database)", () => {
  let db: DB;
  let ws: Workspace;
  const ids = { leadA: "", payA: "", leadB: "", payOrphan: "" };

  beforeAll(async () => {
    ({ db, ws } = await setupWorkspace());
    const [a] = await db
      .insert(schema.contacts)
      .values({ workspaceId: ws.id, email: "jane.doe@gmail.com", emailHash: hashEmail("jane.doe@gmail.com"), phoneHash: hashPhone("+1 415 555 0100"), firstSeenAt: ago(5 * HOUR) })
      .returning();
    const [b] = await db.insert(schema.contacts).values({ workspaceId: ws.id, email: "bob@acme.com", emailHash: hashEmail("bob@acme.com"), firstSeenAt: ago(5 * HOUR) }).returning();
    const [v] = await db.insert(schema.visitors).values({ workspaceId: ws.id, anonymousId: "vid-a", firstSeenAt: ago(4 * HOUR), lastSeenAt: ago(HOUR), contactId: a.id }).returning();
    await db.insert(schema.touchpoints).values([
      { workspaceId: ws.id, visitorId: v.id, occurredAt: ago(4 * HOUR), channel: "paid_social", platform: "meta", clickIdType: "fbclid", clickId: "IwAR1", fbc: "fb.1.1.IwAR1", fbp: "fb.1.1.999" },
      { workspaceId: ws.id, visitorId: v.id, occurredAt: ago(3 * HOUR), channel: "paid_search", platform: "google", clickIdType: "gclid", clickId: "Cj0KCQjw-valid-gclid" },
    ]);
    await db.insert(schema.events).values({ workspaceId: ws.id, visitorId: v.id, type: "page_view", occurredAt: ago(2 * HOUR), url: "https://shop.example/pricing", ipTrunc: "203.0.113.0", userAgent: "Mozilla/5.0 Test" });
    const leads = await db
      .insert(schema.leads)
      .values([
        { workspaceId: ws.id, contactId: a.id, source: "pixel", occurredAt: ago(90 * MIN) },
        { workspaceId: ws.id, contactId: b.id, source: "webhook", occurredAt: ago(80 * MIN) },
      ])
      .returning();
    const pays = await db
      .insert(schema.revenueEvents)
      .values([
        { workspaceId: ws.id, contactId: a.id, source: "stripe", externalId: "pi_1", type: "payment", amountMinor: 12345, currency: "USD", occurredAt: ago(HOUR) },
        { workspaceId: ws.id, contactId: null, source: "stripe", externalId: "pi_2", type: "payment", amountMinor: 500, currency: "USD", occurredAt: ago(HOUR) },
        { workspaceId: ws.id, contactId: a.id, source: "stripe", externalId: "re_1", type: "refund", amountMinor: -100, currency: "USD", occurredAt: ago(HOUR) },
      ])
      .returning();
    ids.leadA = leads[0].id;
    ids.leadB = leads[1].id;
    ids.payA = pays[0].id;
    ids.payOrphan = pays[1].id;
    await saveConnection(ws.id, "meta", {
      mode: "live",
      config: { adAccountIds: "act_1", capiEnabled: "on", pixelId: "4242", testEventCode: "TEST123" },
      secrets: { accessToken: "EAAB-test-token" },
    }, db);
    await saveConnection(ws.id, "google_ads", {
      mode: "live",
      config: { customerIds: "123-456-7890", clientId: "cid", conversionUploads: "on", leadConversionActionId: "111", purchaseConversionActionId: "222" },
      secrets: { developerToken: "dev-token", clientSecret: "secret", refreshToken: "refresh" },
    }, db);
  });

  const uploads = (platform: "meta" | "google") =>
    db.select().from(schema.conversionUploads).where(and(eq(schema.conversionUploads.workspaceId, ws.id), eq(schema.conversionUploads.platform, platform)));
  const byConv = async (platform: "meta" | "google") => new Map((await uploads(platform)).map((u) => [u.conversionId, u]));

  beforeEach(async () => {
    await db.delete(schema.conversionUploads).where(eq(schema.conversionUploads.workspaceId, ws.id));
  });
  const savedMode = process.env.CONNECTOR_MODE;
  afterEach(() => {
    process.env.CONNECTOR_MODE = savedMode;
  });

  it("mock mode records uploads as sent without network, idempotently", async () => {
    const noFetch = async () => {
      throw new Error("network used in mock mode");
    };
    const r = await runConversionUploads(db, ws.id, { now: NOW, fetch: noFetch });
    // meta: 2 leads + 2 payments (refunds never uploaded); google: same 4
    expect(r).toMatchObject({ enqueued: 8, sent: 6, skipped: 2, failed: 0, retrying: 0 });
    const meta = await byConv("meta");
    expect(meta.get(ids.leadA)).toMatchObject({ status: "sent", mock: true, attempts: 1 });
    expect(meta.get(ids.payOrphan)).toMatchObject({ status: "skipped" });
    const google = await byConv("google");
    expect(google.get(ids.leadB)).toMatchObject({ status: "sent", mock: true }); // enhanced conversion for leads
    expect(google.get(ids.payOrphan)?.status).toBe("skipped");

    const again = await runConversionUploads(db, ws.id, { now: NOW, fetch: noFetch });
    expect(again).toMatchObject({ enqueued: 0, sent: 0 });
    expect(await uploads("meta")).toHaveLength(4);

    const stats = await uploadStats(db, ws.id);
    expect(stats.meta).toEqual({ sent: 3, limited: 0, failed: 0, pending: 0, skipped: 1, skippedConsent: 0 });
    expect(stats.google).toEqual({ sent: 3, limited: 0, failed: 0, pending: 0, skipped: 1, skippedConsent: 0 });
  });

  it("live mode: sends real payloads, retries transient errors with backoff", async () => {
    process.env.CONNECTOR_MODE = "";
    const metaBodies: { url: string; body: { data: MetaServerEvent[]; test_event_code?: string; access_token: string } }[] = [];
    const googleBodies: { url: string; headers: Record<string, string>; body: GoogleIngestRequest }[] = [];
    let metaDown = true;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.startsWith("https://graph.facebook.com/")) {
        metaBodies.push({ url, body });
        if (metaDown) return Response.json({ error: { message: "Service temporarily unavailable", code: 2, is_transient: true } }, { status: 503 });
        return Response.json({ events_received: body.data.length, messages: [], fbtrace_id: "x" });
      }
      googleBodies.push({ url, headers: init?.headers as Record<string, string>, body });
      return Response.json(fixture("google_ads/datamanager_ingest_response.json"));
    };
    const opts = { now: NOW, fetch: fetchImpl, googleAccessToken: async () => "ya29.test" };

    const r1 = await runConversionUploads(db, ws.id, opts);
    expect(r1).toMatchObject({ sent: 3, retrying: 3, skipped: 2, failed: 0 });

    // Meta request: pixel endpoint, hashed identifiers, exact value, dedup ids, test code.
    expect(metaBodies).toHaveLength(1);
    expect(metaBodies[0].url).toBe("https://graph.facebook.com/v26.0/4242/events");
    const { data, test_event_code, access_token } = metaBodies[0].body;
    expect(test_event_code).toBe("TEST123");
    expect(access_token).toBe("EAAB-test-token");
    const purchase = data.find((e) => e.event_id === `purchase_${ids.payA}`)!;
    expect(purchase).toMatchObject({
      event_name: "Purchase",
      action_source: "website",
      custom_data: { value: 123.45, currency: "USD" },
      event_source_url: "https://shop.example/pricing",
      user_data: { em: [hashEmail("jane.doe@gmail.com")], ph: [sha256("14155550100")], fbc: "fb.1.1.IwAR1", fbp: "fb.1.1.999", client_ip_address: "203.0.113.0", client_user_agent: "Mozilla/5.0 Test" },
    });
    const leadB = data.find((e) => e.event_id === `lead_${ids.leadB}`)!;
    expect(leadB).toMatchObject({ event_name: "Lead", action_source: "system_generated", user_data: { em: [hashEmail("bob@acme.com")] } });
    expect(JSON.stringify(metaBodies[0].body)).not.toMatch(/gmail\.com|acme\.com/);

    // Google request: Data Manager events:ingest, no developer token, one destination per action.
    expect(googleBodies).toHaveLength(1);
    expect(googleBodies[0].url).toBe(DATA_MANAGER_INGEST_URL);
    expect(googleBodies[0].headers).toMatchObject({ Authorization: "Bearer ya29.test" });
    expect(googleBodies[0].headers).not.toHaveProperty("developer-token");
    const { destinations, events, encoding } = googleBodies[0].body;
    expect(encoding).toBe("HEX");
    expect(destinations).toEqual([
      { reference: "lead", operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, productDestinationId: "111" },
      { reference: "purchase", operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" }, productDestinationId: "222" },
    ]);
    const unspecified = { adUserData: "CONSENT_STATUS_UNSPECIFIED", adPersonalization: "CONSENT_STATUS_UNSPECIFIED" };
    expect(events.find((e) => e.transactionId === ids.payA)).toEqual({
      destinationReferences: ["purchase"],
      transactionId: ids.payA,
      eventTimestamp: "2026-09-27T11:00:00.000Z",
      eventSource: "WEB",
      adIdentifiers: { gclid: "Cj0KCQjw-valid-gclid" },
      conversionValue: 123.45,
      currency: "USD",
      consent: unspecified,
    });
    expect(events.find((e) => e.transactionId === ids.leadB)).toMatchObject({
      destinationReferences: ["lead"],
      userData: { userIdentifiers: [{ emailAddress: sha256("bob@acme.com") }] },
      consent: unspecified,
    });
    expect(JSON.stringify(googleBodies[0].body)).not.toMatch(/gmail\.com|acme\.com/);

    const pending = await byConv("meta");
    expect(pending.get(ids.leadA)).toMatchObject({ status: "pending", attempts: 1, error: expect.stringContaining("503") });
    expect(pending.get(ids.leadA)!.nextAttemptAt.getTime()).toBe(NOW.getTime() + 15 * MIN);
    expect((await byConv("google")).get(ids.payA)).toMatchObject({ status: "sent", mock: false });

    // Not due yet: nothing is sent.
    metaDown = false;
    const r2 = await runConversionUploads(db, ws.id, { ...opts, now: new Date(NOW.getTime() + 5 * MIN) });
    expect(r2).toMatchObject({ enqueued: 0, sent: 0, retrying: 0 });
    expect(metaBodies).toHaveLength(1);

    // After the backoff the retry goes through with the same event ids.
    const r3 = await runConversionUploads(db, ws.id, { ...opts, now: new Date(NOW.getTime() + 16 * MIN) });
    expect(r3).toMatchObject({ sent: 3, retrying: 0 });
    expect(metaBodies[1].body.data.map((e) => e.event_id).sort()).toEqual(data.map((e) => e.event_id).sort());
    const done = await byConv("meta");
    expect(done.get(ids.leadA)).toMatchObject({ status: "sent", attempts: 2, error: null, mock: false });
    expect(googleBodies).toHaveLength(1); // Google conversions already sent are never re-uploaded
  });

  it("live mode: gives up after the maximum number of attempts", async () => {
    process.env.CONNECTOR_MODE = "";
    let calls = 0;
    const down = async () => {
      calls++;
      return new Response("upstream down", { status: 502 });
    };
    let t = NOW.getTime();
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
      await runConversionUploads(db, ws.id, { now: new Date(t), fetch: down, googleAccessToken: async () => "tok" });
      t += 25 * HOUR;
      if (t - NOW.getTime() > 6 * 24 * HOUR) break; // stay inside Meta's 7-day window
    }
    const meta = await byConv("meta");
    expect(meta.get(ids.leadA)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, error: expect.stringContaining("502") });
    const google = await byConv("google");
    expect(google.get(ids.payA)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(calls).toBe(MAX_ATTEMPTS * 2); // one batch per platform per attempt
    const stats = await uploadStats(db, ws.id);
    expect(stats.meta).toMatchObject({ failed: 3, skipped: 1, sent: 0, pending: 0 });
  });

  it("re-sends uploads that mock mode only recorded once the platform runs live", async () => {
    process.env.CONNECTOR_MODE = "mock";
    const mock = await runConversionUploads(db, ws.id, { now: NOW });
    expect(mock).toMatchObject({ sent: 6, skipped: 2 });

    process.env.CONNECTOR_MODE = "";
    const sentIds: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.startsWith("https://graph.facebook.com/")) {
        sentIds.push(...body.data.map((e: MetaServerEvent) => e.event_id));
        return Response.json({ events_received: body.data.length });
      }
      sentIds.push(...(body as GoogleIngestRequest).events.map((e) => e.transactionId));
      return Response.json(fixture("google_ads/datamanager_ingest_response.json"));
    };
    const opts = { now: new Date(NOW.getTime() + MIN), fetch: fetchImpl, googleAccessToken: async () => "tok" };
    const live = await runConversionUploads(db, ws.id, opts);
    expect(live).toMatchObject({ sent: 6, failed: 0 });
    expect(sentIds).toHaveLength(6);
    expect((await byConv("meta")).get(ids.leadA)).toMatchObject({ status: "sent", mock: false, attempts: 1 });
    expect((await byConv("meta")).get(ids.payOrphan)).toMatchObject({ status: "skipped" });

    // Nothing is sent twice.
    await runConversionUploads(db, ws.id, { ...opts, now: new Date(NOW.getTime() + 2 * HOUR) });
    expect(sentIds).toHaveLength(6);
  });

  it("consent: GPC goes out limited (Meta LDU, Google without identifiers), a refusal is skipped", async () => {
    process.env.CONNECTOR_MODE = "";
    const metaEvents: MetaServerEvent[] = [];
    const googleEvents: GoogleEvent[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.startsWith("https://graph.facebook.com/")) {
        metaEvents.push(...body.data);
        return Response.json({ events_received: body.data.length });
      }
      googleEvents.push(...(body as GoogleIngestRequest).events);
      return Response.json(fixture("google_ads/datamanager_ingest_response.json"));
    };
    await db.update(schema.visitors).set({ gpc: true }).where(and(eq(schema.visitors.workspaceId, ws.id), eq(schema.visitors.anonymousId, "vid-a")));
    await db.update(schema.contacts).set({ adsConsent: "denied" }).where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.email, "bob@acme.com")));
    try {
      const r = await runConversionUploads(db, ws.id, { now: NOW, fetch: fetchImpl, googleAccessToken: async () => "tok" });
      // Jane (GPC): lead + payment on both platforms, limited. Bob said no. The orphan payment has no one to match.
      expect(r).toMatchObject({ sent: 4, limited: 4, skipped: 4, failed: 0 });
      expect(metaEvents).toHaveLength(2);
      for (const e of metaEvents) expect(e).toMatchObject({ data_processing_options: ["LDU"], data_processing_options_country: 0, data_processing_options_state: 0 });
      expect(googleEvents).toHaveLength(2);
      for (const e of googleEvents) {
        expect(e.consent).toEqual({ adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" });
        expect(e.adIdentifiers).toEqual({ gclid: "Cj0KCQjw-valid-gclid" });
        expect(e.userData).toBeUndefined();
      }
      const meta = await byConv("meta");
      expect(meta.get(ids.leadA)).toMatchObject({ status: "sent", consentMode: "limited", skipReason: null });
      expect(meta.get(ids.leadB)).toMatchObject({ status: "skipped", consentMode: "denied", skipReason: "consent_denied", error: "Ads consent denied" });
      expect(meta.get(ids.payOrphan)).toMatchObject({ status: "skipped", skipReason: "no_match_keys" });
      expect((await byConv("google")).get(ids.leadB)).toMatchObject({ status: "skipped", skipReason: "consent_denied" });
      const stats = await uploadStats(db, ws.id, 7, NOW);
      expect(stats.meta).toEqual({ sent: 2, limited: 2, failed: 0, pending: 0, skipped: 2, skippedConsent: 1 });
      expect(stats.google).toEqual({ sent: 2, limited: 2, failed: 0, pending: 0, skipped: 2, skippedConsent: 1 });
    } finally {
      await db.update(schema.visitors).set({ gpc: false }).where(eq(schema.visitors.workspaceId, ws.id));
      await db.update(schema.contacts).set({ adsConsent: null }).where(eq(schema.contacts.workspaceId, ws.id));
    }
  });

  it("consent: a strict pixel (EU/UK) uploads only contacts who said yes, with Google consent granted", async () => {
    process.env.CONNECTOR_MODE = "";
    const googleEvents: GoogleEvent[] = [];
    const metaEvents: MetaServerEvent[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (url.startsWith("https://graph.facebook.com/")) {
        metaEvents.push(...body.data);
        return Response.json({ events_received: body.data.length });
      }
      googleEvents.push(...(body as GoogleIngestRequest).events);
      return Response.json(fixture("google_ads/datamanager_ingest_response.json"));
    };
    const [site] = await db.insert(schema.pixelSites).values({ workspaceId: ws.id, name: "EU shop", publicKey: "pk_strict_capi01", consentMode: "required" }).returning();
    await db.update(schema.contacts).set({ adsConsent: "granted" }).where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.email, "jane.doe@gmail.com")));
    try {
      const r = await runConversionUploads(db, ws.id, { now: NOW, fetch: fetchImpl, googleAccessToken: async () => "tok" });
      expect(r).toMatchObject({ sent: 4, limited: 0, skipped: 4 });
      expect(googleEvents.map((e) => e.consent)).toEqual([
        { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
        { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" },
      ]);
      for (const e of metaEvents) expect(e.data_processing_options).toEqual([]);
      const google = await byConv("google");
      expect(google.get(ids.leadA)).toMatchObject({ status: "sent", consentMode: "granted" });
      // Bob never answered, and the orphan payment has no person: no consent, not uploaded.
      expect(google.get(ids.leadB)).toMatchObject({ status: "skipped", consentMode: "none", skipReason: "no_ads_consent" });
      expect(google.get(ids.payOrphan)).toMatchObject({ status: "skipped", skipReason: "no_ads_consent" });
    } finally {
      await db.delete(schema.pixelSites).where(eq(schema.pixelSites.id, site.id));
      await db.update(schema.contacts).set({ adsConsent: null }).where(eq(schema.contacts.workspaceId, ws.id));
    }
  });

  it("mock mode runs the real request shape against the mock Data Manager API", async () => {
    process.env.CONNECTOR_MODE = "mock";
    const r = await runConversionUploads(db, ws.id, { now: NOW });
    expect(r).toMatchObject({ sent: 6, failed: 0 });
    // The mock answers like events:ingest: a requestId, or a fast-fail error naming the bad event.
    const ok = await mockDataManagerFetch(DATA_MANAGER_INGEST_URL, {
      method: "POST",
      body: JSON.stringify({
        destinations: [{ reference: "lead", operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1" }, productDestinationId: "2" }],
        encoding: "HEX",
        events: [{ destinationReferences: ["lead"], transactionId: "t", eventTimestamp: NOW.toISOString(), eventSource: "WEB", adIdentifiers: { gclid: "g" }, consent: { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" } }],
      }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ requestId: expect.stringMatching(/^t-/) });
    const bad = await mockDataManagerFetch(DATA_MANAGER_INGEST_URL, {
      method: "POST",
      body: JSON.stringify({ destinations: [], encoding: "HEX", events: [{ transactionId: "t", eventTimestamp: NOW.toISOString(), adIdentifiers: { gclid: "g" } }] }),
    });
    expect(bad.status).toBe(400);
    expect([...googleEventViolations(await bad.json())].map(([i, m]) => [i, m.split(" ")[0]])).toEqual([[0, "INVALID_ARGUMENT"]]);
  });

  it("does nothing while uploads are switched off", async () => {
    await saveConnection(ws.id, "meta", { config: { capiEnabled: "" } }, db);
    await saveConnection(ws.id, "google_ads", { config: { conversionUploads: "" } }, db);
    const r = await runConversionUploads(db, ws.id, { now: NOW });
    expect(r.enqueued).toBe(0);
    expect(await uploads("meta")).toHaveLength(0);
  });
});
