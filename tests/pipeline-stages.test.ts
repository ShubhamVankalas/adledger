import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ingestRevenue } from "@/lib/connectors/revenue/ingest";
import { sha256 } from "@/lib/crypto";
import { rows, schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import {
  addStage,
  contactStage,
  defaultStage,
  deleteStage,
  listStages,
  moveContacts,
  PipelineError,
  saveStages,
  stageHistory,
  storedStages,
  undoMove,
  type Stage,
} from "@/lib/pipeline";
import { costPerStage, pipelineBoard, pipelineCards, pipelineSummary, stageFunnel } from "@/lib/reports-pipeline";
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
const DAY = 86_400_000;
const NOW = Date.now();
const ids: Record<string, string> = {};

async function contact(w: Workspace, key: string, daysAgo: number) {
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: w.id, email: `${key}@pipeline.test`, emailHash: sha256(`${key}@pipeline.test`), name: key.toUpperCase(), firstSeenAt: new Date(NOW - daysAgo * DAY) })
    .returning();
  ids[key] = c.id;
  return c.id;
}

async function stageOf(contactId: string) {
  const [c] = await db.select({ stageId: schema.contacts.stageId }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
  return c?.stageId ?? null;
}

const byName = (stages: Stage[], name: string) => {
  const s = stages.find((x) => x.name === name);
  if (!s) throw new Error(`no stage ${name}`);
  return s;
};

async function member(role: "owner" | "admin" | "analyst" | "viewer", workspace = ws) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" })
    .returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: workspace.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + DAY) });
  return { token, userId: user.id };
}

