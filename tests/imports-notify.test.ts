import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { ingestRevenue } from "@/lib/connectors/revenue/ingest";
import { schema, type DB } from "@/lib/db";
import { importConversions, importSpend, normalizeDate, parseCsv, SPEND_TEMPLATE } from "@/lib/imports";
import { notify, runScheduledNotifications } from "@/lib/notify";
import { saveConnection, type Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

let db: DB;
let ws: Workspace;
beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
});
afterEach(() => vi.unstubAllGlobals());

describe("CSV parsing", () => {
  it("handles quotes, BOM, aliases and delimiters", () => {
    const rows = parseCsv('﻿Day,Campaign,"Amount spent (USD)",Impr.\r\n2026-09-01,"Retargeting, US","1,234.50",100\n');
    expect(rows).toEqual([{ date: "2026-09-01", campaign_name: "Retargeting, US", spend: "1,234.50", impressions: "100" }]);
    expect(normalizeDate("09/01/2026")).toBe("2026-09-01");
    expect(normalizeDate("01.09.2026")).toBe("2026-09-01");
  });
});

describe("Spend API / CSV import", () => {
  it("imports any platform's spend exactly and idempotently", async () => {
    const rows = parseCsv(SPEND_TEMPLATE);
    const first = await importSpend(db, ws, rows as never[]);
    expect(first).toMatchObject({ rows: 2, errors: [] });
    await importSpend(db, ws, rows as never[]);
    const insights = await db.select().from(schema.adInsightsDaily).where(eq(schema.adInsightsDaily.workspaceId, ws.id));
    expect(insights).toHaveLength(2);
    expect(insights.map((i) => i.spendMinor).sort((a, b) => a - b)).toEqual([9810, 12540]);
    expect(insights.every((i) => i.platform === "other")).toBe(true);
  });
  it("reports bad rows without failing the good ones", async () => {
    const r = await importSpend(db, ws, [
      { date: "2026-09-02", campaign_name: "Quora – Q&A", spend: "$19.99", platform: "other" },
      { date: "yesterday", campaign_name: "Broken", spend: "1" },
    ]);
    expect(r.rows).toBe(1);
    expect(r.errors[0]).toMatch(/Row 2: date/);
  });
});

describe("Conversions API", () => {
  it("stores payments, refunds and leads, matched by email", async () => {
    const r = await importConversions(db, ws, [
      { type: "lead", external_id: "l1", email: "api-buyer@example.com", name: "Api Buyer" },
      { type: "payment", external_id: "o1", amount: "249.00", currency: "USD", email: "api-buyer@example.com", source: "shop" },
      { type: "refund", external_id: "r1", related_external_id: "o1", amount: "49", currency: "usd", email: "api-buyer@example.com", source: "shop" },
      { type: "payment", external_id: "bad", amount: "abc" },
    ]);
    expect(r).toMatchObject({ revenue: 2, leads: 1 });
    expect(r.errors).toHaveLength(1);
    const rev = await db.select().from(schema.revenueEvents).where(eq(schema.revenueEvents.source, "shop"));
    expect(rev.map((e) => e.amountMinor).sort((a, b) => a - b)).toEqual([-4900, 24900]);
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.email, "api-buyer@example.com"));
    expect(c.lifecycle).toBe("customer");
  });
});

describe("notifications", () => {
  it("delivers events to the channels a rule selects", async () => {
    const calls: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: String(init.body) });
        return new Response("ok", { status: 200 });
      }),
    );
    await saveConnection(ws.id, "notify_slack", { mode: "live", secrets: { webhookUrl: "https://hooks.slack.com/services/T/B/X" } }, db);
    await db.insert(schema.notificationRules).values({ workspaceId: ws.id, channel: "notify_slack", event: "new_customer" });
    await db.insert(schema.notificationRules).values({ workspaceId: ws.id, channel: "notify_slack", event: "big_payment", settings: { threshold: 1000 } });

    // A new customer paying $1,500 triggers both "new customer" and "large payment".
    await ingestRevenue(db, ws.id, "api", [
      { type: "payment", externalId: "big-1", amountMinor: 150000, currency: "USD", occurredAt: new Date(), customer: { email: "whale@example.com", name: "Whale Co" } },
    ]);
    await vi.waitFor(() => expect(calls.length).toBe(2));
    expect(calls.every((c) => c.url.startsWith("https://hooks.slack.com/"))).toBe(true);
    expect(calls.map((c) => c.body).join()).toContain("New customer: Whale Co paid $1,500.00");

    // Below the threshold: only nothing new (already a customer, small payment).
    calls.length = 0;
    await ingestRevenue(db, ws.id, "api", [
      { type: "payment", externalId: "small-1", amountMinor: 1000, currency: "USD", occurredAt: new Date(), customer: { email: "whale@example.com" } },
    ]);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);

    // A replayed webhook for the big payment updates the row but never notifies again.
    await ingestRevenue(db, ws.id, "api", [
      { type: "payment", externalId: "big-1", amountMinor: 150000, currency: "USD", occurredAt: new Date(), customer: { email: "whale@example.com", name: "Whale Co" } },
    ]);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
  });

  it("never throws when a channel is broken", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(
      notify(ws.id, "new_customer", () => ({ title: "x", text: "y", severity: "info" }), db),
    ).resolves.toBeUndefined();
  });

  it("sends the daily digest once per day after the chosen hour", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: RequestInit) => (calls.push(String(init.body)), new Response("ok"))));
    await db.insert(schema.notificationRules).values({ workspaceId: ws.id, channel: "notify_slack", event: "daily_digest", settings: { hour: 8 } });
    const before = new Date("2026-09-10T07:30:00Z");
    const after = new Date("2026-09-10T08:30:00Z");
    await runScheduledNotifications(db, ws, before);
    expect(calls).toHaveLength(0);
    await runScheduledNotifications(db, ws, after);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Yesterday in");
    await runScheduledNotifications(db, ws, new Date("2026-09-10T15:00:00Z"));
    expect(calls).toHaveLength(1);
  });
});
