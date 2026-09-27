import { beforeAll, describe, expect, it } from "vitest";
import { recomputeAttribution } from "@/lib/attribution";
import { schema, type DB } from "@/lib/db";
import type { Channel, Platform } from "@/lib/db/schema";
import {
  attributionPaths,
  cohortRetention,
  conversionsHeatmap,
  funnel,
  modelDisagreement,
  paybackByChannel,
  paybackDay,
  recommendWindow,
  timeToConvert,
} from "@/lib/reports-analysis";
import type { Workspace } from "@/lib/settings";
import { upsertAdRows } from "@/lib/sync";
import { setupWorkspace } from "./helpers";

// A hand-checkable ledger (USD, UTC, 30-day window). Every expectation below is worked out
// from this table by hand.
//
//   Meta "Prospecting" spend $100 on Jul 1        Google "Brand" spend $50 on Jul 1
//
//   Alice  phone:  Meta touch Jul 1 10:00         laptop: Google touch Jul 3 10:00
//          lead Jul 2 10:00; pays $90 Jul 5 12:00, $30 Aug 5 12:00, refund −$10 Sep 10 12:00
//   Bob    Google touch Jul 10 10:00; lead Jul 10 12:00; pays $60 Jul 12 12:00, $60 Sep 12 12:00
//   Carol  no touches, no lead; pays $40 Aug 20 12:00 (unattributed)
//   Dan    Meta touches Jul 20 10:00 and Jul 21 10:00; lead Jul 21 11:00; never pays
//   + one anonymous visitor with a page view on Jul 15 (never identified)

let db: DB;
let ws: Workspace;
const campaignId: Record<string, string> = {};
const Q3 = { start: "2026-07-01", end: "2026-09-30", model: "first_touch" as const };

const ad = (platform: Platform, key: string, name: string, spendMinor: number) => ({
  platform,
  account: { externalId: `acc-${key}`, name: `${name} account`, currency: "USD", timezone: null },
  campaign: { externalId: `c-${key}`, name, status: "active", objective: null },
  adGroup: { externalId: `g-${key}`, name: `${name} group`, status: null },
  ad: { externalId: `a-${key}`, name: `${name} ad`, status: null },
  date: "2026-07-01",
  spendMinor,
  impressions: 1000,
  clicks: 10,
  conversions: "0",
});

type Touch = { at: string; key: "meta" | "google"; device?: string };

