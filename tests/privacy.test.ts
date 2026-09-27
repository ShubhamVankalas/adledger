import { and, desc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { recomputeAttribution } from "@/lib/attribution";
import { hashEmail, sha256 } from "@/lib/crypto";
import { rows, schema, type DB } from "@/lib/db";
import { clearWorkspaceData } from "@/lib/demo/seed";
import { importConversions } from "@/lib/imports";
import {
  applyRetention,
  applyRetentionAll,
  collectText,
  contactsCsv,
  csvCell,
  eraseContact,
  EXPORT_TABLES,
  exportContact,
  getRetention,
  minorToDecimal,
  setRetention,
  workspaceExportJson,
} from "@/lib/privacy";
import { overview, type ReportParams } from "@/lib/reports";
import { type Workspace } from "@/lib/settings";
import { processCollect } from "@/lib/tracking/collect";
import { setupWorkspace } from "./helpers";

// Route handlers and server actions read the session cookie through next/headers.
const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (session.token ? { name, value: session.token } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let db: DB;
let ws: Workspace;
let orgId: string;
const NOW = new Date("2026-09-20T12:00:00Z");
const JANE = "jane.doe@acme.test";
const BOB = "bob@example.test";
const PERIOD = { start: "2026-09-01", end: "2026-09-30", model: "last_touch" } as ReportParams;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";

async function contactId(email: string) {
  const [c] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.email, email)));
  return c?.id;
}

async function revenueTotals() {
  const [r] = rows<{ total: string; n: string }>(
    await db.execute(sql`select coalesce(sum(amount_minor),0) total, count(*) n from revenue_events where workspace_id = ${ws.id}`),
  );
  const credits = rows<{ model: string; total: string }>(
    await db.execute(sql`select model, sum(revenue_minor) total from attribution_credits
      where workspace_id = ${ws.id} and conversion_type = 'revenue' group by model order by model`),
  );
  return { total: Number(r.total), n: Number(r.n), byModel: Object.fromEntries(credits.map((c) => [c.model, Number(c.total)])) };
}

/** A member with a live session (the mocked cookie jar returns its token when selected). */
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

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
  await db.insert(schema.pixelSites).values({ workspaceId: ws.id, name: "Site", domains: "", publicKey: "pk_privacy00001" });
  const ctx = { origin: "https://shop.test", userAgent: UA, ip: "203.0.113.9", now: NOW };
  // Jane: paid click whose landing URL leaks her email, then a pixel lead with her traits.
  await processCollect(
    db,
    {
      site: "pk_privacy00001",
      vid: "vid-jane-000001",
      events: [
        { t: "page_view", ts: NOW.getTime() - 3_600_000, url: `https://shop.test/?utm_source=facebook&utm_medium=paid_social&utm_campaign=spring&email=jane.doe%40acme.test` },
        { t: "lead", ts: NOW.getTime() - 1_800_000, url: "https://shop.test/signup", name: "Signup", props: { email: JANE, plan: "pro" }, traits: { email: JANE, name: "Jane Doe" } },
        { t: "custom", ts: NOW.getTime() - 1_700_000, url: "https://shop.test/checkout", name: "Checkout", props: { shipping_name: "Janet Quill", city: "Lyon" } },
      ],
    },
    ctx,
  );
  // Bob: organic visitor and customer (the control that must stay untouched).
  await processCollect(
    db,
    {
      site: "pk_privacy00001",
      vid: "vid-bob-0000001",
      events: [
        { t: "page_view", ts: NOW.getTime() - 7_200_000, url: "https://shop.test/pricing", ref: "https://www.google.com/" },
        { t: "identify", ts: NOW.getTime() - 7_000_000, traits: { email: BOB, name: "Bob" } },
      ],
    },
    ctx,
  );
  await importConversions(db, ws, [
    { type: "payment", external_id: "o-jane-1", amount: "120.00", currency: "USD", email: JANE, occurred_at: "2026-09-20T13:00:00Z" },
    { type: "payment", external_id: "o-jane-2", amount: "30.00", currency: "USD", email: JANE, occurred_at: "2026-09-21T13:00:00Z" },
    { type: "refund", external_id: "r-jane-1", related_external_id: "o-jane-2", amount: "10", currency: "USD", email: JANE, occurred_at: "2026-09-22T13:00:00Z" },
    { type: "payment", external_id: "o-bob-1", amount: "50.00", currency: "USD", email: BOB, occurred_at: "2026-09-20T15:00:00Z" },
  ]);
});

