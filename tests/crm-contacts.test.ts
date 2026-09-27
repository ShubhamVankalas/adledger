import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { sha256 } from "@/lib/crypto";
import { DEFAULT_QUERY, parseContactQuery, contactQueryParams } from "@/lib/crm-query";
import { rows, schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { roleCan } from "@/lib/permissions";
import {
  contactGroupTotals,
  contactRecord,
  contactTotals,
  highValueThreshold,
  listContactsPage,
  myTasks,
  overdueTaskCount,
  refreshContactStats,
  starterViewCounts,
  type ResolvedQuery,
} from "@/lib/reports-crm";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// Server actions read the session cookie through next/headers.
const session = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (session.token ? { name, value: session.token } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let db: DB;
let ws: Workspace;
let other: Workspace;
let orgId: string;
const viewer = null;

const q = (patch: Partial<ResolvedQuery> = {}): ResolvedQuery => ({ ...DEFAULT_QUERY, viewerId: "00000000-0000-0000-0000-000000000000", ...patch });

async function member(role: "owner" | "admin" | "analyst" | "viewer" | "client", workspace = ws) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x", name: `${role} person` })
    .returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role, workspaceIds: role === "client" ? [workspace.id] : null });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: workspace.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return { token, id: user.id };
}

async function contactIds(workspaceId: string, limit = 5): Promise<string[]> {
  return rows<{ id: string }>(await db.execute(sql`select id from contacts where workspace_id = ${workspaceId} order by first_seen_at, id limit ${limit}`)).map((r) => r.id);
}

async function auditActions(): Promise<string[]> {
  return rows<{ action: string }>(await db.execute(sql`select action from audit_log where workspace_id = ${ws.id} order by created_at`)).map((r) => r.action);
}

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
  [other] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Other", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
  // Demo data recomputes attribution, which rebuilds contact_stats.
  await seedDemo(db, ws.id, { anchor: "2026-09-01" });
  await db.insert(schema.contacts).values({ workspaceId: other.id, email: "stranger@other.test", name: "Other Person", firstSeenAt: new Date("2026-08-01T00:00:00Z") });
  await refreshContactStats(db, other.id);
}, 600_000);

describe("contact_stats roll-up", () => {
  it("has one row per contact and matches the ledger", async () => {
    const [counts] = rows<{ contacts: string; stats: string }>(
      await db.execute(sql`select (select count(*) from contacts where workspace_id = ${ws.id}) contacts,
        (select count(*) from contact_stats where workspace_id = ${ws.id}) stats`),
    );
    expect(Number(counts.contacts)).toBeGreaterThan(800);
    expect(Number(counts.stats)).toBe(Number(counts.contacts));

    const mismatches = rows<{ id: string }>(
      await db.execute(sql`
        with truth as (
          select c.id,
            coalesce((select sum(amount_minor) from revenue_events r where r.contact_id = c.id and r.currency = ${ws.reportingCurrency}), 0) revenue,
            (select count(*) from revenue_events r where r.contact_id = c.id and r.type = 'payment') orders,
            (select count(*) from touchpoints t join visitors v on v.id = t.visitor_id where v.contact_id = c.id) touches
          from contacts c where c.workspace_id = ${ws.id}
        )
        select t.id from truth t join contact_stats s on s.contact_id = t.id
        where s.revenue_minor <> t.revenue or s.orders <> t.orders or s.touches <> t.touches`),
    );
    expect(mismatches).toEqual([]);
  });

  it("keeps the first touch platform of the earliest touchpoint", async () => {
    const [row] = rows<{ ok: boolean }>(
      await db.execute(sql`
        select bool_and(s.first_touch_platform is not distinct from (
          select t.platform from touchpoints t join visitors v on v.id = t.visitor_id
          where v.contact_id = s.contact_id order by t.occurred_at, t.id limit 1)) ok
        from contact_stats s where s.workspace_id = ${ws.id}`),
    );
    expect(row.ok).toBe(true);
  });

  it("scores engagement between 0 and 100", async () => {
    const [r] = rows<{ lo: number; hi: number }>(await db.execute(sql`select min(engagement) lo, max(engagement) hi from contact_stats where workspace_id = ${ws.id}`));
    expect(Number(r.lo)).toBeGreaterThanOrEqual(0);
    expect(Number(r.hi)).toBeLessThanOrEqual(100);
  });
});