async function person(
  w: Workspace,
  name: string,
  opts: { touches?: Touch[]; leads?: string[]; payments?: { id: string; at: string; amount: number; refundOf?: string }[] },
  campaigns: Record<string, string> = campaignId,
) {
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: w.id, email: `${name.toLowerCase()}@example.com`, name, firstSeenAt: new Date("2026-07-01T00:00:00Z") })
    .returning();
  const visitors = new Map<string, string>();
  for (const t of opts.touches ?? []) {
    const device = t.device ?? "main";
    let vid = visitors.get(device);
    if (!vid) {
      const [v] = await db
        .insert(schema.visitors)
        .values({ workspaceId: w.id, anonymousId: `vid-${w.id.slice(0, 4)}-${name}-${device}`, firstSeenAt: new Date(t.at), lastSeenAt: new Date(t.at), contactId: c.id })
        .returning();
      vid = v.id;
      visitors.set(device, vid);
    }
    const channel: Channel = t.key === "meta" ? "paid_social" : "paid_search";
    await db.insert(schema.touchpoints).values({ workspaceId: w.id, visitorId: vid, occurredAt: new Date(t.at), channel, platform: t.key, campaignId: campaigns[t.key] });
    await db.insert(schema.events).values({ workspaceId: w.id, visitorId: vid, type: "page_view", occurredAt: new Date(t.at), url: "https://shop.test/" });
  }
  for (const at of opts.leads ?? []) {
    await db.insert(schema.leads).values({ workspaceId: w.id, contactId: c.id, source: "api", occurredAt: new Date(at) });
  }
  for (const p of opts.payments ?? []) {
    await db.insert(schema.revenueEvents).values({
      workspaceId: w.id,
      contactId: c.id,
      source: "api",
      externalId: p.id,
      relatedExternalId: p.refundOf ?? null,
      type: p.refundOf ? "refund" : "payment",
      amountMinor: p.amount,
      currency: "USD",
      occurredAt: new Date(p.at),
    });
  }
  return c;
}

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await upsertAdRows(db, ws.id, [ad("meta", "meta", "Prospecting", 10_000), ad("google", "google", "Brand", 5_000)]);
  for (const c of await db.select().from(schema.campaigns)) campaignId[c.platform] = c.id;

  await person(ws, "Alice", {
    touches: [
      { at: "2026-07-01T10:00:00Z", key: "meta", device: "phone" },
      { at: "2026-07-03T10:00:00Z", key: "google", device: "laptop" },
    ],
    leads: ["2026-07-02T10:00:00Z"],
    payments: [
      { id: "a1", at: "2026-07-05T12:00:00Z", amount: 9_000 },
      { id: "a2", at: "2026-08-05T12:00:00Z", amount: 3_000 },
      { id: "a3", at: "2026-09-10T12:00:00Z", amount: -1_000, refundOf: "a2" },
    ],
  });
  await person(ws, "Bob", {
    touches: [{ at: "2026-07-10T10:00:00Z", key: "google" }],
    leads: ["2026-07-10T12:00:00Z"],
    payments: [
      { id: "b1", at: "2026-07-12T12:00:00Z", amount: 6_000 },
      { id: "b2", at: "2026-09-12T12:00:00Z", amount: 6_000 },
    ],
  });
  await person(ws, "Carol", { payments: [{ id: "c1", at: "2026-08-20T12:00:00Z", amount: 4_000 }] });
  await person(ws, "Dan", {
    touches: [
      { at: "2026-07-20T10:00:00Z", key: "meta" },
      { at: "2026-07-21T10:00:00Z", key: "meta" },
    ],
    leads: ["2026-07-21T11:00:00Z"],
  });
  const [anon] = await db
    .insert(schema.visitors)
    .values({ workspaceId: ws.id, anonymousId: "vid-anon", firstSeenAt: new Date("2026-07-15T09:00:00Z"), lastSeenAt: new Date("2026-07-15T09:00:00Z") })
    .returning();
  await db.insert(schema.events).values({ workspaceId: ws.id, visitorId: anon.id, type: "page_view", occurredAt: new Date("2026-07-15T09:00:00Z") });
  await recomputeAttribution(db, ws.id);
});

