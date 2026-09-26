import { performance as perf } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { rows, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { channels, journey, overview, performance, timeseries, type ReportParams } from "@/lib/reports";
import { ltv, modelComparison } from "@/lib/reports-advanced";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// Report latency budget on the demo dataset (~17k visitors, 90 days, 11 campaigns).
// Each query is warmed up once, then the best of three runs must stay under 500 ms.

const BUDGET_MS = Number(process.env.REPORT_BUDGET_MS ?? 500);

let db: DB;
let ws: Workspace;
let contactId: string;
const p: ReportParams = { start: "2026-06-04", end: "2026-09-01", model: "linear" };

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await seedDemo(db, ws.id, { anchor: "2026-09-01" });
  // The busiest journey: the customer with the most touchpoints.
  [{ id: contactId }] = rows<{ id: string }>(
    await db.execute(sql`select v.contact_id id from touchpoints t join visitors v on v.id = t.visitor_id
      join revenue_events r on r.contact_id = v.contact_id
      where v.contact_id is not null group by 1 order by count(*) desc limit 1`),
  );
  // Seeding ~17k visitors can take a while on a busy machine.
}, 300_000);

async function best(fn: () => Promise<unknown>) {
  await fn();
  let min = Infinity;
  for (let i = 0; i < 3; i++) {
    const t = perf.now();
    await fn();
    min = Math.min(min, perf.now() - t);
  }
  return min;
}

describe("report latency on the demo dataset", () => {
  const cases: [string, () => Promise<unknown>][] = [
    ["overview", () => overview(db, ws, p)],
    ["performance (campaign)", () => performance(db, ws, { ...p, level: "campaign" })],
    ["performance (ad)", () => performance(db, ws, { ...p, level: "ad" })],
    ["timeseries", () => timeseries(db, ws, p)],
    ["channels", () => channels(db, ws, p)],
    ["journey", () => journey(db, ws, contactId)],
    ["model comparison", () => modelComparison(db, ws, p)],
    ["ltv", () => ltv(db, ws, p)],
  ];
  for (const [name, fn] of cases) {
    it(`${name} < ${BUDGET_MS} ms`, async () => {
      const ms = await best(fn);
      console.info(`[perf] ${name}: ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(BUDGET_MS);
    });
  }

  it("model comparison and LTV agree with the ledger on the demo", async () => {
    const mc = await modelComparison(db, ws, p);
    expect(mc.rows).toHaveLength(11);
    const lt = await performance(db, ws, { ...p, model: "last_touch", level: "campaign" });
    const ltById = new Map(lt.map((r) => [r.id, r.revenueMinor]));
    for (const r of mc.rows) expect(r.lastTouch.revenueMinor).toBe(ltById.get(r.id));
    expect(mc.rows.some((r) => r.role !== "balanced")).toBe(true);

    const l = await ltv(db, ws, p);
    expect(l.customers).toBeGreaterThan(50);
    const byChannel = l.channels.reduce((s, r) => s + r.revenueMinor, 0);
    expect(byChannel).toBe(l.revenueMinor);
    expect(l.channels.reduce((s, r) => s + r.customers, 0)).toBeCloseTo(l.customers, 1);
  });
});
