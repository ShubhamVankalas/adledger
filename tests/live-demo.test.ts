import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { hashEmail } from "@/lib/crypto";
import { rows, schema, type DB } from "@/lib/db";
import { simulateDemoActivity, stopDemoActivity } from "@/lib/live-demo";
import { liveFeed, liveSnapshot } from "@/lib/reports-live";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// Sample-data workspaces get simulated live activity; real workspaces never do.

let db: DB;
let demo: Workspace;
let real: Workspace;

const count = async (table: string, ws: Workspace) =>
  Number(rows<{ n: string }>(await db.execute(sql`select count(*) as n from ${sql.raw(table)} where workspace_id = ${ws.id}`))[0].n);

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws: demo, org } = await setupWorkspace({ isDemo: true, reportingCurrency: "EUR" }));
  [real] = await db.insert(schema.workspaces).values({ organizationId: org.id, name: "Real", slug: `real-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
  // A little history for the simulator to borrow from: one Meta ad touch and one past payment.
  const [v] = await db.insert(schema.visitors).values({ workspaceId: demo.id, anonymousId: "seed", firstSeenAt: new Date("2026-09-01"), lastSeenAt: new Date("2026-09-01") }).returning();
  await db.insert(schema.events).values({ workspaceId: demo.id, visitorId: v.id, type: "page_view", occurredAt: new Date("2026-09-01"), url: "https://shop.example/pricing" });
  await db.insert(schema.touchpoints).values({ workspaceId: demo.id, visitorId: v.id, occurredAt: new Date("2026-09-01"), channel: "paid_social", platform: "meta", utmCampaign: "autumn", clickIdType: "fbclid", clickId: "x", landingUrl: "https://shop.example/?fbclid=x" });
  const [c] = await db.insert(schema.contacts).values({ workspaceId: demo.id, email: "old@example.com", emailHash: hashEmail("old@example.com"), name: "Old Lead", firstSeenAt: new Date("2026-09-01") }).returning();
  await db.insert(schema.revenueEvents).values({ workspaceId: demo.id, contactId: c.id, source: "stripe", externalId: "pi_seed", type: "payment", amountMinor: 4_900, currency: "EUR", occurredAt: new Date("2026-09-01") });
});

describe("simulateDemoActivity", () => {
  it("never writes to a real workspace", async () => {
    for (let i = 0; i < 20; i++) expect(await simulateDemoActivity(db, real, new Date(), { force: true })).toBe(false);
    expect(await count("events", real)).toBe(0);
    expect(await count("revenue_events", real)).toBe(0);
  });

  it("paces itself: one moment, then nothing until the next tick", async () => {
    const before = await count("events", demo);
    await simulateDemoActivity(db, demo);
    expect(await simulateDemoActivity(db, demo)).toBe(false);
    expect(await count("events", demo)).toBeGreaterThanOrEqual(before);
  });

  it("writes realistic rows that the live SQL picks up, with fake identities only", async () => {
    const start = new Date();
    for (let i = 0; i < 120; i++) await simulateDemoActivity(db, demo, new Date(), { force: true });
    const snap = await liveSnapshot(db, demo);
    expect(snap.visitorsNow).toBeGreaterThan(20);
    const { items } = await liveFeed(db, demo, { mode: "since", since: start.toISOString(), limit: 200 });
    const kinds = new Set(items.map((i) => i.kind));
    expect(kinds.has("ad_click")).toBe(true);
    expect(kinds.has("lead")).toBe(true);
    // Ad visits copy the demo's own campaign touch, with a fresh click id.
    const [touch] = rows<{ platform: string; click_id: string }>(
      await db.execute(sql`select platform, click_id from touchpoints where workspace_id = ${demo.id} and created_at >= ${start.toISOString()}::timestamptz limit 1`),
    );
    expect(touch.platform).toBe("meta");
    expect(touch.click_id).toMatch(/^demo\./);
    // Simulated people use example.com addresses; payments use the workspace currency and demo prices.
    const people = await db.select({ email: schema.contacts.email }).from(schema.contacts).where(eq(schema.contacts.workspaceId, demo.id));
    for (const p of people) expect(p.email).toMatch(/@example\.com$/);
    const pays = await db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.workspaceId, demo.id));
    for (const p of pays) expect(p).toMatchObject({ currency: "EUR", amountMinor: 4_900, type: "payment" });
    stopDemoActivity(demo.id);
  });
});
