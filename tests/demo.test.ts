import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { rows } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { buildDemoWorld } from "@/lib/demo/world";
import { overview, performance } from "@/lib/reports";
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
    expect(camps).toHaveLength(8);
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
  });
});
