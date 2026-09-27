import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { recomputeAttribution } from "@/lib/attribution";
import { mockMetaInsights, parseMetaInsights } from "@/lib/connectors/ads";
import { schema, type DB } from "@/lib/db";
import type { Channel, Platform } from "@/lib/db/schema";
import { comparisonRange } from "@/lib/period-presets";
import { performancePeek, performanceReport, quadrantOf } from "@/lib/reports-performance";
import type { Workspace } from "@/lib/settings";
import { upsertAdRows } from "@/lib/sync";
import { setupWorkspace } from "./helpers";

// A hand-checkable ledger (USD, UTC, 30-day window), last-touch model:
//
//   Meta "Prospecting"  Jul 1: spend $100, 4,000 impressions, 40 clicks, Meta reports 5 conversions
//   Google "Brand"      Jul 1: spend $50, 1,000 impressions, 10 clicks, reports 0 conversions
//
//   Alice  Meta touch Jul 1, lead Jul 2, pays $90 Jul 5 and $30 Aug 5 (repeat → inherits Meta)
//   Bob    Meta touch Jul 10, lead Jul 10, never pays
//   Cara   Google touch Jul 10, pays $60 Jul 12 (no lead)
//
// Meta: 2 leads, 1 customer, $120 revenue from 2 purchases, $90 of it a first payment.
//   CTR 1% · CPM $25 · CPC $2.50 · CVR 5% · CPL $50 · CAC $100 · lead→customer 50% · AOV $60
//   ROAS 1.2 · NC-ROAS 0.9 · AdLedger conversions 3 (2 leads + 1 customer) → gap (5 − 3) ÷ 3
// Google: 0 leads, 1 customer, $60 · ROAS 1.2 · NC-ROAS 1.2 · no gap (platform reports nothing)

let db: DB;
let ws: Workspace;
let other: Workspace;
type Ids = { campaignId: string; adGroupId: string; adId: string };
const ids: Record<string, Ids> = {};
const otherIds: Record<string, Ids> = {};
const JUL_SEP = { start: "2026-07-01", end: "2026-09-30", model: "last_touch" as const };

const ad = (platform: Platform, key: string, name: string, spendMinor: number, impressions: number, clicks: number, conversions: string) => ({
  platform,
  account: { externalId: `acc-${key}`, name: `${name} account`, currency: "USD", timezone: null },
  campaign: { externalId: `c-${key}`, name, status: "active", objective: null },
  adGroup: { externalId: `g-${key}`, name: `${name} group`, status: null },
  ad: { externalId: `a-${key}`, name: `${name} ad`, status: null },
  date: "2026-07-01",
  spendMinor,
  impressions,
  clicks,
  conversions,
});

async function person(
  w: Workspace,
  entities: Record<string, Ids>,
  name: string,
  touch: { at: string; key: "meta" | "google" },
  lead: string | null,
  payments: { id: string; at: string; amount: number }[],
) {
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: w.id, email: `${name.toLowerCase()}@example.com`, name, firstSeenAt: new Date(touch.at), lifecycle: payments.length ? "customer" : "lead" })
    .returning();
  const [v] = await db
    .insert(schema.visitors)
    .values({ workspaceId: w.id, anonymousId: `vid-${w.id}-${name}`, firstSeenAt: new Date(touch.at), lastSeenAt: new Date(touch.at), contactId: c.id })
    .returning();
  const channel: Channel = touch.key === "meta" ? "paid_social" : "paid_search";
  await db.insert(schema.touchpoints).values({ workspaceId: w.id, visitorId: v.id, occurredAt: new Date(touch.at), channel, platform: touch.key, ...entities[touch.key] });
  if (lead) await db.insert(schema.leads).values({ workspaceId: w.id, contactId: c.id, source: "api", occurredAt: new Date(lead) });
  for (const p of payments) {
    await db.insert(schema.revenueEvents).values({ workspaceId: w.id, contactId: c.id, source: "api", externalId: `${w.id}-${p.id}`, type: "payment", amountMinor: p.amount, currency: "USD", occurredAt: new Date(p.at) });
  }
}

