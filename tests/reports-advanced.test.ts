import { beforeAll, describe, expect, it } from "vitest";
import { GET as reports } from "@/app/api/v1/reports/[report]/route";
import { recomputeAttribution } from "@/lib/attribution";
import { createApiKey } from "@/lib/auth";
import { schema, type DB } from "@/lib/db";
import type { Channel, Platform } from "@/lib/db/schema";
import { journeyRole, ltv, modelComparison, monthsBetween } from "@/lib/reports-advanced";
import type { Workspace } from "@/lib/settings";
import { upsertAdRows } from "@/lib/sync";
import { setupWorkspace } from "./helpers";

// A tiny hand-checkable ledger (USD, UTC, 30-day window):
//
//   Meta "Prospecting"  spend $100 on Jul 1   Google "Brand"  spend $50 on Jul 1
//
//   Alice  touches: Meta Jul 1, Google Jul 3
//          pays $90 Jul 5, $30 Aug 5, refund −$10 Sep 10 (of the Aug payment)
//   Bob    touches: Google Jul 10
//          pays $60 Jul 12, $60 Sep 12
//   Carol  no touches — pays $40 Aug 20 (unattributed)
//
// Repeat payments and refunds inherit the journey before the first payment, so:
//   first-touch  Meta 110 (Alice), Google 120 (Bob)
//   last-touch   Meta 0,           Google 230 (Alice 110 + Bob 120)
//   linear       Meta 55,          Google 175 (Alice 55 + Bob 120)

let db: DB;
let ws: Workspace;
const campaignId: Record<string, string> = {};

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

async function contact(name: string, touches: { at: string; key: "meta" | "google" }[], payments: { id: string; at: string; amount: number; refundOf?: string }[]) {
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: ws.id, email: `${name.toLowerCase()}@example.com`, name, firstSeenAt: new Date("2026-07-01T00:00:00Z"), lifecycle: "customer" })
    .returning();
  if (touches.length) {
    const [v] = await db
      .insert(schema.visitors)
      .values({ workspaceId: ws.id, anonymousId: `vid-${name}`, firstSeenAt: new Date(touches[0].at), lastSeenAt: new Date(touches.at(-1)!.at), contactId: c.id })
      .returning();
    for (const t of touches) {
      const channel: Channel = t.key === "meta" ? "paid_social" : "paid_search";
      await db.insert(schema.touchpoints).values({ workspaceId: ws.id, visitorId: v.id, occurredAt: new Date(t.at), channel, platform: t.key, campaignId: campaignId[t.key] });
    }
  }
  for (const p of payments) {
    await db.insert(schema.revenueEvents).values({
      workspaceId: ws.id,
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
}

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await upsertAdRows(db, ws.id, [ad("meta", "meta", "Prospecting", 10_000), ad("google", "google", "Brand", 5_000)]);
  for (const c of await db.select().from(schema.campaigns)) campaignId[c.platform] = c.id;

  await contact(
    "Alice",
    [
      { at: "2026-07-01T10:00:00Z", key: "meta" },
      { at: "2026-07-03T10:00:00Z", key: "google" },
    ],
    [
      { id: "a1", at: "2026-07-05T12:00:00Z", amount: 9_000 },
      { id: "a2", at: "2026-08-05T12:00:00Z", amount: 3_000 },
      { id: "a3", at: "2026-09-10T12:00:00Z", amount: -1_000, refundOf: "a2" },
    ],
  );
  await contact("Bob", [{ at: "2026-07-10T10:00:00Z", key: "google" }], [
    { id: "b1", at: "2026-07-12T12:00:00Z", amount: 6_000 },
    { id: "b2", at: "2026-09-12T12:00:00Z", amount: 6_000 },
  ]);
  await contact("Carol", [], [{ id: "c1", at: "2026-08-20T12:00:00Z", amount: 4_000 }]);
  await recomputeAttribution(db, ws.id);
});

const Q3 = { start: "2026-07-01", end: "2026-09-30" };

describe("model comparison", () => {
  it("classifies journey roles from the first/last-touch delta", () => {
    expect(journeyRole(11_000, 0)).toEqual({ deltaMinor: 11_000, deltaShare: 1, role: "starter" });
    expect(journeyRole(12_000, 23_000).role).toBe("closer");
    expect(journeyRole(100, 90).role).toBe("balanced");
    expect(journeyRole(0, 0)).toEqual({ deltaMinor: 0, deltaShare: null, role: "balanced" });
  });

  it("puts first-touch, last-touch and linear side by side per campaign", async () => {
    const r = await modelComparison(db, ws, Q3);
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(r.rows.map((x) => x.name)).toEqual(["Prospecting", "Brand"]); // by spend

    const meta = by["Prospecting"];
    expect(meta.spendMinor).toBe(10_000);
    expect(meta.firstTouch).toEqual({ revenueMinor: 11_000, customers: 1, roas: 1.1 });
    expect(meta.lastTouch).toEqual({ revenueMinor: 0, customers: 0, roas: 0 });
    expect(meta.linear).toEqual({ revenueMinor: 5_500, customers: 0.5, roas: 0.55 });
    expect(meta.role).toBe("starter");
    expect(meta.deltaMinor).toBe(11_000);

    const google = by["Brand"];
    expect(google.firstTouch).toEqual({ revenueMinor: 12_000, customers: 1, roas: 2.4 });
    expect(google.lastTouch).toEqual({ revenueMinor: 23_000, customers: 2, roas: 4.6 });
    expect(google.linear).toEqual({ revenueMinor: 17_500, customers: 1.5, roas: 3.5 });
    expect(google.role).toBe("closer");
    expect(google.deltaMinor).toBe(-11_000);

    // Campaign revenue is the same total under every model (Carol's $40 is unattributed).
    expect(r.totals.spendMinor).toBe(15_000);
    for (const m of [r.totals.firstTouch, r.totals.lastTouch, r.totals.linear]) expect(m.revenueMinor).toBe(23_000);
  });

  it("filters by platform and period", async () => {
    const onlyGoogle = await modelComparison(db, ws, { ...Q3, platform: "google" });
    expect(onlyGoogle.rows.map((x) => x.name)).toEqual(["Brand"]);
    // July only: Alice $90 + Bob $60.
    const july = await modelComparison(db, ws, { start: "2026-07-01", end: "2026-07-31" });
    expect(july.totals.firstTouch.revenueMinor).toBe(15_000);
    expect(july.rows.find((x) => x.name === "Prospecting")!.firstTouch.revenueMinor).toBe(9_000);
  });
});