describe("contacts table", () => {
  it("footer totals equal a direct SQL check", async () => {
    const totals = await contactTotals(db, ws, q());
    const [truth] = rows<Record<string, string>>(
      await db.execute(sql`select count(*) cnt, count(*) filter (where lifecycle = 'customer') customers,
        coalesce((select sum(amount_minor) from revenue_events where workspace_id = ${ws.id} and contact_id is not null and currency = ${ws.reportingCurrency}), 0) revenue
        from contacts where workspace_id = ${ws.id}`),
    );
    expect(totals.count).toBe(Number(truth.cnt));
    expect(totals.customers).toBe(Number(truth.customers));
    expect(totals.revenueMinor).toBe(Number(truth.revenue));
    expect(totals.avgLtvMinor).toBeGreaterThan(0);

    const meta = await contactTotals(db, ws, q({ platform: ["meta"] }));
    const [metaTruth] = rows<{ cnt: string; revenue: string }>(
      await db.execute(sql`select count(*) cnt, coalesce(sum(s.revenue_minor), 0) revenue from contacts c join contact_stats s on s.contact_id = c.id
        where c.workspace_id = ${ws.id} and s.first_touch_platform = 'meta'`),
    );
    expect(meta.count).toBe(Number(metaTruth.cnt));
    expect(meta.revenueMinor).toBe(Number(metaTruth.revenue));
    expect(meta.count).toBeGreaterThan(0);

    const groups = await contactGroupTotals(db, ws, q());
    expect(groups.customer.count + groups.lead.count).toBe(totals.count);
    expect(groups.customer.revenueMinor + groups.lead.revenueMinor).toBe(totals.revenueMinor);
  });

  it("walks every contact exactly once with keyset paging, forwards and back", async () => {
    for (const query of [q({ sort: "revenue" }), q({ sort: "name", dir: "asc" }), q({ sort: "first_seen", group: "lifecycle" })]) {
      const total = (await contactTotals(db, ws, query)).count;
      const seen: string[] = [];
      const pages: { first: string; cursor: string | null }[] = [];
      let cursor: string | null = null;
      for (let guard = 0; guard < 200; guard++) {
        const page = await listContactsPage(db, ws, { ...query, cursor }, viewer, 100);
        pages.push({ first: page.rows[0]?.id, cursor });
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen.length).toBe(total);
      expect(new Set(seen).size).toBe(total);
      // Step back one page from the last one: the previous page comes back identically.
      const last = await listContactsPage(db, ws, { ...query, cursor: pages.at(-1)!.cursor }, viewer, 100);
      expect(last.prevCursor).toBeTruthy();
      const back = await listContactsPage(db, ws, { ...query, cursor: last.prevCursor }, viewer, 100);
      expect(back.rows[0].id).toBe(pages.at(-2)!.first);
    }
  });

  it("sorts by revenue descending and applies the high-value view", async () => {
    const page = await listContactsPage(db, ws, q({ sort: "revenue" }), viewer, 20);
    const values = page.rows.map((r) => r.revenueMinor);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const threshold = await highValueThreshold(db, ws);
    expect(threshold).toBeGreaterThan(0);
    const high = await listContactsPage(db, ws, q({ view: "high", highValueMinor: threshold }), viewer, 500);
    expect(high.rows.length).toBeGreaterThan(0);
    expect(high.rows.every((r) => r.revenueMinor >= threshold!)).toBe(true);
    const counts = await starterViewCounts(db, ws, threshold);
    expect(counts.all).toBe(counts.customers + counts.leads);
    expect(counts.high).toBe((await contactTotals(db, ws, q({ view: "high", highValueMinor: threshold }))).count);
  });

  it("filters by revenue range, tag and owner", async () => {
    const range = await listContactsPage(db, ws, q({ revMin: "100", revMax: "500", sort: "revenue" }), viewer, 500);
    expect(range.rows.every((r) => r.revenueMinor >= 10_000 && r.revenueMinor <= 50_000)).toBe(true);
    const [a, b] = await contactIds(ws.id, 2);
    await db.insert(schema.contactTags).values([
      { workspaceId: ws.id, contactId: a, tag: "vip" },
      { workspaceId: ws.id, contactId: b, tag: "vip" },
    ]);
    const tagged = await listContactsPage(db, ws, q({ tag: ["vip"] }), viewer);
    expect(tagged.rows.map((r) => r.id).sort()).toEqual([a, b].sort());
    expect(tagged.rows[0].tags).toEqual(["vip"]);
    const unowned = await contactTotals(db, ws, q({ owner: "none" }));
    expect(unowned.count).toBe((await contactTotals(db, ws, q())).count);
  });

  it("never returns another workspace's contacts", async () => {
    const page = await listContactsPage(db, ws, q({ q: "stranger" }), viewer);
    expect(page.rows).toEqual([]);
    const theirs = await listContactsPage(db, other, q(), viewer);
    expect(theirs.rows.map((r) => r.email)).toEqual(["stranger@other.test"]);
    const [foreign] = await contactIds(other.id, 1);
    expect(await contactRecord(db, ws, foreign, viewer, { withNotes: true })).toBeNull();
  });

  it("round-trips the table state through the URL", () => {
    const state = parseContactQuery({ platform: "meta,google", tag: "VIP ,  Wholesale", sort: "revenue", cols: "revenue,bogus,tags", revMin: "12.5", owner: "me", added: "30d" });
    expect(state.platform).toEqual(["meta", "google"]);
    expect(state.tag).toEqual(["vip", "wholesale"]);
    expect(state.cols).toEqual(["revenue", "tags"]);
    expect(parseContactQuery(contactQueryParams(state))).toEqual(state);
    expect(parseContactQuery({ revMin: "1e9", owner: "'; drop table", campaign: "x" })).toMatchObject({ revMin: null, owner: null, campaign: null });
  });
});