describe("attribution paths", () => {
  it("lists customer journeys with counts, revenue to date, median days and touches", async () => {
    const r = await attributionPaths(db, ws, Q3);
    expect(r).toMatchObject({ conversion: "customer", converters: 3, revenueMinor: 27_000, distinctPaths: 2, windowDays: 30 });
    expect(r.rows).toEqual([
      // Bob: one Google touch, paid 2d 2h later; $60 + $60
      { key: "google", steps: ["google"], converters: 1, share: 1 / 3, revenueMinor: 12_000, medianDays: 2.1, avgTouches: 1 },
      // Alice: Meta then Google, paid 4d 2h after the first; $90 + $30 − $10
      { key: "meta>google", steps: ["meta", "google"], converters: 1, share: 1 / 3, revenueMinor: 11_000, medianDays: 4.1, avgTouches: 2 },
      // Carol: nothing tracked
      { key: "", steps: [], converters: 1, share: 1 / 3, revenueMinor: 4_000, medianDays: null, avgTouches: 0 },
    ]);
    expect(r.singleTouchShare).toBe(0.5);
    expect(r.untrackedShare).toBeCloseTo(1 / 3);
    expect(r.avgTouches).toBe(1.5);
    expect(r.other).toEqual({ paths: 0, converters: 0, revenueMinor: 0 });
  });

  it("collapses repeated steps and supports lead journeys", async () => {
    const r = await attributionPaths(db, ws, Q3, { conversion: "lead" });
    expect(r.converters).toBe(3);
    // Alice (1 Meta touch, 1.0 d) and Dan (Meta, Meta → one step, 1.04 d) share a path.
    expect(r.rows[0]).toEqual({ key: "meta", steps: ["meta"], converters: 2, share: 2 / 3, revenueMinor: 11_000, medianDays: 1, avgTouches: 1.5 });
    expect(r.rows[1]).toMatchObject({ key: "google", converters: 1, medianDays: 0.1 });
  });

  it("filters to journeys that include a platform, and folds the tail into other", async () => {
    const meta = await attributionPaths(db, ws, { ...Q3, platform: "meta" });
    expect(meta.rows.map((x) => x.key)).toEqual(["meta>google"]);
    expect(meta.converters).toBe(1);
    const top1 = await attributionPaths(db, ws, Q3, { limit: 1 });
    expect(top1.rows).toHaveLength(1);
    expect(top1.other).toEqual({ paths: 2, converters: 2, revenueMinor: 15_000 });
  });

  it("returns an empty report for a period without conversions", async () => {
    const r = await attributionPaths(db, ws, { ...Q3, start: "2025-01-01", end: "2025-01-31" });
    expect(r).toMatchObject({ converters: 0, rows: [], singleTouchShare: null, untrackedShare: null, avgTouches: null });
  });
});

describe("time to convert", () => {
  it("measures stage lags with median, p80 and buckets", async () => {
    const r = await timeToConvert(db, ws, Q3);
    // Alice 1.0 d, Bob 0.08 d, Dan 1.04 d
    expect(r.touchToLead).toMatchObject({ conversions: 3, medianDays: 1, buckets: [1, 2, 0, 0, 0], withinWindowShare: 1 });
    // Alice 3.08 d, Bob 2.0 d
    expect(r.leadToPayment).toMatchObject({ conversions: 2, medianDays: 2.5, buckets: [0, 2, 0, 0, 0] });
    // Alice 4.08 d, Bob 2.08 d → p80 = 2.08 + 0.8 × 2 = 3.68
    expect(r.touchToPayment).toMatchObject({ conversions: 2, medianDays: 3.1, p80Days: 3.7, buckets: [0, 2, 0, 0, 0] });
    expect(r.touches).toEqual({ customers: 3, tracked: 2, buckets: [1, 1, 0, 0, 0], avg: 1.5 });
    expect(r.crossDeviceShare).toBe(0.5); // Alice used two browsers
    expect(r.recommendedWindowDays).toBeNull(); // too few conversions to recommend
  });

  it("gives each campaign its own lag from its first touch in the window", async () => {
    const r = await timeToConvert(db, ws, Q3);
    expect(r.campaigns).toEqual([
      // Alice: Jul 3 10:00 → Jul 5 12:00; Bob: Jul 10 10:00 → Jul 12 12:00. Lead: Bob only (Alice's lead predates the touch).
      { id: campaignId.google, name: "Brand", platform: "google", customers: 2, medianDays: 2.1, p80Days: 2.1, leads: 1, leadMedianDays: 0.1, leadP80Days: 0.1 },
      // Alice paid 4.08 d after Meta; leads: Alice 1.0 d, Dan 1.04 d (first Meta touch in the window)
      { id: campaignId.meta, name: "Prospecting", platform: "meta", customers: 1, medianDays: 4.1, p80Days: 4.1, leads: 2, leadMedianDays: 1, leadP80Days: 1 },
    ]);
    const onlyMeta = await timeToConvert(db, ws, { ...Q3, platform: "meta" });
    expect(onlyMeta.campaigns.map((c) => c.name)).toEqual(["Prospecting"]);
  });

  it("recommends a round window covering 90% of journeys", () => {
    expect(recommendWindow(19.2, 50)).toBe(21);
    expect(recommendWindow(3, 50)).toBe(7);
    expect(recommendWindow(30, 50)).toBe(30);
    expect(recommendWindow(400, 50)).toBe(365);
    expect(recommendWindow(10, 5)).toBeNull();
    expect(recommendWindow(null, 500)).toBeNull();
  });
});