async function collectIds(w: Workspace, into: Record<string, Ids>) {
  for (const a of await db.select().from(schema.ads).where(eq(schema.ads.workspaceId, w.id))) {
    into[a.platform] = { campaignId: a.campaignId, adGroupId: a.adGroupId, adId: a.id };
  }
}

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await upsertAdRows(db, ws.id, [ad("meta", "meta", "Prospecting", 10_000, 4000, 40, "5"), ad("google", "google", "Brand", 5_000, 1000, 10, "0")]);
  await collectIds(ws, ids);
  await person(ws, ids, "Alice", { at: "2026-07-01T10:00:00Z", key: "meta" }, "2026-07-02T10:00:00Z", [
    { id: "a1", at: "2026-07-05T10:00:00Z", amount: 9_000 },
    { id: "a2", at: "2026-08-05T10:00:00Z", amount: 3_000 },
  ]);
  await person(ws, ids, "Bob", { at: "2026-07-10T10:00:00Z", key: "meta" }, "2026-07-10T11:00:00Z", []);
  await person(ws, ids, "Cara", { at: "2026-07-10T10:00:00Z", key: "google" }, null, [{ id: "c1", at: "2026-07-12T10:00:00Z", amount: 6_000 }]);
  await recomputeAttribution(db, ws.id);

  // A second workspace in the same database with much bigger numbers: must never leak into the first.
  const [o] = await db
    .insert(schema.workspaces)
    .values({ organizationId: ws.organizationId, name: "Other", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" })
    .returning();
  other = o as Workspace;
  await upsertAdRows(db, other.id, [ad("meta", "meta", "Prospecting", 900_000, 90_000, 900, "80")]);
  await collectIds(other, otherIds);
  await person(other, otherIds, "Zed", { at: "2026-07-01T10:00:00Z", key: "meta" }, "2026-07-01T11:00:00Z", [{ id: "z1", at: "2026-07-02T10:00:00Z", amount: 500_000 }]);
  await recomputeAttribution(db, other.id);
}, 120_000);

