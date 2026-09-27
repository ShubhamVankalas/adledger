import { beforeAll, describe, expect, it, vi } from "vitest";
import { recomputeAttribution } from "@/lib/attribution";
import { createApiKey } from "@/lib/auth";
import { sha256 } from "@/lib/crypto";
import { rows, schema, type DB } from "@/lib/db";
import { buildMcpHandler } from "@/lib/mcp";
import { getUnitEconomics } from "@/lib/reports-profit";
import type { Workspace } from "@/lib/settings";
import { upsertAdRows } from "@/lib/sync";
import { sql } from "drizzle-orm";
import { setupWorkspace } from "./helpers";

// Routes, server actions and the MCP tool around Ad Receipts / Truth Gap / Profit: permissions,
// workspace isolation, no raw emails, and the pause-draft export.

const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (session.token ? { name, value: session.token } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let db: DB;
let ws: Workspace;
let orgId: string;
let paymentId: string;
let contactId: string;
let campaignId: string;

async function member(role: "owner" | "admin" | "analyst" | "viewer") {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" })
    .returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: ws.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

const Q = "start=2026-07-01&end=2026-07-31&model=linear";

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
  // Meta ad: $100 over Jul 1–2 (10 clicks); claims $400. Dana clicks Jul 1 and pays $150 on Jul 3.
  await upsertAdRows(
    db,
    ws.id,
    ["2026-07-01", "2026-07-02"].map((date) => ({
      platform: "meta" as const,
      account: { externalId: "acc", name: "Acc", currency: "USD", timezone: null },
      campaign: { externalId: "c-loser", name: "Cold audience", status: "ACTIVE", objective: null },
      adGroup: { externalId: "g", name: "Group", status: null },
      ad: { externalId: "a", name: "Carousel", status: null },
      date,
      spendMinor: 5_000,
      impressions: 1000,
      clicks: 5,
      conversions: "3",
      conversionValueMinor: 20_000,
    })),
  );
  const [camp] = await db.select().from(schema.campaigns);
  const [ad] = await db.select().from(schema.ads);
  campaignId = camp.id;
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: ws.id, email: "dana.lopez@example.com", name: "Dana Lopez", firstSeenAt: new Date("2026-07-01T00:00:00Z"), lifecycle: "customer" })
    .returning();
  contactId = c.id;
  const [v] = await db
    .insert(schema.visitors)
    .values({ workspaceId: ws.id, anonymousId: "vid-dana", firstSeenAt: new Date("2026-07-01T09:00:00Z"), lastSeenAt: new Date("2026-07-01T09:00:00Z"), contactId: c.id })
    .returning();
  await db.insert(schema.touchpoints).values({ workspaceId: ws.id, visitorId: v.id, occurredAt: new Date("2026-07-01T09:00:00Z"), channel: "paid_social", platform: "meta", campaignId: camp.id, adId: ad.id });
  const [pay] = await db
    .insert(schema.revenueEvents)
    .values({ workspaceId: ws.id, contactId: c.id, source: "api", externalId: "p1", type: "payment", amountMinor: 15_000, currency: "USD", occurredAt: new Date("2026-07-03T10:00:00Z") })
    .returning();
  paymentId = pay.id;
  await recomputeAttribution(db, ws.id);
});

describe("GET /api/v1/receipts/{paymentId}", () => {
  it("returns the receipt with a masked email, and 404s across workspaces", async () => {
    const { GET } = await import("@/app/api/v1/receipts/[paymentId]/route");
    const call = (id: string, headers: Record<string, string> = {}, q = "") =>
      GET(new Request(`http://localhost/api/v1/receipts/${id}${q}`, { headers }), { params: Promise.resolve({ paymentId: id }) });
    session.token = undefined;
    expect((await call(paymentId)).status).toBe(401);
    const { key } = await createApiKey(ws.id, "receipts");
    const auth = { authorization: `Bearer ${key}` };
    const res = await call(paymentId, auth);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("dana.lopez@example.com");
    const body = JSON.parse(text);
    expect(body.data.payment.amountMinor).toBe(15_000);
    expect(body.data.earnedBy.reduce((s: number, e: { revenueMinor: number }) => s + e.revenueMinor, 0)).toBe(15_000);
    expect(body.data.contact.costMinor).toBe(10_000); // the ad's whole July spend: Dana is its only customer
    const clicks = await (await call(paymentId, auth, "?cost=clicks")).json();
    expect(clicks.data.contact.costMinor).toBe(1_000); // 1 of 5 clicks on Jul 1 at $10
    expect((await call("not-a-uuid", auth)).status).toBe(404);

    const { ws: other } = await setupWorkspace();
    const { key: otherKey } = await createApiKey(other.id, "other");
    expect((await call(paymentId, { authorization: `Bearer ${otherKey}` })).status).toBe(404);
  });
});