describe("model disagreement", () => {
  it("builds dumbbell rows sorted by how much the model changes a campaign", async () => {
    const r = await modelDisagreement(db, ws, Q3);
    expect(r.rows).toEqual([
      { id: campaignId.google, name: "Brand", platform: "google", spendMinor: 5_000, firstMinor: 12_000, lastMinor: 23_000, linearMinor: 17_500, minMinor: 12_000, maxMinor: 23_000, spreadMinor: 11_000, role: "closer" },
      { id: campaignId.meta, name: "Prospecting", platform: "meta", spendMinor: 10_000, firstMinor: 11_000, lastMinor: 0, linearMinor: 5_500, minMinor: 0, maxMinor: 11_000, spreadMinor: 11_000, role: "starter" },
    ]);
    expect(r.movableMinor).toBe(22_000);
    expect(r.movableShare).toBeCloseTo(22_000 / 34_000);
    expect(r).toMatchObject({ starters: 1, closers: 1, avgTouches: 1.5, multiTouchShare: 0.5 });
  });
});

describe("cohort retention", () => {
  it("shows the share of each monthly cohort paying again, with CAC payback", async () => {
    const r = await cohortRetention(db, ws, Q3);
    expect(r.cohorts).toEqual([
      // Alice + Bob: month 1 Alice pays, month 2 Bob pays (Alice's refund is not a payment)
      {
        cohort: "2026-07",
        customers: 2,
        spendMinor: 15_000,
        cacMinor: 7_500,
        retention: [1, 0.5, 0.5],
        payers: [2, 1, 1],
        revenueMinor: [15_000, 3_000, 5_000],
        cumulativeLtvMinor: [7_500, 9_000, 11_500],
        paybackMonth: 0,
      },
      // Carol: no repeat; no ad spend in August → no CAC
      { cohort: "2026-08", customers: 1, spendMinor: 0, cacMinor: null, retention: [1, 0], payers: [1, 0], revenueMinor: [4_000, 0], cumulativeLtvMinor: [4_000, 4_000], paybackMonth: null },
      // September: nobody new, but the row stays
      { cohort: "2026-09", customers: 0, spendMinor: 0, cacMinor: null, retention: [], payers: [], revenueMinor: [], cumulativeLtvMinor: [], paybackMonth: null },
    ]);
    expect(r).toMatchObject({ months: 3, customers: 3, ltvMinor: 9_000 });
    expect(r.repeatRate).toBeCloseTo(2 / 3);
    expect(r.month1Retention).toBeCloseTo(1 / 3);
  });

  it("marks months that have not happened as unknown", async () => {
    const r = await cohortRetention(db, ws, { start: "2026-07-01", end: "2026-07-31" });
    expect(r.cohorts).toHaveLength(1);
    expect(r.cohorts[0].retention).toEqual([1]);
  });
});