describe("contact record", () => {
  it("builds highlights from SQL and a unified timeline", async () => {
    const [top] = rows<{ contact_id: string; revenue_minor: string; orders: number }>(
      await db.execute(sql`select contact_id, revenue_minor, orders from contact_stats where workspace_id = ${ws.id} order by revenue_minor desc limit 1`),
    );
    const record = await contactRecord(db, ws, top.contact_id, viewer, { withNotes: true });
    expect(record).not.toBeNull();
    expect(record!.highlights.revenueMinor).toBe(Number(top.revenue_minor));
    expect(record!.highlights.orders).toBe(Number(top.orders));
    expect(record!.timeline.some((e) => e.kind === "payment")).toBe(true);
    const at = record!.timeline.map((e) => e.at);
    expect(at).toEqual([...at].sort().reverse());
    expect(record!.notes).toEqual([]);
  });
});

describe("CRM actions", () => {
  it("adds, edits and deletes notes with audit entries, never logging the body", async () => {
    const { addNoteAction, updateNoteAction, deleteNoteAction } = await import("@/app/actions/crm");
    const [contact] = await contactIds(ws.id, 1);
    const analyst = await member("analyst");
    session.token = analyst.token;
    const added = await addNoteAction(contact, "Wants annual billing. Call +1 312 847 1928.");
    expect(added.ok).toBe(true);
    const noteId = added.data!.id as string;
    expect((await updateNoteAction(noteId, "Wants annual billing.")).ok).toBe(true);

    // Another analyst can't edit someone else's note; an admin can.
    session.token = (await member("analyst")).token;
    expect((await updateNoteAction(noteId, "hijack")).ok).toBe(false);
    session.token = (await member("admin")).token;
    const removed = await deleteNoteAction(noteId);
    expect(removed.ok).toBe(true);
    expect(removed.data!.body).toBe("Wants annual billing.");

    const actions = await auditActions();
    expect(actions).toEqual(expect.arrayContaining(["contact.note_added", "contact.note_edited", "contact.note_deleted"]));
    const [leak] = rows<{ n: string }>(await db.execute(sql`select count(*) n from audit_log where meta::text like '%312%' or meta::text like '%annual%'`));
    expect(Number(leak.n)).toBe(0);
    session.token = undefined;
  });

  it("denies writes to viewers and clients", async () => {
    const { addNoteAction, addTagAction, createTaskAction, setOwnerAction } = await import("@/app/actions/crm");
    const [contact] = await contactIds(ws.id, 1);
    for (const role of ["viewer", "client"] as const) {
      session.token = (await member(role)).token;
      expect((await addNoteAction(contact, "hello")).ok).toBe(false);
      expect((await addTagAction([contact], "x")).ok).toBe(false);
      expect((await createTaskAction({ title: "Call back" })).ok).toBe(false);
      expect((await setOwnerAction([contact], null)).ok).toBe(false);
    }
    expect(roleCan("viewer", "contacts.notes")).toBe(true);
    expect(roleCan("client", "contacts.notes")).toBe(false);
    session.token = undefined;
  });

  it("creates tasks, counts overdue ones and completes them", async () => {
    const { createTaskAction, setTaskDoneAction, deleteTaskAction } = await import("@/app/actions/crm");
    const [contact] = await contactIds(ws.id, 1);
    const me = await member("analyst");
    session.token = me.token;
    const overdue = await createTaskAction({ title: "Send proposal", dueAt: new Date(Date.now() - 86_400_000).toISOString(), contactId: contact });
    const later = await createTaskAction({ title: "Check in", dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() });
    expect(overdue.ok && later.ok).toBe(true);
    expect(await overdueTaskCount(db, ws, me.id)).toBe(1);
    const mine = await myTasks(db, ws, me.id, viewer);
    expect(mine.map((t) => t.title)).toEqual(["Send proposal", "Check in"]);
    expect(mine[0].contact?.id).toBe(contact);

    expect((await setTaskDoneAction(overdue.data!.id as string, true)).ok).toBe(true);
    expect(await overdueTaskCount(db, ws, me.id)).toBe(0);
    expect((await deleteTaskAction(later.data!.id as string)).ok).toBe(true);
    expect(await auditActions()).toEqual(expect.arrayContaining(["task.created", "task.completed", "task.deleted"]));

    // A task can't point at another workspace's contact.
    const [foreign] = await contactIds(other.id, 1);
    expect((await createTaskAction({ title: "Nope", contactId: foreign })).ok).toBe(false);
    session.token = undefined;
  });

  it("tags and assigns owners in bulk with undo, scoped to the workspace", async () => {
    const { addTagAction, removeTagAction, setOwnerAction, restoreOwnersAction } = await import("@/app/actions/crm");
    const ids = await contactIds(ws.id, 3);
    const [foreign] = await contactIds(other.id, 1);
    const admin = await member("admin");
    session.token = admin.token;

    const tagged = await addTagAction([...ids, foreign], "  Wholesale  ");
    expect(tagged.ok).toBe(true);
    expect(tagged.data!.tag).toBe("wholesale");
    expect((tagged.data!.added as string[]).sort()).toEqual([...ids].sort());
    const [foreignTags] = rows<{ n: string }>(await db.execute(sql`select count(*) n from contact_tags where contact_id = ${foreign}`));
    expect(Number(foreignTags.n)).toBe(0);
    expect((await addTagAction(ids, "<script>")).ok).toBe(false);

    const assigned = await setOwnerAction(ids, admin.id);
    expect(assigned.ok).toBe(true);
    expect((await contactTotals(db, ws, q({ owner: admin.id }))).count).toBe(3);
    expect((await restoreOwnersAction(assigned.data!.previous as { id: string; ownerUserId: string | null }[])).ok).toBe(true);
    expect((await contactTotals(db, ws, q({ owner: admin.id }))).count).toBe(0);

    // A viewer can't be made owner (they can't edit contacts).
    const viewerUser = await member("viewer");
    expect((await setOwnerAction(ids, viewerUser.id)).ok).toBe(false);
    expect((await removeTagAction(ids, "wholesale")).ok).toBe(true);
    session.token = undefined;
  });

  it("keeps saved views personal", async () => {
    const { saveViewAction, deleteViewAction, updateViewAction } = await import("@/app/actions/crm");
    const alice = await member("analyst");
    session.token = alice.token;
    const saved = await saveViewAction("Meta buyers", { platform: "meta", lc: "customer", evil: "x" });
    expect(saved.ok).toBe(true);
    const [view] = await db.select().from(schema.contactViews).where(eq(schema.contactViews.id, saved.data!.id as string));
    expect(view.filters).toEqual({ platform: "meta", lc: "customer" });
    session.token = (await member("analyst")).token;
    expect((await updateViewAction(view.id, { name: "Mine now" })).ok).toBe(false);
    expect((await deleteViewAction(view.id)).ok).toBe(false);
    session.token = alice.token;
    expect((await deleteViewAction(view.id)).ok).toBe(true);
    session.token = undefined;
  });

  it("exports selected contacts only with the export permission, never with notes", async () => {
    const { exportContactsAction } = await import("@/app/actions/crm");
    const ids = await contactIds(ws.id, 2);
    session.token = (await member("viewer")).token;
    expect((await exportContactsAction(ids)).ok).toBe(false);
    session.token = (await member("analyst")).token;
    const res = await exportContactsAction(ids);
    expect(res.ok).toBe(true);
    const csv = res.data!.csv as string;
    expect(csv.trim().split("\r\n")).toHaveLength(3);
    expect(csv).not.toMatch(/note/i);
    session.token = undefined;
  });

  it("deletes contacts with their notes and tasks", async () => {
    const { addNoteAction, createTaskAction, deleteContactsAction } = await import("@/app/actions/crm");
    const [contact] = rows<{ id: string }>(await db.execute(sql`select id from contacts where workspace_id = ${ws.id} order by first_seen_at desc limit 1`));
    session.token = (await member("admin")).token;
    await addNoteAction(contact.id, "Private");
    await createTaskAction({ title: "Follow up", contactId: contact.id });
    session.token = (await member("analyst")).token;
    expect((await deleteContactsAction([contact.id])).ok).toBe(false);
    session.token = (await member("owner")).token;
    expect((await deleteContactsAction([contact.id])).ok).toBe(true);
    const [left] = rows<Record<string, string>>(
      await db.execute(sql`select (select count(*) from contact_notes where contact_id = ${contact.id}) notes,
        (select count(*) from tasks where contact_id = ${contact.id}) tasks,
        (select count(*) from contact_stats where contact_id = ${contact.id}) stats`),
    );
    expect([left.notes, left.tasks, left.stats].map(Number)).toEqual([0, 0, 0]);
    const [c] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.id, contact.id)));
    expect(c).toBeUndefined();
    session.token = undefined;
  });
});