describe("contacts CSV export", () => {
  it("escapes cells and neutralizes spreadsheet formulas", () => {
    expect(csvCell('Acme, "Inc"')).toBe('"Acme, ""Inc"""');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(null)).toBe("");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("-10.00")).toBe("-10.00"); // negative amounts stay numeric
    expect(csvCell("-1+2")).toBe("'-1+2");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(minorToDecimal(12345, 2)).toBe("123.45");
    expect(minorToDecimal(-5, 2)).toBe("-0.05");
    expect(minorToDecimal(700, 0)).toBe("700");
  });

  it("exports the current filter with exact money", async () => {
    const all = (await collectText(contactsCsv(db, ws, {}))).trim().split("\r\n");
    expect(all[0]).toMatch(/^id,email,name,lifecycle/);
    expect(all).toHaveLength(3);
    const jane = all.find((l) => l.includes(JANE))!;
    expect(jane).toContain(",customer,");
    expect(jane).toContain(",140.00,14000,USD");
    const filtered = (await collectText(contactsCsv(db, ws, { search: "bob" }))).trim().split("\r\n");
    expect(filtered).toHaveLength(2);
    expect(filtered[1]).toContain(BOB);
    const leads = (await collectText(contactsCsv(db, ws, { lifecycle: "lead" }))).trim().split("\r\n");
    expect(leads).toHaveLength(1);
  });
});