describe("payback and LTV by channel", () => {
  // End Sep 15 so the maturity cut-off is fixed: Alice is 72.5 days old, Bob 65.5, Carol 26.5.
  const P = { start: "2026-07-01", end: "2026-09-15", model: "first_touch" as const };

  it("computes CAC, day-mark LTV over matured customers and interpolated payback", async () => {
    const r = await paybackByChannel(db, ws, P);
    expect(r.rows.map((x) => x.key)).toEqual(["meta", "google", "unattributed"]);
    const [meta, google, none] = r.rows;
    // Alice: $90 on day 0, $30 on day 31, −$10 on day 67. CAC $100 is crossed between day 30 ($90) and 45 ($120).
    expect(meta).toMatchObject({
      platform: "meta",
      channel: "paid_social",
      customers: 1,
      spendMinor: 10_000,
      cacMinor: 10_000,
      revenueMinor: 11_000,
      ltvToDateMinor: 11_000,
      ltvAt: { 30: 9_000, 60: 12_000, 90: null, 180: null },
      paybackDays: 35,
      status: "paid_back",
      repeatRate: 1,
    });
    expect(meta.refundRate).toBeCloseTo(1_000 / 12_000);
    expect(meta.curve.slice(0, 7).map((c) => c.ltvMinor)).toEqual([9_000, 9_000, 9_000, 9_000, 12_000, 12_000, null]);
    // Bob's first $60 already covers the $50 CAC.
    expect(google).toMatchObject({ cacMinor: 5_000, paybackDays: 0, status: "paid_back", ltvAt: { 30: 6_000, 60: 6_000, 90: null, 180: null } });
    // Carol: organic/unattributed, no CAC; only 26.5 days old, so no day-30 value yet.
    expect(none).toMatchObject({ channel: "unattributed", platform: null, cacMinor: null, status: "no_spend", ltvAt: { 30: null, 60: null, 90: null, 180: null } });
    expect(r.paid).toMatchObject({ customers: 2, spendMinor: 15_000, cacMinor: 7_500, paybackDays: 0, ltvAt: { 30: 7_500, 60: 9_000, 90: null, 180: null } });
  });

  it("keeps platforms that spent but acquired nobody, and filters by platform", async () => {
    const r = await paybackByChannel(db, ws, { ...P, model: "last_touch" });
    const meta = r.rows.find((x) => x.key === "meta")!;
    expect(meta).toMatchObject({ customers: 0, spendMinor: 10_000, cacMinor: null, status: "no_customers" });
    const google = r.rows.find((x) => x.key === "google")!;
    expect(google).toMatchObject({ customers: 2, cacMinor: 2_500, paybackDays: 0 });
    const only = await paybackByChannel(db, ws, { ...P, platform: "google" });
    expect(only.rows.map((x) => x.key)).toEqual(["google"]);
    expect(only.paid.spendMinor).toBe(5_000);
  });

  it("interpolates payback between curve marks", () => {
    const curve = [
      { day: 0, ltvMinor: 100, customers: 1 },
      { day: 30, ltvMinor: 400, customers: 1 },
      { day: 60, ltvMinor: null, customers: 0 },
    ];
    expect(paybackDay(curve, 100)).toBe(0);
    expect(paybackDay(curve, 250)).toBe(15);
    expect(paybackDay(curve, 500)).toBeNull();
  });
});

describe("funnel", () => {
  it("counts visitors, leads, customers and new-customer revenue with step rates", async () => {
    const r = await funnel(db, ws, Q3);
    // Visitors: Alice ×2 browsers, Bob, Dan, anonymous
    expect(r).toMatchObject({ visitors: 5, leads: 3, customers: 3, revenueMinor: 27_000, leadRate: 0.6, closeRate: 1, visitorRate: 0.6, revenuePerVisitorMinor: 5_400 });
    expect(r.previous).toMatchObject({ start: "2026-03-31", end: "2026-06-30", visitors: 0, leads: 0, customers: 0, leadRate: null });
  });

  it("credits leads and customers to a platform with the selected model", async () => {
    const r = await funnel(db, ws, { ...Q3, platform: "meta" }, { compare: false });
    // Meta touched Alice's phone and Dan; first touch credits Alice's and Dan's leads and Alice's purchase.
    expect(r).toMatchObject({ visitors: 2, leads: 2, customers: 1, revenueMinor: 11_000, previous: null });
    const linear = await funnel(db, ws, { ...Q3, model: "linear", platform: "meta" }, { compare: false });
    expect(linear).toMatchObject({ leads: 2, customers: 0.5, revenueMinor: 5_500 });
  });
});

