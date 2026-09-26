import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rows } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { buildDemoWorld } from "@/lib/demo/world";
import { overview, performance } from "@/lib/reports";
import { ltv, modelComparison } from "@/lib/reports-advanced";
import { setupWorkspace } from "./helpers";

describe("demo world", () => {
  it("is deterministic and roughly the documented size", () => {
    const a = buildDemoWorld("2026-09-01", "USD");
    const b = buildDemoWorld("2026-09-01", "USD");
    expect(a.payments.length).toBe(b.payments.length);
    expect(a.contacts[10].email).toBe(b.contacts[10].email);
    expect(a.visitors.length).toBeGreaterThan(15_000);
    expect(a.contacts.length).toBeGreaterThan(800);
    const customers = new Set(a.payments.map((p) => p.email)).size;
    expect(customers).toBeGreaterThan(80);
  });

  it("seeds end to end and tells the winner/waster story", async () => {
    const { db, ws } = await setupWorkspace();
    const summary = await seedDemo(db, ws.id, { anchor: "2026-09-01" });
    expect(summary.payments).toBeGreaterThan(100);

    const p = { start: "2026-06-04", end: "2026-09-01", model: "linear" as const };
    const o = await overview(db, ws, p);
    expect(o.spendMinor).toBeGreaterThan(0);
    expect(o.revenueMinor).toBeGreaterThan(0);
    expect(o.leads).toBeGreaterThan(500);

    const camps = await performance(db, ws, { ...p, level: "campaign" });
    expect(camps).toHaveLength(11);
    const byName = Object.fromEntries(camps.map((c) => [c.name, c]));
    expect(byName["Prospecting – Lookalike 1% Purchasers"].roas!).toBeGreaterThan(1.5);
    expect(byName["Search – Brand"].roas!).toBeGreaterThan(4);
    expect(byName["Broad – Interest Stack"].roas ?? 0).toBeLessThan(0.3);

    // Every revenue event is fully allocated under every model.
    const bad = rows(
      await db.execute(sql`
        select r.id from revenue_events r
        join attribution_credits c on c.conversion_id = r.id and c.conversion_type = 'revenue'
        group by r.id, c.model, r.amount_minor having sum(c.revenue_minor) <> r.amount_minor`),
    );
    expect(bad).toHaveLength(0);

    // Model comparison and LTV agree with the ledger (same seeded workspace, no second seed).
    const mc = await modelComparison(db, ws, p);
    expect(mc.rows).toHaveLength(11);
    const lt = await performance(db, ws, { ...p, model: "last_touch", level: "campaign" });
    const ltById = new Map(lt.map((r) => [r.id, r.revenueMinor]));
    for (const r of mc.rows) expect(r.lastTouch.revenueMinor).toBe(ltById.get(r.id));
    expect(mc.rows.some((r) => r.role !== "balanced")).toBe(true);
    const l = await ltv(db, ws, p);
    expect(l.customers).toBeGreaterThan(50);
    expect(l.channels.reduce((s, r) => s + r.revenueMinor, 0)).toBe(l.revenueMinor);
    expect(l.channels.reduce((s, r) => s + r.customers, 0)).toBeCloseTo(l.customers, 1);
    expect(l.channels.reduce((s, r) => s + r.spendMinor, 0)).toBe(o.spendMinor);
  });
});