const pay = (email: string, externalId: string, amountMinor: number, at = new Date(NOW - DAY), type: "payment" | "refund" = "payment") =>
  ingestRevenue(db, ws.id, "manual", [{ type, externalId, amountMinor, currency: "USD", occurredAt: at, customer: { email } }]);

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws, org } = await setupWorkspace());
  orgId = org.id;
  [other] = await db.insert(schema.workspaces).values({ organizationId: org.id, name: "Other", slug: `other-${Math.random().toString(36).slice(2, 8)}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
  for (const [k, d] of [["ann", 20], ["bob", 12], ["cat", 9], ["dan", 3]] as const) await contact(ws, k, d);
  await contact(other, "eve", 5);
});

describe("stages", () => {
  it("creates the six default stages once, lazily and race-safe", async () => {
    expect(await storedStages(db, ws.id)).toHaveLength(0);
    const [a, b] = await Promise.all([listStages(db, ws.id), listStages(db, ws.id)]);
    expect(a.map((s) => s.name)).toEqual(["New lead", "Qualified", "Call booked", "Proposal", "Won", "Lost"]);
    expect(b.map((s) => s.id)).toEqual(a.map((s) => s.id));
    expect(a.map((s) => s.kind)).toEqual(["open", "open", "open", "open", "won", "lost"]);
    expect(defaultStage(a).name).toBe("New lead");
    expect((await storedStages(db, ws.id)).length).toBe(6);
  });

  it("the migration backfills stages for existing workspaces and places customers in Won", async () => {
    const migration = await import("node:fs").then((fs) => fs.readFileSync("drizzle/0007_pipeline.sql", "utf8"));
    expect(migration).toMatch(/INSERT INTO "pipeline_stages"[\s\S]+FROM "workspaces" w/);
    expect(migration).toMatch(/UPDATE "contacts" c[\s\S]+lifecycle" = 'customer' THEN 4 ELSE 0/);
  });
});

describe("moving contacts", () => {
  it("moves, skips contacts already there and writes history", async () => {
    const stages = await listStages(db, ws.id);
    const q = byName(stages, "Qualified");
    const r = await moveContacts(db, { workspaceId: ws.id, contactIds: [ids.ann, ids.bob], stageId: q.id, userId: null });
    expect(r.moved).toHaveLength(2);
    expect(r.moved[0].fromStageId).toBe(byName(stages, "New lead").id);
    expect(await stageOf(ids.ann)).toBe(q.id);
    const again = await moveContacts(db, { workspaceId: ws.id, contactIds: [ids.ann], stageId: q.id, userId: null });
    expect(again.moved).toHaveLength(0);
    const h = await stageHistory(db, ws.id, ids.ann);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ fromName: "New lead", toName: "Qualified", source: "manual" });
  });

  it("reads one contact's stage for the record page, never across workspaces", async () => {
    const stages = await listStages(db, ws.id);
    expect(await contactStage(db, ws.id, ids.ann)).toMatchObject({ stageId: byName(stages, "Qualified").id });
    expect((await contactStage(db, ws.id, ids.dan))?.stageId).toBe(byName(stages, "New lead").id); // never moved
    expect(await contactStage(db, ws.id, ids.eve)).toBeNull();
  });

  it("never touches another workspace's contacts or stages", async () => {
    const stages = await listStages(db, ws.id);
    const cb = byName(stages, "Call booked");
    const r = await moveContacts(db, { workspaceId: ws.id, contactIds: [ids.ann, ids.eve], stageId: cb.id, userId: null });
    expect(r.moved.map((m) => m.contactId)).toEqual([ids.ann]);
    expect(await stageOf(ids.eve)).toBeNull();
    const otherStages = await listStages(db, other.id);
    await expect(moveContacts(db, { workspaceId: ws.id, contactIds: [ids.cat], stageId: otherStages[1].id, userId: null })).rejects.toThrow(PipelineError);
    // Moving eve inside her own workspace with ws's stage id is refused too.
    await expect(moveContacts(db, { workspaceId: other.id, contactIds: [ids.eve], stageId: cb.id, userId: null })).rejects.toThrow(PipelineError);
  });

  it("undo restores the stage and its age, and removes the history row", async () => {
    const stages = await listStages(db, ws.id);
    const p = byName(stages, "Proposal");
    const { userId } = await member("analyst");
    const r = await moveContacts(db, { workspaceId: ws.id, contactIds: [ids.cat], stageId: p.id, userId });
    // Another user (or someone else's event ids) can't undo it.
    expect(await undoMove(db, { workspaceId: ws.id, toStageId: p.id, userId: null, entries: r.moved })).toBe(0);
    expect(await undoMove(db, { workspaceId: other.id, toStageId: p.id, userId, entries: r.moved })).toBe(0);
    expect(await undoMove(db, { workspaceId: ws.id, toStageId: p.id, userId, entries: r.moved, now: new Date(Date.now() + 11 * 60_000) })).toBe(0);
    expect(await undoMove(db, { workspaceId: ws.id, toStageId: p.id, userId, entries: r.moved })).toBe(1);
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, ids.cat));
    expect(c.stageId).toBe(byName(stages, "New lead").id);
    expect(c.stageChangedAt).toBeNull();
    expect(await stageHistory(db, ws.id, ids.cat)).toHaveLength(0);
  });
});

describe("payments", () => {
  it("a new payment moves the contact to Won; replays and refunds do not", async () => {
    const stages = await listStages(db, ws.id);
    const won = byName(stages, "Won");
    const lost = byName(stages, "Lost");
    await pay("bob@pipeline.test", "ord-bob-1", 12_000);
    expect(await stageOf(ids.bob)).toBe(won.id);
    const h = await stageHistory(db, ws.id, ids.bob);
    expect(h[0]).toMatchObject({ fromName: "Qualified", toName: "Won", source: "payment" });

    await moveContacts(db, { workspaceId: ws.id, contactIds: [ids.bob], stageId: lost.id, userId: null });
    await pay("bob@pipeline.test", "ord-bob-1", 12_000); // replayed webhook
    await pay("bob@pipeline.test", "ref-bob-1", 2_000, new Date(), "refund");
    expect(await stageOf(ids.bob)).toBe(lost.id);
    await pay("bob@pipeline.test", "ord-bob-2", 3_000, new Date());
    expect(await stageOf(ids.bob)).toBe(won.id);
    expect((await stageHistory(db, ws.id, ids.bob)).filter((e) => e.source === "payment")).toHaveLength(2);
  });
});

describe("configuring stages", () => {
  it("renames, reorders and swaps names in one save", async () => {
    const stages = await listStages(db, ws.id);
    const input = stages.map((s) => ({ id: s.id, name: s.name, kind: s.kind, color: s.color, rotDays: s.rotDays, probability: s.probability }));
    // Swap the names of Qualified and Proposal, rename Call booked, move Proposal up.
    input[1].name = "Proposal";
    input[3].name = "Qualified";
    input[2].name = "Demo booked";
    const reordered = [input[0], input[3], input[1], input[2], input[4], input[5]];
    const saved = await saveStages(db, ws.id, reordered);
    expect(saved.map((s) => s.name)).toEqual(["New lead", "Qualified", "Proposal", "Demo booked", "Won", "Lost"]);
    expect(saved.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    // Won is always 100 %, lost 0 %, and neither rots.
    const bad = saved.map((s) => ({ ...s, probability: 42, rotDays: s.kind === "open" ? s.rotDays : 3 }));
    const norm = await saveStages(db, ws.id, bad);
    expect(norm.find((s) => s.kind === "won")).toMatchObject({ probability: 100, rotDays: null });
    expect(norm.find((s) => s.kind === "lost")).toMatchObject({ probability: 0, rotDays: null });
    await saveStages(db, ws.id, stages.map((s) => ({ ...s }))); // restore the defaults
  });

  it("refuses duplicates, a pipeline without won/open stages and stale stage lists", async () => {
    const stages = await listStages(db, ws.id);
    const input = stages.map((s) => ({ ...s }));
    await expect(saveStages(db, ws.id, input.map((s, i) => ({ ...s, name: i === 1 ? "new LEAD " : s.name })))).rejects.toThrow(/unique/);
    await expect(saveStages(db, ws.id, input.map((s) => ({ ...s, kind: s.kind === "won" ? ("open" as const) : s.kind })))).rejects.toThrow(/won stage/);
    await expect(saveStages(db, ws.id, input.map((s) => ({ ...s, kind: s.kind === "open" ? ("lost" as const) : s.kind })))).rejects.toThrow(/open stage/);
    await expect(saveStages(db, ws.id, input.slice(1))).rejects.toThrow(/another tab/);
    await expect(saveStages(db, ws.id, input.map((s) => ({ ...s, name: "  " })))).rejects.toThrow();
  });

  it("adds open stages before Won and deletes with reassignment", async () => {
    const added = await addStage(db, ws.id, { name: "Negotiation", kind: "open", color: "cyan", rotDays: 14, probability: 80 });
    let stages = await listStages(db, ws.id);
    expect(stages.map((s) => s.name)).toEqual(["New lead", "Qualified", "Call booked", "Proposal", "Negotiation", "Won", "Lost"]);
    await expect(addStage(db, ws.id, { name: "negotiation", kind: "open", color: "cyan", rotDays: null, probability: 5 })).rejects.toThrow(/unique/);

    await moveContacts(db, { workspaceId: ws.id, contactIds: [ids.dan], stageId: added.id, userId: null });
    await expect(deleteStage(db, { workspaceId: ws.id, stageId: added.id, reassignTo: null, userId: null })).rejects.toThrow(/Choose where the 1 contact/);
    const proposal = byName(stages, "Proposal");
    const r = await deleteStage(db, { workspaceId: ws.id, stageId: added.id, reassignTo: proposal.id, userId: null });
    expect(r.moved).toBe(1);
    expect(await stageOf(ids.dan)).toBe(proposal.id);
    expect((await stageHistory(db, ws.id, ids.dan))[0]).toMatchObject({ fromName: "Negotiation", toName: "Proposal", source: "system" });
    stages = await listStages(db, ws.id);
    expect(stages.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    await expect(deleteStage(db, { workspaceId: ws.id, stageId: byName(stages, "Won").id, reassignTo: proposal.id, userId: null })).rejects.toThrow(/won stage/);
  });

  it("deleting the default stage also reassigns contacts that never moved", async () => {
    const w = (await setupWorkspace()).ws;
    const a = await contact(w, "fay", 2);
    const stages = await listStages(db, w.id);
    const q = byName(stages, "Qualified");
    const r = await deleteStage(db, { workspaceId: w.id, stageId: byName(stages, "New lead").id, reassignTo: q.id, userId: null });
    expect(r.moved).toBe(1);
    expect(await stageOf(a)).toBe(q.id);
  });
});

describe("board numbers", () => {
  it("column counts, values, weighted value and rotting match hand-computed totals", async () => {
    const stages = await listStages(db, ws.id);
    // ann: Call booked, entered 30 days ago (rot 5 days) → rotting. cat: New lead (never moved), 9 days old (rot 7) → rotting.
    await db.update(schema.contacts).set({ stageChangedAt: new Date(NOW - 30 * DAY) }).where(eq(schema.contacts.id, ids.ann));
    const board = await pipelineBoard(db, ws);
    const col = (name: string) => board.columns.find((c) => c.name === name)!;
    expect(board.columns.map((c) => c.name)).toEqual(stages.map((s) => s.name));
    expect(board.columns.reduce((s, c) => s + c.count, 0)).toBe(4);
    expect(col("New lead")).toMatchObject({ count: 1, rotting: 1 });
    expect(col("Call booked")).toMatchObject({ count: 1, rotting: 1 });
    expect(col("Proposal")).toMatchObject({ count: 1, rotting: 0 });
    // bob paid 120 + 30, refunded 20 → 130 net; the only paying contact, so avg value = 130.
    expect(board.avgValueMinor).toBe(13_000);
    expect(col("Won")).toMatchObject({ count: 1, valueMinor: 13_000, weightedMinor: 13_000 });
    // Open contacts without revenue count at the average value × win probability.
    expect(col("New lead").weightedMinor).toBe(1_300);
    expect(col("Call booked").weightedMinor).toBe(6_500);
    expect(col("Proposal").weightedMinor).toBe(9_100);
    const ann = col("Call booked").cards[0];
    expect(ann).toMatchObject({ id: ids.ann, label: "ANN", daysInStage: 30, rotting: true, valueMinor: 0 });
    const s = pipelineSummary(board);
    expect(s).toMatchObject({ open: 3, openWeightedMinor: 16_900, won: 1, wonValueMinor: 13_000, lost: 0, rotting: 2 });
  });

  it("never shows another workspace's contacts, and pages cards per stage", async () => {
    const b = await pipelineBoard(db, other);
    expect(b.columns.reduce((s, c) => s + c.count, 0)).toBe(1);
    expect(b.columns.flatMap((c) => c.cards).map((c) => c.id)).toEqual([ids.eve]);
    const stages = await listStages(db, ws.id);
    const page = await pipelineCards(db, ws, stages, { stageId: byName(stages, "New lead").id, offset: 0, limit: 1 });
    expect(page.map((c) => c.id)).toEqual([ids.cat]);
    expect(await pipelineCards(db, ws, stages, { stageId: byName(stages, "New lead").id, offset: 1 })).toEqual([]);
  });
});

describe("server actions", () => {
  it("need pipeline.move to move and workspace.settings to configure, and are audited", async () => {
    const { moveContactsAction, undoMoveAction, saveStagesAction, loadStageCardsAction } = await import("@/app/actions/pipeline");
    const stages = await listStages(db, ws.id);
    const q = byName(stages, "Qualified");

    session.token = (await member("viewer")).token;
    const denied = await moveContactsAction([ids.cat], q.id);
    expect(denied.ok).toBe(false);
    expect(denied.message).toMatch(/permission/);
    expect(await stageOf(ids.cat)).not.toBe(q.id);
    expect((await loadStageCardsAction(q.id, 0)).ok).toBe(true);

    session.token = (await member("analyst")).token;
    expect((await moveContactsAction([ids.eve], q.id)).data?.moved).toEqual([]); // other workspace: ignored
    const moved = await moveContactsAction([ids.cat], q.id);
    expect(moved.ok).toBe(true);
    expect(await stageOf(ids.cat)).toBe(q.id);
    const [log] = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.workspaceId, ws.id), eq(schema.auditLog.action, "pipeline.contacts_moved")));
    expect(log.meta).toMatchObject({ stageId: q.id, count: 1 });
    expect(JSON.stringify(log)).not.toContain("@pipeline.test");
    const undone = await undoMoveAction(q.id, moved.data!.moved as unknown[]);
    expect(undone.ok).toBe(true);
    expect(await stageOf(ids.cat)).not.toBe(q.id);
    expect((await moveContactsAction(["not-a-uuid"], q.id)).ok).toBe(false);
    const noSettings = await saveStagesAction(stages);
    expect(noSettings.message).toMatch(/permission/);

    session.token = (await member("admin")).token;
    const renamed = await saveStagesAction(stages.map((s) => ({ ...s, name: s.name === "Proposal" ? "Proposal sent" : s.name })));
    expect(renamed.ok).toBe(true);
    const invalid = await saveStagesAction(stages.map((s) => ({ ...s, rotDays: 0 })));
    expect(invalid).toMatchObject({ ok: false, message: "Rotting starts after at least 1 day." });
    expect(await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "pipeline.stages_saved"))).toHaveLength(1);
    await saveStagesAction(stages);
    session.token = undefined;
  });
});

describe("demo data", () => {
  let demo: Workspace;
  let stages: Stage[];
  beforeAll(async () => {
    demo = (await setupWorkspace()).ws;
    await seedDemo(db, demo.id, { anchor: "2026-09-01" });
    stages = await listStages(db, demo.id);
  });

  it("places every customer in Won and spreads the leads over the board", async () => {
    const [x] = rows<{ bad: string; lost: string }>(
      await db.execute(sql`select count(*) filter (where c.lifecycle = 'customer' and s.kind <> 'won') bad,
        count(*) filter (where s.kind = 'lost') lost
        from contacts c join pipeline_stages s on s.id = c.stage_id where c.workspace_id = ${demo.id}`),
    );
    expect(Number(x.bad)).toBe(0);
    expect(Number(x.lost)).toBeGreaterThan(20);
    const board = await pipelineBoard(db, demo);
    for (const c of board.columns) expect(c.count, c.name).toBeGreaterThan(0);
    expect(board.columns.reduce((s, c) => s + c.rotting, 0)).toBeGreaterThan(0);
  });

  it("board totals equal plain SQL over contacts and revenue", async () => {
    const board = await pipelineBoard(db, demo);
    const def = defaultStage(stages);
    const expected = rows<{ stage_id: string; n: string; value: string }>(
      await db.execute(sql`select coalesce(c.stage_id, ${def.id}::uuid) stage_id, count(*) n,
          coalesce(sum((select sum(amount_minor) from revenue_events r where r.contact_id = c.id and r.currency = ${demo.reportingCurrency})), 0) value
        from contacts c where c.workspace_id = ${demo.id} group by 1`),
    );
    for (const e of expected) {
      const col = board.columns.find((c) => c.id === e.stage_id)!;
      expect(col.count, col.name).toBe(Number(e.n));
      expect(col.valueMinor, col.name).toBe(Number(e.value));
    }
    for (const c of board.columns) expect(c.cards.length).toBe(Math.min(c.count, 50));
  });

  it("the funnel only narrows, and matches an independent count", async () => {
    const f = await stageFunnel(db, demo, { start: "2026-06-04", end: "2026-09-01" });
    const flow = f.steps.filter((s) => s.kind !== "lost");
    expect(flow[0].reached).toBe(f.total);
    for (let i = 1; i < flow.length; i++) expect(flow[i].reached).toBeLessThanOrEqual(flow[i - 1].reached);
    const q = byName(stages, "Qualified");
    const [x] = rows<{ n: string }>(
      await db.execute(sql`select count(*) n from contacts c
        where c.workspace_id = ${demo.id} and c.first_seen_at >= '2026-06-04T00:00:00Z' and c.first_seen_at < '2026-09-02T00:00:00Z'
          and (exists (select 1 from contact_stage_events e join pipeline_stages s on s.id = e.to_stage_id
                       where e.contact_id = c.id and s.kind <> 'lost' and s.position >= ${q.position})
               or exists (select 1 from pipeline_stages s where s.id = c.stage_id and s.kind <> 'lost' and s.position >= ${q.position}))`),
    );
    expect(f.steps.find((s) => s.stageId === q.id)!.reached).toBe(Number(x.n));
    const won = f.steps.find((s) => s.kind === "won")!;
    expect(won.costMinor).toBe(Math.round(f.spendMinor / won.paidReached));
    expect(f.steps.find((s) => s.kind === "lost")!.conversion).toBeNull();
  });

  it("cost per stage per campaign = campaign spend ÷ its first-touch contacts reaching the stage", async () => {
    const p = { start: "2026-06-04", end: "2026-09-01" };
    const r = await costPerStage(db, demo, p);
    expect(r.stages.every((s) => s.kind !== "lost")).toBe(true);
    const top = r.rows[0];
    const [spend] = rows<{ s: string }>(
      await db.execute(sql`select sum(spend_minor) s from ad_insights_daily where workspace_id = ${demo.id} and campaign_id = ${top.id} and date between '2026-06-04' and '2026-09-01'`),
    );
    expect(top.spendMinor).toBe(Number(spend.s));
    const [firstTouch] = rows<{ n: string }>(
      await db.execute(sql`select count(*) n from contacts c
        join lateral (select t.campaign_id from touchpoints t join visitors v on v.id = t.visitor_id where v.contact_id = c.id order by t.occurred_at, t.id limit 1) ft on true
        where c.workspace_id = ${demo.id} and ft.campaign_id = ${top.id} and c.first_seen_at >= '2026-06-04T00:00:00Z' and c.first_seen_at < '2026-09-02T00:00:00Z'`),
    );
    expect(top.stages[0].reached).toBe(Number(firstTouch.n));
    for (const s of top.stages) expect(s.costMinor).toBe(s.reached > 0 ? Math.round(top.spendMinor / s.reached) : null);
    // Sorted by spend, and each stage count only narrows.
    for (let i = 1; i < r.rows.length; i++) expect(r.rows[i].spendMinor).toBeLessThanOrEqual(r.rows[i - 1].spendMinor);
    for (const row of r.rows) for (let i = 1; i < row.stages.length; i++) expect(row.stages[i].reached).toBeLessThanOrEqual(row.stages[i - 1].reached);
    const meta = await costPerStage(db, demo, { ...p, platform: "meta", level: "ad" });
    expect(meta.rows.length).toBeGreaterThan(0);
    expect(meta.rows.every((x) => x.platform === "meta")).toBe(true);
  });
});

describe("scale", () => {
  it("builds the board and the funnel for 10,000 contacts quickly", async () => {
    const w = (await setupWorkspace()).ws;
    await db.execute(sql`insert into contacts (workspace_id, email, email_hash, name, first_seen_at)
      select ${w.id}, 'p' || g || '@scale.test', md5('p' || g), 'Person ' || g, now() - (g % 90) * interval '1 day'
      from generate_series(1, 10000) g`);
    await listStages(db, w.id);
    await db.execute(sql`update contacts c set stage_id = s.id, stage_changed_at = c.first_seen_at + interval '1 day'
      from pipeline_stages s where s.workspace_id = ${w.id} and c.workspace_id = ${w.id} and s.position = abs(hashtext(c.id::text)) % 6`);
    await pipelineBoard(db, w); // warm up
    let t = performance.now();
    const board = await pipelineBoard(db, w);
    const boardMs = performance.now() - t;
    expect(board.columns.reduce((s, c) => s + c.count, 0)).toBe(10_000);
    t = performance.now();
    await stageFunnel(db, w, {});
    const funnelMs = performance.now() - t;
    // Generous bounds: embedded Postgres on a busy CI machine.
    expect(boardMs).toBeLessThan(2_500);
    expect(funnelMs).toBeLessThan(2_500);
  });
});