describe("conversions heatmap", () => {
  it("buckets leads and payments by weekday and hour", async () => {
    const r = await conversionsHeatmap(db, ws, Q3);
    expect(r.cells).toHaveLength(168);
    expect(r.totals).toEqual({ leads: 3, payments: 5 });
    const at = (dow: number, hour: number) => r.cells[dow * 24 + hour];
    // Thu Jul 2 10:00 (Alice's lead), Fri Jul 10 12:00 (Bob's lead), Tue Jul 21 11:00 (Dan's lead)
    expect(at(3, 10).leads).toBe(1);
    expect(at(4, 12).leads).toBe(1);
    expect(at(1, 11).leads).toBe(1);
    // Payments at 12:00 on Sun Jul 5, Sun Jul 12, Wed Aug 5, Thu Aug 20, Sat Sep 12 (the refund is not a payment)
    expect(at(6, 12).payments).toBe(2);
    expect(at(2, 12).payments).toBe(1);
    expect(at(3, 12).payments).toBe(1);
    expect(at(5, 12).payments).toBe(1);
    expect(at(3, 11).payments + at(3, 13).payments).toBe(0);
    expect(r.max).toEqual({ leads: 1, payments: 2 });
  });
});

// Asia/Kolkata is UTC+5:30: a separate workspace proves timezone handling and isolation.
describe("second workspace: timezone and isolation", () => {
  let wsB: Workspace;

  beforeAll(async () => {
    ({ ws: wsB } = await setupWorkspace({ timezone: "Asia/Kolkata" }));
    await person(wsB, "Esha", {
      leads: [
        "2026-07-05T18:00:00Z", // Sun Jul 5 23:30 local: before the period
        "2026-07-06T20:00:00Z", // Tue Jul 7 01:30 local
        "2026-07-07T18:40:00Z", // Wed Jul 8 00:10 local: after the period
      ],
      payments: [{ id: "e1", at: "2026-07-05T19:00:00Z", amount: 2_500 }], // Mon Jul 6 00:30 local (Sun 19:00 in UTC)
    });
    await recomputeAttribution(db, wsB.id);
  });

  it("uses the workspace timezone for heatmap cells and period bounds", async () => {
    const r = await conversionsHeatmap(db, wsB, { start: "2026-07-06", end: "2026-07-07" });
    expect(r.timezone).toBe("Asia/Kolkata");
    expect(r.totals).toEqual({ leads: 1, payments: 1 });
    expect(r.cells[1 * 24 + 1].leads).toBe(1); // Tuesday 01:00
    expect(r.cells[0 * 24 + 0].payments).toBe(1); // Monday 00:00

    // The same rows read in UTC land in different cells (and the period shifts).
    const utc = await conversionsHeatmap(db, { ...wsB, timezone: "UTC" }, { start: "2026-07-05", end: "2026-07-07" });
    expect(utc.totals).toEqual({ leads: 3, payments: 1 });
    expect(utc.cells[6 * 24 + 19].payments).toBe(1); // Sunday 19:00
    expect(utc.cells[6 * 24 + 18].leads).toBe(1); // Sunday 18:00
  });

  it("never mixes workspaces", async () => {
    const funnelB = await funnel(db, wsB, Q3, { compare: false });
    expect(funnelB).toMatchObject({ visitors: 0, leads: 1, customers: 1, revenueMinor: 2_500 });
    const pathsB = await attributionPaths(db, wsB, Q3);
    expect(pathsB.rows).toEqual([expect.objectContaining({ key: "", converters: 1 })]);
    const cohortsB = await cohortRetention(db, wsB, Q3);
    expect(cohortsB.customers).toBe(1);
    const mdB = await modelDisagreement(db, wsB, Q3);
    expect(mdB.rows).toEqual([]);
    const paybackB = await paybackByChannel(db, wsB, Q3);
    expect(paybackB.rows.map((x) => x.key)).toEqual(["unattributed"]);
    // …and workspace A is unchanged by B's rows.
    const heatA = await conversionsHeatmap(db, ws, Q3);
    expect(heatA.totals).toEqual({ leads: 3, payments: 5 });
  });
});