describe("performance v2 metrics", () => {
  it("computes every column in SQL", async () => {
    const r = await performanceReport(db, ws, { ...JUL_SEP, level: "campaign" });
    expect(r.rows.map((x) => x.name)).toEqual(["Prospecting", "Brand"]);
    const meta = r.rows[0];
    expect(meta).toMatchObject({
      spendMinor: 10_000,
      impressions: 4000,
      clicks: 40,
      ctr: 0.01,
      cpmMinor: 2_500,
      cpcMinor: 250,
      leads: 2,
      cplMinor: 5_000,
      cvr: 0.05,
      customers: 1,
      cacMinor: 10_000,
      leadToCustomer: 0.5,
      purchases: 2,
      revenueMinor: 12_000,
      aovMinor: 6_000,
      roas: 1.2,
      newCustomerRevenueMinor: 9_000,
      ncRoas: 0.9,
      platformConversions: 5,
      verifiedConversions: 3,
    });
    expect(meta.platformGap).toBeCloseTo(2 / 3, 6);

    const google = r.rows[1];
    expect(google).toMatchObject({ leads: 0, cplMinor: null, cvr: 0, customers: 1, revenueMinor: 6_000, ncRoas: 1.2, leadToCustomer: null });
    // Google reports no conversions: no gap rather than a misleading −100%.
    expect(google.platformGap).toBeNull();
    expect(meta.delta).toBeNull();
  });

  it("totals come from SQL and match the sum of the rows", async () => {
    const r = await performanceReport(db, ws, { ...JUL_SEP, level: "campaign" });
    expect(r.totals).toMatchObject({ count: 2, spendMinor: 15_000, revenueMinor: 18_000, leads: 2, customers: 2, roas: 1.2, platformConversions: 5, verifiedConversions: 4 });
    expect(r.totals.platformGap).toBeCloseTo(0.25, 6);
    expect(r.totals.ncRoas).toBeCloseTo(15_000 / 15_000, 6);
    expect(r.totals.cpmMinor).toBe(3_000);
  });

  it("filters by name, escaping LIKE wildcards", async () => {
    expect((await performanceReport(db, ws, { ...JUL_SEP, level: "campaign", q: "bRAN" })).rows.map((x) => x.name)).toEqual(["Brand"]);
    const none = await performanceReport(db, ws, { ...JUL_SEP, level: "campaign", q: "%" });
    expect(none.rows).toHaveLength(0);
    expect(none.totals).toMatchObject({ count: 0, spendMinor: 0, roas: null });
    // Ad sets match on their campaign's name too.
    expect((await performanceReport(db, ws, { ...JUL_SEP, level: "ad_group", q: "prospect" })).rows.map((x) => x.name)).toEqual(["Prospecting group"]);
  });

  it("compares against the previous period", async () => {
    const aug = { start: "2026-08-01", end: "2026-08-31", model: "last_touch" as const };
    const r = await performanceReport(db, ws, { ...aug, level: "campaign", comparison: comparisonRange(aug.start, aug.end, "prev") });
    expect(r.compare).toEqual({ start: "2026-07-01", end: "2026-07-31" });
    const meta = r.rows.find((x) => x.name === "Prospecting")!;
    expect(meta.revenueMinor).toBe(3_000);
    expect(meta.delta!.revenueMinor).toBeCloseTo((3_000 - 9_000) / 9_000, 6);
    // No spend in August: nothing to compare the ratio with.
    expect(meta.delta!.roas).toBeNull();
    expect(r.totalsDelta!.revenueMinor).toBeCloseTo((3_000 - 15_000) / 15_000, 6);
    expect((await performanceReport(db, ws, { ...aug, level: "campaign", comparison: comparisonRange(aug.start, aug.end, "none") })).compare).toBeNull();
  });

  it("splits rows into Scale / Test / Fix / Kill", async () => {
    const r = await performanceReport(db, ws, { ...JUL_SEP, level: "campaign" });
    expect(r.split).toEqual({ spendMinor: 7_500, roas: 1 });
    expect(Object.fromEntries(r.rows.map((x) => [x.name, x.quadrant]))).toEqual({ Prospecting: "scale", Brand: "test" });
    const strict = await performanceReport(db, ws, { ...JUL_SEP, level: "campaign", roasSplit: 2 });
    expect(Object.fromEntries(strict.rows.map((x) => [x.name, x.quadrant]))).toEqual({ Prospecting: "kill", Brand: "fix" });
    expect(quadrantOf(0, 5, r.split)).toBeNull();
  });

  it("keeps workspaces apart", async () => {
    const mine = await performanceReport(db, ws, { ...JUL_SEP, level: "campaign" });
    expect(mine.totals.spendMinor).toBe(15_000);
    const theirs = await performanceReport(db, other, { ...JUL_SEP, level: "campaign" });
    expect(theirs.totals).toMatchObject({ count: 1, spendMinor: 900_000, revenueMinor: 500_000 });
    // Peeking at another workspace's campaign (or a bogus id) returns nothing at all.
    expect(await performancePeek(db, ws, { ...JUL_SEP, level: "campaign", id: otherIds.meta.campaignId })).toBeNull();
    expect(await performancePeek(db, ws, { ...JUL_SEP, level: "campaign", id: "not-a-uuid" })).toBeNull();
    // An ad set id isn't a campaign.
    expect(await performancePeek(db, ws, { ...JUL_SEP, level: "campaign", id: ids.meta.adGroupId })).toBeNull();
  });
});

