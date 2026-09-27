import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { rows, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { overview, performance, platforms, previousPeriod, timeseries, wastedSpend, type ReportParams } from "@/lib/reports";
import { kpiSeries, medianDaysToConvert, platformScorecard, recentActivity, wastedSpendWithMaturity } from "@/lib/reports-metrics";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// The Overview widgets' SQL on the demo dataset must agree exactly with the existing report
// functions (the tiles, the explorer and the Performance page can never disagree).

let db: DB;
let ws: Workspace;
const p: ReportParams = { start: "2026-08-03", end: "2026-09-01", model: "linear" };

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await seedDemo(db, ws.id, { anchor: "2026-09-01" });
}, 300_000);

describe("kpiSeries on demo data", () => {
  it("matches overview() for every model and a platform filter", async () => {
    for (const params of [p, { ...p, model: "last_touch" as const }, { ...p, model: "first_touch" as const }, { ...p, platform: "meta" as const }, previousPeriod(p)]) {
      const [s, o] = await Promise.all([kpiSeries(db, ws, params), overview(db, ws, params)]);
      expect(s.raw.spendMinor).toBe(o.spendMinor);
      expect(s.raw.revenueMinor).toBe(o.revenueMinor);
      expect(s.raw.attributedRevenueMinor).toBe(o.attributedRevenueMinor);
      expect(s.raw.unattributedRevenueMinor).toBe(o.unattributedRevenueMinor);
      expect(s.raw.leads).toBe(o.leads);
      expect(s.raw.customers).toBe(o.customers);
      expect(s.totals.roas).toBeCloseTo(o.roas!, 10);
      expect(s.totals.mer).toBeCloseTo(o.blendedRoas!, 10);
      expect(s.totals.cpl).toBe(o.cplMinor);
      expect(s.totals.cac).toBe(o.cacMinor);
      expect(s.totals.unattributedShare).toBeCloseTo(o.unattributedShare!, 10);
    }
  });

  it("returns one point per day whose values match timeseries() and add up to the total", async () => {
    const [s, t] = await Promise.all([kpiSeries(db, ws, p), timeseries(db, ws, p)]);
    expect(s.days).toHaveLength(30);
    expect(s.days.map((d) => d.date)).toEqual(t.map((d) => d.date));
    s.days.forEach((d, i) => {
      expect(d.values.spend).toBe(t[i].spendMinor);
      expect(d.values.revenue).toBe(t[i].revenueMinor);
      expect(d.values.attributedRevenue).toBe(t[i].attributedRevenueMinor);
      expect(d.values.leads).toBe(t[i].leads);
    });
    expect(s.days.reduce((a, d) => a + (d.values.spend ?? 0), 0)).toBe(s.raw.spendMinor);
    expect(s.days.reduce((a, d) => a + (d.values.customers ?? 0), 0)).toBe(s.raw.customers);
  });

  it("returns zeros, not errors, for a period with no data", async () => {
    const s = await kpiSeries(db, ws, { ...p, start: "2020-01-01", end: "2020-01-07" });
    expect(s.days).toHaveLength(7);
    expect(s.raw.spendMinor).toBe(0);
    expect(s.totals.roas).toBeNull();
  });
});

describe("widget SQL on demo data", () => {
  it("flags wasted spend exactly like wastedSpend(), with campaign maturity", async () => {
    const camps = await performance(db, ws, { ...p, level: "campaign" });
    const [w, legacy, median] = await Promise.all([wastedSpendWithMaturity(db, ws, p, camps), wastedSpend(db, ws, p), medianDaysToConvert(db, ws)]);
    expect(w.rows.map((r) => r.id)).toEqual(legacy.map((r) => r.id));
    expect(w.rows.length).toBeGreaterThan(0);
    expect(median).toBeGreaterThan(0);
    expect(w.medianDays).toBe(median);
    for (const r of w.rows) {
      expect(r.ageDays).toBeGreaterThan(0);
      expect(r.tooEarly).toBe(r.ageDays! < median!);
    }
    expect(w.totalMinor).toBe(w.rows.filter((r) => !r.tooEarly).reduce((a, r) => a + r.spendMinor, 0));
  });

  it("scores platforms from platforms() with the previous period and spend share", async () => {
    const [card, cur, prev] = await Promise.all([platformScorecard(db, ws, p), platforms(db, ws, p), platforms(db, ws, previousPeriod(p))]);
    expect(card.map((r) => [r.platform, r.spendMinor, r.revenueMinor, r.roas])).toEqual(cur.map((r) => [r.platform, r.spendMinor, r.revenueMinor, r.roas]));
    const prevBy = new Map(prev.map((r) => [r.platform, r.roas]));
    for (const r of card) expect(r.prevRoas).toBe(prevBy.get(r.platform) ?? null);
    expect(card.reduce((a, r) => a + (r.spendShare ?? 0), 0)).toBeCloseTo(1, 6);
  });

  it("lists the newest leads and payments with masked emails only", async () => {
    const recent = await recentActivity(db, ws, p, 6);
    expect(recent).toHaveLength(6);
    const times = recent.map((r) => Date.parse(r.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(Math.max(...times)).toBeLessThan(Date.parse("2026-09-02T00:00:00Z"));
    for (const r of recent) {
      expect(r).not.toHaveProperty("email");
      if (r.maskedEmail) expect(r.maskedEmail).toMatch(/^.•+@/);
      if (r.kind === "payment") expect(r.amountMinor).toBeGreaterThan(0);
    }
    // The newest payment in the list is the newest payment in the ledger.
    const [latest] = rows<{ occurred_at: string }>(
      await db.execute(sql`select occurred_at from revenue_events where workspace_id = ${ws.id} and type = 'payment' and contact_id is not null
        and occurred_at < '2026-09-02T00:00:00Z'::timestamptz order by occurred_at desc limit 1`),
    );
    const firstPayment = recent.find((r) => r.kind === "payment");
    if (firstPayment) expect(Date.parse(firstPayment.at)).toBe(new Date(latest.occurred_at).getTime());
  });
});