describe("GET /api/v1/money/{report}", () => {
  it("serves truth gap, profit, time to money and the acquisition ledger", async () => {
    const { GET } = await import("@/app/api/v1/money/[report]/route");
    const { key } = await createApiKey(ws.id, "money");
    const call = (report: string, q = Q) =>
      GET(new Request(`http://localhost/api/v1/money/${report}?${q}`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ report }) });
    const truth = await (await call("truth-gap")).json();
    expect(truth.data.platforms[0]).toMatchObject({ platform: "meta", platformValueMinor: 40_000, verifiedRevenueMinor: 15_000, valueGapMinor: 25_000 });
    const profit = await (await call("profit", `${Q}&level=platform`)).json();
    expect(profit.data.ledger).toMatchObject({ netRevenueMinor: 15_000, spendMinor: 10_000, contributionMinor: 15_000 });
    expect(profit.data.rows.map((r: { id: string }) => r.id)).toEqual(["meta"]);
    const ttm = await (await call("time-to-money")).json();
    expect(ttm.data.campaigns[0]).toMatchObject({ name: "Cold audience", ageDays: 30 });
    const acq = await (await call("acquisition", `${Q}&cost=clicks`)).json();
    expect(acq.data).toMatchObject({ basis: "clicks", spendMinor: 10_000, allocatedMinor: 1_000, unallocatedMinor: 9_000 });
    expect(JSON.stringify(acq)).not.toContain("@");
    expect((await call("nope")).status).toBe(404);
    expect((await call("profit", "start=bad")).status).toBe(400);
  });
});

describe("GET /api/v1/exports/pause-drafts", () => {
  it("needs reports.export, returns a bulk-edit CSV and is audited", async () => {
    const { GET } = await import("@/app/api/v1/exports/pause-drafts/route");
    // Two days of $100 for $150 back is ROAS 1.5: judge a losing month instead (spend with no sales).
    const q = "start=2026-07-01&end=2026-07-02&model=linear&platform=meta";
    session.token = await member("viewer");
    expect((await GET(new Request(`http://localhost/api/v1/exports/pause-drafts?${q}`))).status).toBe(403);
    session.token = await member("analyst");
    const bad = await GET(new Request("http://localhost/api/v1/exports/pause-drafts?start=2026-07-01&end=2026-07-02&platform=tiktok"));
    expect(bad.status).toBe(400);
    const res = await GET(new Request(`http://localhost/api/v1/exports/pause-drafts?${q}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/pause-drafts-meta/);
    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toBe("Campaign ID,Campaign Name,Campaign Status");
    const [log] = rows<{ action: string }>(await db.execute(sql`select action from audit_log where action = 'pause_drafts.exported' limit 1`));
    expect(log?.action).toBe("pause_drafts.exported");
    session.token = undefined;
  });
});

describe("unit economics actions", () => {
  it("only owners and admins can change them; values are validated and audited", async () => {
    const { saveUnitEconomicsAction, clearUnitEconomicsAction } = await import("@/app/actions/profit");
    const form = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    session.token = await member("analyst");
    expect((await saveUnitEconomicsAction(form({ cogsPct: "30" }))).ok).toBe(false);
    session.token = await member("admin");
    expect((await saveUnitEconomicsAction(form({ cogsPct: "130" }))).ok).toBe(false);
    expect((await saveUnitEconomicsAction(form({ cogsPct: "30", feePct: "2.9", feeFixed: "-1" }))).ok).toBe(false);
    const r = await saveUnitEconomicsAction(form({ cogsPct: "30", feePct: "2.9", feeFixed: "0.30", shipping: "4.5" }));
    expect(r.ok).toBe(true);
    expect(await getUnitEconomics(db, ws.id)).toMatchObject({ configured: true, grossMarginBps: 7_000, feeBps: 290, feeFixedMinor: 30, shippingPerOrderMinor: 450 });
    const [log] = rows<{ n: string }>(await db.execute(sql`select count(*) n from audit_log where action = 'unit_economics.updated'`));
    expect(Number(log.n)).toBe(1);
    expect((await clearUnitEconomicsAction()).ok).toBe(true);
    expect((await getUnitEconomics(db, ws.id)).configured).toBe(false);
    session.token = undefined;
  });
});

describe("MCP get_ad_receipt", () => {
  async function tool(w: Workspace, args: Record<string, unknown>) {
    const res = await buildMcpHandler(w)(
      new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_ad_receipt", arguments: args } }),
      }),
    );
    const text = await res.text();
    const json = text.trim().startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
    return json.result.content[0].text as string;
  }

  it("describes a payment's receipt with a masked email", async () => {
    const t = await tool(ws, { paymentId });
    expect(t).toContain("$150.00");
    expect(t).toContain("Carousel (meta)");
    expect(t).toContain("100.0%");
    expect(t).toContain("Acquisition cost");
    expect(t).toContain("Payback: paid back on 2026-07-03");
    expect(t).not.toContain("dana.lopez@example.com");
    expect(t).toMatch(/d•+@example\.com/);
    const byContact = await tool(ws, { contactId, cost: "clicks" });
    expect(byContact).toContain("own clicks only): $10.00");
    expect(await tool(ws, {})).toContain("Pass a paymentId or a contactId");
    const { ws: other } = await setupWorkspace();
    expect(await tool(other, { paymentId })).toBe("Payment not found.");
    expect(campaignId).toBeTruthy();
  });
});
