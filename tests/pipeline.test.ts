import { eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { recomputeAttribution } from "@/lib/attribution";
import { handleStripeEvent, ingestCharge, verifyStripeSignature } from "@/lib/connectors/stripe";
import { rows, schema, type DB } from "@/lib/db";
import { overview, performance } from "@/lib/reports";
import type { Workspace } from "@/lib/settings";
import { saveConnection } from "@/lib/settings";
import { syncProvider, upsertAdRows } from "@/lib/sync";
import { processCollect } from "@/lib/tracking/collect";
import { setupWorkspace } from "./helpers";

// End-to-end: pixel collect -> identify/lead -> Stripe -> ad sync -> attribution -> reports.

let db: DB;
let ws: Workspace;
const SITE = "pk_testsite0001";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const ctx = (now: string) => ({ origin: "http://localhost:8080", userAgent: UA, ip: "203.0.113.9", now: new Date(now) });

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await db.insert(schema.pixelSites).values({ workspaceId: ws.id, name: "Test", domains: "localhost", publicKey: SITE });
});

describe("pixel collection", () => {
  it("creates visitor, event and a paid_social touchpoint (acceptance example)", async () => {
    const r = await processCollect(
      db,
      { site: SITE, vid: "visitor-aaaaaaaa", events: [{ t: "page_view", ts: Date.parse("2026-09-01T10:00:00Z"), url: "http://localhost:8080/?utm_source=facebook&utm_campaign=123&fbclid=abc", ref: null }] },
      ctx("2026-09-01T10:00:05Z"),
    );
    expect(r.ok).toBe(true);
    const [tp] = await db.select().from(schema.touchpoints).where(eq(schema.touchpoints.workspaceId, ws.id));
    expect(tp.channel).toBe("paid_social");
    expect(tp.fbc).toMatch(/^fb\.1\.\d+\.abc$/);
    const [ev] = await db.select().from(schema.events);
    expect(ev.ipTrunc).toBe("203.0.113.0");
  });

  it("deduplicates page refreshes into one touchpoint", async () => {
    await processCollect(
      db,
      { site: SITE, vid: "visitor-aaaaaaaa", events: [{ t: "page_view", ts: Date.parse("2026-09-01T10:05:00Z"), url: "http://localhost:8080/?utm_source=facebook&utm_campaign=123&fbclid=abc" }] },
      ctx("2026-09-01T10:05:01Z"),
    );
    const tps = await db.select().from(schema.touchpoints);
    expect(tps).toHaveLength(1);
  });

  it("rejects unknown sites and disallowed origins", async () => {
    const payload = { site: "pk_doesnotexist", vid: "visitor-bbbbbbbb", events: [{ t: "page_view" as const, url: "http://x/" }] };
    expect(await processCollect(db, payload, ctx("2026-09-01T10:00:00Z"))).toMatchObject({ ok: false, status: 404 });
    expect(
      await processCollect(db, { ...payload, site: SITE }, { ...ctx("2026-09-01T10:00:00Z"), origin: "https://evil.example" }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("identify + lead creates a contact linked to the visitor's touchpoints", async () => {
    const r = await processCollect(
      db,
      { site: SITE, vid: "visitor-aaaaaaaa", events: [{ t: "lead", ts: Date.parse("2026-09-01T10:10:00Z"), url: "http://localhost:8080/signup", name: "Demo form", traits: { email: " Jane@Example.com ", name: "Jane" } }] },
      ctx("2026-09-01T10:10:01Z"),
    );
    expect(r).toMatchObject({ ok: true, newLeads: 1 });
    const [c] = await db.select().from(schema.contacts);
    expect(c.email).toBe("jane@example.com");
    const [v] = await db.select().from(schema.visitors).where(eq(schema.visitors.anonymousId, "visitor-aaaaaaaa"));
    expect(v.contactId).toBe(c.id);
  });

  it("stitches a second device to the same contact by email", async () => {
    await processCollect(
      db,
      {
        site: SITE,
        vid: "visitor-phone001",
        events: [
          { t: "page_view", ts: Date.parse("2026-09-03T08:00:00Z"), url: "http://localhost:8080/?utm_source=google&utm_medium=cpc&utm_campaign=777&gclid=g1" },
          { t: "identify", ts: Date.parse("2026-09-03T08:01:00Z"), url: "http://localhost:8080/app", traits: { email: "jane@example.com" } },
        ],
      },
      ctx("2026-09-03T08:02:00Z"),
    );
    const contacts = await db.select().from(schema.contacts);
    expect(contacts).toHaveLength(1);
    const visitors = await db.select().from(schema.visitors).where(eq(schema.visitors.contactId, contacts[0].id));
    expect(visitors).toHaveLength(2);
  });

  it("never stores raw emails outside contacts (and admin users)", async () => {
    const tables = rows<{ table_name: string }>(
      await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`),
    ).map((r) => r.table_name);
    for (const t of tables) {
      if (t === "contacts" || t === "users") continue;
      const hits = rows<{ n: string }>(await db.execute(sql.raw(`select count(*) n from "${t}" t where t::text ilike '%jane@example.com%'`)));
      expect(Number(hits[0].n), `raw email leaked into ${t}`).toBe(0);
    }
  });
});

describe("Stripe", () => {
  const secret = "whsec_test_secret";
  const charge = {
    id: "ch_1",
    object: "charge",
    amount: 50000,
    amount_captured: 50000,
    amount_refunded: 0,
    currency: "usd",
    created: Math.floor(Date.parse("2026-09-05T12:00:00Z") / 1000),
    paid: true,
    status: "succeeded",
    payment_intent: "pi_1",
    customer: "cus_1",
    billing_details: { email: "jane@example.com" },
    metadata: {},
  };
  const event = (type: string, object: unknown, id = "evt_1") => ({ id, object: "event", type, created: charge.created, data: { object } });

  it("verifies signatures (valid passes, invalid rejected)", () => {
    const payload = JSON.stringify(event("charge.succeeded", charge));
    const header = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret });
    expect(verifyStripeSignature(payload, header, secret).type).toBe("charge.succeeded");
    expect(() => verifyStripeSignature(payload, header, "whsec_wrong")).toThrow();
    expect(() => verifyStripeSignature(payload, "t=1,v1=deadbeef", secret)).toThrow();
  });

  it("is idempotent: the same webhook twice creates one revenue event", async () => {
    await handleStripeEvent(db, ws.id, event("charge.succeeded", charge));
    await handleStripeEvent(db, ws.id, event("charge.succeeded", charge));
    const rev = await db.select().from(schema.revenueEvents);
    expect(rev).toHaveLength(1);
    expect(rev[0].amountMinor).toBe(50000);
    const [c] = await db.select().from(schema.contacts);
    expect(rev[0].contactId).toBe(c.id);
    expect(c.lifecycle).toBe("customer");
  });

  it("records refunds as a negative event linked to the payment", async () => {
    await handleStripeEvent(db, ws.id, event("charge.refunded", { ...charge, amount_refunded: 10000 }, "evt_2"));
    await handleStripeEvent(db, ws.id, event("charge.refunded", { ...charge, amount_refunded: 10000 }, "evt_2"));
    const refunds = await db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.type, "refund"));
    expect(refunds).toHaveLength(1);
    expect(refunds[0].amountMinor).toBe(-10000);
    expect(refunds[0].relatedExternalId).toBe("pi_1");
  });

  it("links a later checkout session to an earlier anonymous charge", async () => {
    await ingestCharge(db, ws.id, { ...charge, id: "ch_anon", payment_intent: "pi_anon", billing_details: {}, customer: null });
    const [anon] = await db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.externalId, "pi_anon"));
    expect(anon.contactId).toBeNull();
    await handleStripeEvent(db, ws.id, event("checkout.session.completed", { id: "cs_1", mode: "payment", payment_intent: "pi_anon", client_reference_id: "visitor-phone001", created: charge.created }, "evt_3"));
    const [linked] = await db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.externalId, "pi_anon"));
    expect(linked.contactId).not.toBeNull();
  });
});

describe("ad sync + attribution", () => {
  it("syncs mock ads idempotently and keeps Google micros exact", async () => {
    await saveConnection(ws.id, "meta", { mode: "mock", config: {} }, db);
    await saveConnection(ws.id, "google_ads", { mode: "mock", config: {} }, db);
    const window = { since: "2026-08-01", until: "2026-09-05" };
    const a = await syncProvider(db, ws.id, "meta", { window, inlineAttribution: true });
    const b = await syncProvider(db, ws.id, "google_ads", { window, inlineAttribution: true });
    expect(a.status).toBe("success");
    expect(b.status).toBe("success");
    const count = async () => rows<{ n: string }>(await db.execute(sql`select count(*) n from ad_insights_daily`))[0].n;
    const first = await count();
    await syncProvider(db, ws.id, "meta", { window });
    expect(await count()).toBe(first);
    const accounts = await db.select().from(schema.adAccounts);
    expect(accounts.filter((x) => x.platform === "meta")).toHaveLength(2);
    expect(accounts.filter((x) => x.platform === "google")).toHaveLength(1);
  });

  it("upserts restated spend instead of duplicating", async () => {
    const row = {
      platform: "google" as const,
      account: { externalId: "999", name: "Restate", currency: "USD", timezone: null },
      campaign: { externalId: "c9", name: "C9", status: null, objective: null },
      adGroup: { externalId: "g9", name: "G9", status: null },
      ad: { externalId: "a9", name: "A9", status: null },
      date: "2026-09-01",
      spendMinor: 100,
      impressions: 10,
      clicks: 1,
      conversions: "0",
    };
    await upsertAdRows(db, ws.id, [row]);
    await upsertAdRows(db, ws.id, [{ ...row, spendMinor: 250 }]);
    const r = rows<{ spend_minor: string }>(await db.execute(sql`select i.spend_minor from ad_insights_daily i join ads a on a.id = i.ad_id where a.external_id = 'a9'`));
    expect(r).toHaveLength(1);
    expect(Number(r[0].spend_minor)).toBe(250);
  });

  it("allocates every revenue event exactly under every model", async () => {
    await recomputeAttribution(db, ws.id);
    const bad = rows(
      await db.execute(sql`
        select r.id, c.model from revenue_events r
        join attribution_credits c on c.conversion_id = r.id and c.conversion_type = 'revenue'
        group by r.id, c.model, r.amount_minor having sum(c.revenue_minor) <> r.amount_minor`),
    );
    expect(bad).toHaveLength(0);
    const models = rows<{ model: string }>(await db.execute(sql`select distinct model from attribution_credits`)).map((r) => r.model).sort();
    expect(models).toEqual(["first_touch", "last_touch", "linear"]);
  });

  it("first-touch and last-touch credit different touchpoints", async () => {
    const p = { start: "2026-08-01", end: "2026-09-30" };
    const first = rows<{ channel: string }>(await db.execute(sql`select channel from attribution_credits where model = 'first_touch' and conversion_type = 'lead'`));
    const last = rows<{ channel: string }>(await db.execute(sql`select channel from attribution_credits where model = 'last_touch' and conversion_type = 'lead'`));
    expect(first[0].channel).toBe("paid_social");
    expect(last[0].channel).toBe("paid_social"); // the lead happened before the Google click
    const cust = rows<{ model: string; channel: string }>(
      await db.execute(sql`select model, channel from attribution_credits where conversion_type = 'customer' order by model`),
    );
    expect(cust.find((c) => c.model === "first_touch")?.channel).toBe("paid_social");
    expect(cust.find((c) => c.model === "last_touch")?.channel).toBe("paid_search");
    const lin = await overview(db, ws, { ...p, model: "linear" });
    expect(lin.customers).toBe(1);
    const perf = await performance(db, ws, { ...p, model: "linear", level: "campaign" });
    expect(Array.isArray(perf)).toBe(true);
  });

  it("date filters are inclusive and timezone-aware", async () => {
    // The payment is 2026-09-05 12:00 UTC.
    const utc = await overview(db, ws, { start: "2026-09-05", end: "2026-09-05", model: "linear" });
    expect(utc.revenueMinor).toBeGreaterThan(0);
    const tokyo = { ...ws, timezone: "Pacific/Kiritimati" }; // UTC+14 -> 2026-09-06 02:00 local
    const k5 = await overview(db, tokyo, { start: "2026-09-05", end: "2026-09-05", model: "linear" });
    const k6 = await overview(db, tokyo, { start: "2026-09-06", end: "2026-09-06", model: "linear" });
    expect(k6.revenueMinor).toBe(utc.revenueMinor);
    expect(k5.revenueMinor).not.toBe(utc.revenueMinor);
  });
});