describe("performance peek", () => {
  it("returns the trend, child rows and the contacts a campaign brought", async () => {
    const peek = (await performancePeek(db, ws, { ...JUL_SEP, level: "campaign", id: ids.meta.campaignId }))!;
    expect(peek.row).toMatchObject({ name: "Prospecting", platform: "meta", spendMinor: 10_000, revenueMinor: 12_000, roas: 1.2, delta: null });
    expect(peek.trend).toHaveLength(92);
    expect(peek.trend[0]).toEqual({ date: "2026-07-01", spendMinor: 10_000, revenueMinor: 0 });
    expect(peek.trend.find((d) => d.date === "2026-07-05")!.revenueMinor).toBe(9_000);
    expect(peek.childLevel).toBe("ad_group");
    expect(peek.children.map((c) => [c.name, c.spendMinor])).toEqual([["Prospecting group", 10_000]]);
    expect(peek.childCount).toBe(1);
    expect(peek.contactCount).toBe(2);
    expect(peek.contacts.map((c) => [c.label, c.revenueMinor])).toEqual([
      ["Alice", 12_000],
      ["Bob", 0],
    ]);
    // Contact labels never carry a raw email.
    expect(JSON.stringify(peek)).not.toContain("@example.com");
  });

  it("has no children at the ad level", async () => {
    const peek = (await performancePeek(db, ws, { ...JUL_SEP, level: "ad", id: ids.google.adId }))!;
    expect(peek.row).toMatchObject({ name: "Brand ad", parentName: "Brand group" });
    expect(peek.childLevel).toBeNull();
    expect(peek.children).toEqual([]);
    expect(peek.contacts.map((c) => c.label)).toEqual(["Cara"]);
  });

  it("compares the peeked entity with the previous period and shows zeros when it was idle", async () => {
    const aug = { start: "2026-08-01", end: "2026-08-31", model: "last_touch" as const };
    const comparison = comparisonRange(aug.start, aug.end, "prev");
    const peek = (await performancePeek(db, ws, { ...aug, level: "campaign", id: ids.meta.campaignId, comparison }))!;
    expect(peek.row).toMatchObject({ spendMinor: 0, revenueMinor: 3_000, roas: null });
    expect(peek.row.delta!.revenueMinor).toBeCloseTo(-2 / 3, 6);
    const idle = (await performancePeek(db, ws, { start: "2026-01-01", end: "2026-01-31", model: "last_touch", level: "campaign", id: ids.google.campaignId }))!;
    expect(idle.row).toMatchObject({ name: "Brand", spendMinor: 0, revenueMinor: 0, roas: null, platformGap: null });
    expect(idle.contacts).toEqual([]);
    expect(idle.contactCount).toBe(0);
  });
});

describe("platform gap in mock mode", () => {
  it("puts what Meta reports next to what AdLedger verified", async () => {
    const [w] = await db
      .insert(schema.workspaces)
      .values({ organizationId: ws.organizationId, name: "Mock Meta", slug: `mock-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" })
      .returning();
    const mock = mockMetaInsights({ since: "2026-07-01", until: "2026-07-07" }, "USD");
    await upsertAdRows(db, w.id, mock.flatMap((a) => parseMetaInsights(a.rows, a.account)));
    const campaigns = await performanceReport(db, w as Workspace, { start: "2026-07-01", end: "2026-07-07", model: "last_touch", level: "campaign" });
    const reported = mock.flatMap((a) => a.rows).reduce((s, r) => s + Number(r.actions?.[0]?.value ?? 0), 0);
    expect(campaigns.rows.length).toBeGreaterThan(0);
    expect(campaigns.totals.platformConversions).toBeCloseTo(reported, 1);
    // Nothing verified yet: the gap stays empty rather than claiming an infinite over-count.
    expect(campaigns.totals.platformGap).toBeNull();

    // One verified lead on the biggest campaign: now the gap is platform ÷ verified − 1.
    const top = campaigns.rows[0];
    const [a] = await db.select().from(schema.ads).where(eq(schema.ads.campaignId, top.id)).limit(1);
    const e: Record<string, Ids> = { meta: { campaignId: a.campaignId, adGroupId: a.adGroupId, adId: a.id } };
    await person(w as Workspace, e, "Dana", { at: "2026-07-02T09:00:00Z", key: "meta" }, "2026-07-02T09:30:00Z", []);
    await recomputeAttribution(db, w.id);
    const after = await performanceReport(db, w as Workspace, { start: "2026-07-01", end: "2026-07-07", model: "last_touch", level: "campaign" });
    const row = after.rows.find((r) => r.id === top.id)!;
    expect(row.verifiedConversions).toBe(1);
    expect(row.platformConversions).toBeGreaterThan(1);
    expect(row.platformGap).toBeCloseTo(row.platformConversions! - 1, 6);
  });
});