describe("scale", () => {
  it("sorts and filters 10k contacts in under 500ms", async () => {
    const [big] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Big", slug: `big-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
    await db.execute(sql`
      insert into contacts (workspace_id, email, name, first_seen_at, lifecycle)
      select ${big.id}, 'person' || g || '@big.test', 'Person ' || g, now() - (g || ' minutes')::interval,
        case when g % 7 = 0 then 'customer' else 'lead' end
      from generate_series(1, 10000) g`);
    await db.execute(sql`
      insert into contact_stats (contact_id, workspace_id, revenue_minor, orders, touches, first_touch_platform, last_activity_at, engagement)
      select c.id, c.workspace_id, case when c.lifecycle = 'customer' then (abs(hashtext(c.email)) % 100000) else 0 end,
        case when c.lifecycle = 'customer' then 1 else 0 end, abs(hashtext(c.name)) % 9,
        (array['meta', 'google', 'tiktok', null])[1 + abs(hashtext(c.email)) % 4], c.first_seen_at, abs(hashtext(c.email)) % 100
      from contacts c where c.workspace_id = ${big.id}`);
    await db.execute(sql`analyze contacts`);
    await db.execute(sql`analyze contact_stats`);
    // Warm up once (query planning, caches), then time the real thing.
    await listContactsPage(db, big, q({ sort: "revenue", platform: ["meta"] }), viewer);
    const started = performance.now();
    const [page, totals] = await Promise.all([
      listContactsPage(db, big, q({ sort: "revenue", platform: ["meta"] }), viewer),
      contactTotals(db, big, q({ platform: ["meta"] })),
    ]);
    const elapsed = performance.now() - started;
    expect(page.rows).toHaveLength(50);
    expect(totals.count).toBeGreaterThan(2000);
    expect(page.rows[0].revenueMinor).toBeGreaterThanOrEqual(page.rows[49].revenueMinor);
    expect(elapsed).toBeLessThan(500);
  });
});