describe("ltv", () => {
  it("counts months between YYYY-MM strings", () => {
    expect(monthsBetween("2026-07", "2026-09")).toBe(2);
    expect(monthsBetween("2025-11", "2026-02")).toBe(3);
  });

  it("builds first-payment cohorts with monthly and cumulative revenue", async () => {
    const r = await ltv(db, ws, { ...Q3, model: "first_touch" });
    expect(r.customers).toBe(3);
    expect(r.revenueMinor).toBe(27_000);
    expect(r.ltvMinor).toBe(9_000);
    expect(r.cohorts).toEqual([
      // Alice + Bob: Jul 90+60, Aug 30, Sep −10+60
      { cohort: "2026-07", customers: 2, revenueMinor: [15_000, 3_000, 5_000], cumulativeLtvMinor: [7_500, 9_000, 11_500], totalRevenueMinor: 23_000, ltvMinor: 11_500 },
      // Carol: Aug 40, nothing in Sep
      { cohort: "2026-08", customers: 1, revenueMinor: [4_000, 0], cumulativeLtvMinor: [4_000, 4_000], totalRevenueMinor: 4_000, ltvMinor: 4_000 },
    ]);
  });

  it("stops counting revenue at the report end", async () => {
    const r = await ltv(db, ws, { start: "2026-07-01", end: "2026-08-31", model: "first_touch" });
    expect(r.cohorts[0]).toMatchObject({ cohort: "2026-07", revenueMinor: [15_000, 3_000], ltvMinor: 9_000 });
    expect(r.cohorts[1]).toMatchObject({ cohort: "2026-08", revenueMinor: [4_000] });
  });

  it("computes LTV:CAC per acquiring platform/channel", async () => {
    const r = await ltv(db, ws, { ...Q3, model: "first_touch" });
    expect(r.channels).toEqual([
      { key: "google", channel: "paid_search", platform: "google", customers: 1, revenueMinor: 12_000, spendMinor: 5_000, ltvMinor: 12_000, cacMinor: 5_000, ltvCac: 2.4 },
      { key: "meta", channel: "paid_social", platform: "meta", customers: 1, revenueMinor: 11_000, spendMinor: 10_000, ltvMinor: 11_000, cacMinor: 10_000, ltvCac: 1.1 },
      { key: "unattributed", channel: "unattributed", platform: null, customers: 1, revenueMinor: 4_000, spendMinor: 0, ltvMinor: 4_000, cacMinor: null, ltvCac: null },
    ]);

    const linear = await ltv(db, ws, { ...Q3, model: "linear" });
    const meta = linear.channels.find((c) => c.key === "meta")!;
    expect(meta).toMatchObject({ customers: 0.5, revenueMinor: 5_500, ltvMinor: 11_000, cacMinor: 20_000, ltvCac: 0.55 });
    const google = linear.channels.find((c) => c.key === "google")!;
    expect(google).toMatchObject({ customers: 1.5, revenueMinor: 17_500, cacMinor: 3_333, ltvCac: 3.5 });
  });
});

describe("REST endpoints", () => {
  const params = (report: string) => ({ params: Promise.resolve({ report }) });

  it("serve model-comparison and ltv with an API key", async () => {
    const qs = "start=2026-07-01&end=2026-09-30&model=first_touch";
    const unauth = await reports(new Request(`http://localhost/api/v1/reports/ltv?${qs}`), params("ltv"));
    expect(unauth.status).toBe(401);

    const { key } = await createApiKey(ws.id, "reports-advanced");
    const headers = { authorization: `Bearer ${key}` };
    const mc = await reports(new Request(`http://localhost/api/v1/reports/model-comparison?${qs}`, { headers }), params("model-comparison"));
    expect(mc.status).toBe(200);
    const mcBody = await mc.json();
    expect(mcBody).toMatchObject({ start: "2026-07-01", end: "2026-09-30", currency: "USD" });
    expect(mcBody.data.rows).toHaveLength(2);

    const l = await reports(new Request(`http://localhost/api/v1/reports/ltv?${qs}`, { headers }), params("ltv"));
    expect(l.status).toBe(200);
    const lBody = await l.json();
    expect(lBody.data.cohorts).toHaveLength(2);
    expect(lBody.data.ltvMinor).toBe(9_000);

    const bad = await reports(new Request("http://localhost/api/v1/reports/ltv?start=nope", { headers }), params("ltv"));
    expect(bad.status).toBe(400);
  });
});