describe("subject-access export", () => {
  it("returns everything stored about one contact", async () => {
    const id = (await contactId(JANE))!;
    const data = await exportContact(db, ws, id);
    expect(data?.contact.email).toBe(JANE);
    expect(data?.devices).toHaveLength(1);
    expect(data?.touchpoints).toHaveLength(1);
    expect(data?.leads).toHaveLength(1);
    expect(data?.payments.map((p) => p.amountMinor).sort((a, b) => a - b)).toEqual([-1000, 3000, 12000]);
    expect(data?.attribution.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain(BOB);
    expect(await exportContact(db, ws, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("workspace export", () => {
  it("streams valid JSON with every table and no credentials", async () => {
    await db.insert(schema.apiKeys).values({ workspaceId: ws.id, name: "k", prefix: "al_abc", keyHash: "HASH_SHOULD_NOT_LEAK" });
    const doc = JSON.parse(await collectText(workspaceExportJson(db, ws)));
    expect(doc.format).toBe("adledger-workspace-export");
    expect(Object.keys(doc.tables)).toEqual(EXPORT_TABLES.map((t) => t.table));
    // A new workspace table must be added to the export (or excluded here on purpose).
    const scoped = rows<{ table_name: string }>(
      await db.execute(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'workspace_id'`),
    ).map((r) => r.table_name);
    const notExported = ["sessions", "contact_notes", "contact_stats"];
    expect(scoped.filter((t) => !notExported.includes(t)).sort()).toEqual(EXPORT_TABLES.map((t) => t.table).sort());
    expect(doc.tables.contacts).toHaveLength(2);
    expect(doc.tables.revenue_events.map((r: { amount_minor: number }) => r.amount_minor).sort((a: number, b: number) => a - b)).toEqual([-1000, 3000, 5000, 12000]);
    expect(doc.tables.api_keys[0]).not.toHaveProperty("key_hash");
    expect(JSON.stringify(doc)).not.toContain("HASH_SHOULD_NOT_LEAK");
  });
});

describe("right to erasure", () => {
  it("removes the raw email everywhere, keeps revenue totals and recomputes attribution", async () => {
    const id = (await contactId(JANE))!;
    const before = await revenueTotals();
    const overviewBefore = await overview(db, ws, PERIOD);
    expect(before.total).toBe(19000);
    // Before erasure the email (plain or hashed) is findable.
    const dumpBefore = await collectText(workspaceExportJson(db, ws));
    expect(dumpBefore).toContain(JANE);
    expect(dumpBefore).toContain(hashEmail(JANE));
    expect(dumpBefore).toContain("jane.doe%40acme.test");

    const result = await eraseContact(db, ws.id, id);
    expect(result).toMatchObject({ leads: 1, visitors: 1, revenueEvents: 3 });

    const dump = await collectText(workspaceExportJson(db, ws));
    expect(dumpBefore).toContain("Janet Quill");
    for (const needle of [JANE, "jane.doe%40acme.test", hashEmail(JANE), "Jane Doe", "Janet Quill"]) expect(dump).not.toContain(needle);
    expect(dump).toContain(BOB); // other contacts untouched

    const after = await revenueTotals();
    expect(after).toEqual({ ...before, byModel: after.byModel });
    for (const [model, total] of Object.entries(before.byModel)) expect(after.byModel[model]).toBe(total);
    const overviewAfter = await overview(db, ws, PERIOD);
    expect(overviewAfter.revenueMinor).toBe(overviewBefore.revenueMinor);
    expect(overviewAfter.unattributedRevenueMinor).toBeGreaterThan(overviewBefore.unattributedRevenueMinor);

    const credits = await db.select().from(schema.attributionCredits).where(eq(schema.attributionCredits.contactId, id));
    expect(credits).toHaveLength(0);
    // The in-place credit update equals a full recompute.
    const snapshot = async () =>
      rows<Record<string, unknown>>(
        await db.execute(sql`select model, conversion_type, conversion_id, conversion_at, contact_id, touchpoint_id, channel, platform,
            campaign_id, ad_group_id, ad_id, credit::text, revenue_minor, currency
          from attribution_credits where workspace_id = ${ws.id}
          order by model, conversion_type, conversion_id, touchpoint_id nulls first`),
      );
    const inPlace = await snapshot();
    await recomputeAttribution(db, ws.id);
    expect(await snapshot()).toEqual(inPlace);
    // Anonymous browsing data is kept.
    const [v] = await db.select().from(schema.visitors).where(eq(schema.visitors.anonymousId, "vid-jane-000001"));
    expect(v.contactId).toBeNull();
    expect(await db.select().from(schema.touchpoints).where(eq(schema.touchpoints.visitorId, v.id))).toHaveLength(1);
    expect(await eraseContact(db, ws.id, id)).toBeNull();
  });
});

describe("privacy routes and actions", () => {
  it("DELETE /api/v1/contacts/{id} needs an API key or workspace.data, and is audited", async () => {
    const { DELETE } = await import("@/app/api/v1/contacts/[id]/route");
    const { createApiKey } = await import("@/lib/auth");
    await importConversions(db, ws, [{ type: "lead", external_id: "l-eve", email: "eve@example.test", name: "Eve" }]);
    const id = (await contactId("eve@example.test"))!;
    const req = (headers: Record<string, string> = {}) => new Request(`http://localhost/api/v1/contacts/${id}`, { method: "DELETE", headers });
    const params = Promise.resolve({ id });

    session.token = undefined;
    expect((await DELETE(req(), { params })).status).toBe(401);
    expect((await DELETE(req({ authorization: "Bearer al_nope" }), { params })).status).toBe(401);
    session.token = await member("analyst");
    expect((await DELETE(req(), { params })).status).toBe(403);
    session.token = undefined;

    // Erasure is a write: a key needs the ingest:write scope (new keys are read-only).
    const { key: readOnly } = await createApiKey(ws.id, "read-only");
    expect((await DELETE(req({ authorization: `Bearer ${readOnly}` }), { params })).status).toBe(403);
    const { key } = await createApiKey(ws.id, "privacy", ["ingest:write"]);
    const r = await DELETE(req({ authorization: `Bearer ${key}` }), { params });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ deleted: true, id, leads: 1 });
    expect(await contactId("eve@example.test")).toBeUndefined();
    expect((await DELETE(req({ authorization: `Bearer ${key}` }), { params })).status).toBe(404);

    const [entry] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.action, "contact.erased"), eq(schema.auditLog.target, id)));
    expect(entry.meta).toMatchObject({ via: "api_key" });
    expect(JSON.stringify(entry)).not.toContain("eve@example.test");
  });

  it("GET /api/v1/contacts/{id}/export works with an API key that has contacts:pii", async () => {
    const { GET } = await import("@/app/api/v1/contacts/[id]/export/route");
    const { createApiKey } = await import("@/lib/auth");
    const id = (await contactId(BOB))!;
    const { key: masked } = await createApiKey(ws.id, "sar-masked", ["contacts:read"]);
    expect((await GET(new Request(`http://localhost/x`, { headers: { authorization: `Bearer ${masked}` } }), { params: Promise.resolve({ id }) })).status).toBe(403);
    const { key } = await createApiKey(ws.id, "sar", ["contacts:pii"]);
    const r = await GET(new Request(`http://localhost/x`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toMatch(/attachment/);
    expect((await r.json()).contact.email).toBe(BOB);
    const missing = await GET(new Request(`http://localhost/x`, { headers: { authorization: `Bearer ${key}` } }), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(404);
  });

  it("contacts CSV needs export.csv (emails raw only with export.contacts); workspace export needs a session with workspace.data", async () => {
    const { GET: contactsCsvRoute } = await import("@/app/api/v1/exports/contacts/route");
    const { GET: workspaceExport } = await import("@/app/api/v1/exports/workspace/route");
    const { createApiKey } = await import("@/lib/auth");

    session.token = await member("viewer");
    expect((await contactsCsvRoute(new Request("http://localhost/api/v1/exports/contacts"))).status).toBe(403);
    expect((await workspaceExport(new Request("http://localhost/api/v1/exports/workspace"))).status).toBe(403);

    // Analysts can export, but get masked emails.
    session.token = await member("analyst");
    const csv = await contactsCsvRoute(new Request("http://localhost/api/v1/exports/contacts?lifecycle=customer"));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toMatch(/text\/csv/);
    expect(csv.headers.get("content-disposition")).toMatch(/contacts-masked/);
    const maskedText = await csv.text();
    expect(maskedText).not.toContain(BOB);
    expect(maskedText).toContain("b••@example.test");
    expect((await workspaceExport(new Request("http://localhost/api/v1/exports/workspace"))).status).toBe(403);

    session.token = await member("admin");
    const raw = await contactsCsvRoute(new Request("http://localhost/api/v1/exports/contacts?lifecycle=customer"));
    expect(await raw.text()).toContain(BOB);
    const [logged] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, "contacts.exported"))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1);
    expect(logged.meta).toMatchObject({ masked: false, complete: true });
    expect(logged.meta.rows).toBeGreaterThan(0);
    const full = await workspaceExport(new Request("http://localhost/api/v1/exports/workspace"));
    expect(full.status).toBe(200);
    expect(JSON.parse(await full.text()).workspace.id).toBe(ws.id);

    session.token = undefined;
    const { key } = await createApiKey(ws.id, "no-full-export");
    expect((await workspaceExport(new Request("http://localhost/x", { headers: { authorization: `Bearer ${key}` } }))).status).toBe(403);
  });

  it("deleteContactAction is guarded by workspace.data", async () => {
    const { deleteContactAction } = await import("@/app/actions/privacy");
    const id = (await contactId(BOB))!;
    session.token = await member("analyst");
    expect(await deleteContactAction(id)).toMatchObject({ ok: false });
    expect(await contactId(BOB)).toBe(id);
    session.token = await member("owner");
    expect(await deleteContactAction(id)).toMatchObject({ ok: true });
    expect(await contactId(BOB)).toBeUndefined();
    session.token = undefined;
  });
});

describe("data retention", () => {
  it("deletes raw events older than the setting, keeps touchpoints, and survives a data reset", async () => {
    const { db: db2, ws: ws2 } = await setupWorkspace();
    const [visitor] = await db2
      .insert(schema.visitors)
      .values({ workspaceId: ws2.id, anonymousId: "vid-retention-1", firstSeenAt: new Date("2026-01-01T00:00:00Z"), lastSeenAt: NOW })
      .returning();
    const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000);
    await db2.insert(schema.events).values([100, 40, 10, 1].map((d) => ({ workspaceId: ws2.id, visitorId: visitor.id, type: "page_view" as const, occurredAt: at(d) })));
    await db2.insert(schema.touchpoints).values({ workspaceId: ws2.id, visitorId: visitor.id, occurredAt: at(100), channel: "organic" });

    expect(await applyRetention(db2, ws2.id, NOW)).toBeNull(); // off by default
    await expect(setRetention(db2, ws2.id, 1)).rejects.toThrow(/between/);
    await setRetention(db2, ws2.id, 30);
    expect((await getRetention(db2, ws2.id)).eventsDays).toBe(30);

    expect(await applyRetentionAll(db2, NOW)).toBe(2);
    const left = await db2.select().from(schema.events).where(eq(schema.events.workspaceId, ws2.id));
    expect(left.map((e) => Math.round((NOW.getTime() - e.occurredAt.getTime()) / 86_400_000)).sort((a, b) => a - b)).toEqual([1, 10]);
    expect(await db2.select().from(schema.touchpoints).where(eq(schema.touchpoints.workspaceId, ws2.id))).toHaveLength(1);
    const r = await getRetention(db2, ws2.id);
    expect(r.lastRunAt).toBe(NOW.toISOString());
    expect(r.lastDeleted).toBe(2);

    await clearWorkspaceData(db2, ws2.id);
    expect((await getRetention(db2, ws2.id)).eventsDays).toBe(30);

    await setRetention(db2, ws2.id, null);
    expect((await getRetention(db2, ws2.id)).eventsDays).toBeNull();
    expect(await applyRetention(db2, ws2.id, NOW)).toBeNull();
  });
});
