import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { rows, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { modelComparison } from "@/lib/reports-advanced";
import { attributionPaths, cohortRetention, conversionsHeatmap, funnel, modelDisagreement, paybackByChannel, timeToConvert } from "@/lib/reports-analysis";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// The analysis functions on the realistic demo ledger, cross-checked against direct SQL and
// against each other (the same people must add up the same way on every page).

let db: DB;
let ws: Workspace;
const P = { start: "2026-06-04", end: "2026-09-01", model: "linear" as const };
// Workspace timezone is UTC: explicit bounds, independent of the session timezone.
const inPeriod = (col: string) => sql.raw(`${col} >= '${P.start}T00:00:00Z'::timestamptz and ${col} < ('${P.end}T00:00:00Z'::timestamptz + interval '1 day')`);

async function scalar(q: ReturnType<typeof sql>) {
  const [r] = rows<{ v: string | null }>(await db.execute(q));
  return Number(r?.v ?? 0);
}

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await seedDemo(db, ws.id, { anchor: "2026-09-01" });
}, 300_000);

describe("analysis on demo data", () => {
  it("counts the same new customers in paths, funnel, time to convert and cohorts", async () => {
    const firstPayers = await scalar(sql`
      select count(*) v from (
        select contact_id, min(occurred_at) at_ from revenue_events
        where workspace_id = ${ws.id} and type = 'payment' and contact_id is not null group by 1
      ) f where ${inPeriod("f.at_")}`);
    expect(firstPayers).toBeGreaterThan(20);

    const [paths, f, ttc, cohorts] = await Promise.all([attributionPaths(db, ws, P, { limit: 5 }), funnel(db, ws, P), timeToConvert(db, ws, P), cohortRetention(db, ws, P)]);
    expect(paths.converters).toBe(firstPayers);
    expect(paths.rows.reduce((a, r) => a + r.converters, 0) + paths.other.converters).toBe(firstPayers);
    expect(paths.rows.reduce((a, r) => a + r.revenueMinor, 0) + paths.other.revenueMinor).toBe(paths.revenueMinor);
    expect(f.customers).toBe(firstPayers);
    expect(ttc.touches.customers).toBe(firstPayers);
    expect(ttc.touches.buckets.reduce((a, b) => a + b, 0)).toBe(ttc.touches.tracked);
    expect(ttc.touchToPayment.conversions).toBeLessThanOrEqual(firstPayers);
    expect(ttc.touchToPayment.buckets.reduce((a, b) => a + b, 0)).toBe(ttc.touchToPayment.conversions);
    expect(cohorts.customers).toBe(firstPayers);
    expect(cohorts.cohorts.reduce((a, c) => a + (c.payers[0] ?? 0), 0)).toBe(firstPayers);
  });

  it("counts new leads the same way in paths and the funnel", async () => {
    const firstLeads = await scalar(sql`
      select count(*) v from (select contact_id, min(occurred_at) at_ from leads where workspace_id = ${ws.id} group by 1) f where ${inPeriod("f.at_")}`);
    const [paths, f] = await Promise.all([attributionPaths(db, ws, P, { conversion: "lead" }), funnel(db, ws, P, { compare: false })]);
    expect(paths.converters).toBe(firstLeads);
    expect(f.leads).toBe(firstLeads);
  });

  it("puts every lead and payment of the period in exactly one heatmap cell", async () => {
    const leads = await scalar(sql`select count(*) v from leads where workspace_id = ${ws.id} and ${inPeriod("occurred_at")}`);
    const payments = await scalar(sql`select count(*) v from revenue_events where workspace_id = ${ws.id} and type = 'payment' and ${inPeriod("occurred_at")}`);
    const h = await conversionsHeatmap(db, ws, P);
    expect(h.totals).toEqual({ leads, payments });
    expect(h.cells.reduce((a, c) => a + c.leads + c.payments, 0)).toBe(leads + payments);
  });

  it("keeps each campaign's dumbbell between its models and matches the model comparison", async () => {
    const [md, mc] = await Promise.all([modelDisagreement(db, ws, P), modelComparison(db, ws, P)]);
    expect(md.rows).toHaveLength(mc.rows.length);
    for (const r of md.rows) {
      for (const v of [r.firstMinor, r.lastMinor, r.linearMinor]) {
        expect(v).toBeGreaterThanOrEqual(r.minMinor);
        expect(v).toBeLessThanOrEqual(r.maxMinor);
      }
    }
    expect(md.rows.reduce((a, r) => a + r.linearMinor, 0)).toBe(mc.totals.linear.revenueMinor);
  });

  it("splits credited customers and spend across payback rows without losing any", async () => {
    const credited = await scalar(sql`
      select coalesce(sum(credit), 0) v from attribution_credits
      where workspace_id = ${ws.id} and model = 'linear' and conversion_type = 'customer' and ${inPeriod("conversion_at")}`);
    const spend = await scalar(sql`select coalesce(sum(spend_minor), 0) v from ad_insights_daily where workspace_id = ${ws.id} and date between ${P.start}::date and ${P.end}::date`);
    const r = await paybackByChannel(db, ws, P);
    expect(r.rows.reduce((a, x) => a + x.customers, 0)).toBeCloseTo(credited, 0);
    expect(r.rows.reduce((a, x) => a + x.spendMinor, 0)).toBe(spend);
    expect(r.paid.spendMinor).toBe(spend);
    for (const x of r.rows) {
      // Day-mark LTV only ever counts matured customers, and the curve never has a value after a gap.
      const firstGap = x.curve.findIndex((pt) => pt.ltvMinor === null);
      if (firstGap >= 0) expect(x.curve.slice(firstGap).every((pt) => pt.ltvMinor === null)).toBe(true);
    }
  });
});
