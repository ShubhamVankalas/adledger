import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { rows, schema, type DB } from "./db";
import type { StageEventSource } from "./db/schema";
import { DEFAULT_STAGES, MAX_MOVE, MAX_STAGES, STAGE_COLORS, stageInput, UNDO_WINDOW_MS, type MovedContact, type Stage, type StageColor, type StageInput } from "./pipeline-shared";

export * from "./pipeline-shared";

// Pipeline stages: workspace-configurable CRM stages that replace the binary lead/customer
// lifecycle (which stays as the payment-derived value). Every stage change writes a
// contact_stage_events row. Reporting numbers live in reports-pipeline.ts.
//
// A contact whose stage_id is null sits in the workspace's first open stage, so contacts
// created by any ingest path (pixel, webhooks, CSV, revenue) need no extra write.

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

/** A user-facing validation error (safe to show as-is). */
export class PipelineError extends Error {}

const asColor = (c: string): StageColor => ((STAGE_COLORS as readonly string[]).includes(c) ? (c as StageColor) : "slate");

function toStage(r: typeof schema.pipelineStages.$inferSelect): Stage {
  return { id: r.id, name: r.name, position: r.position, kind: r.kind, color: asColor(r.color), rotDays: r.rotDays, probability: r.probability };
}

async function selectStages(q: Q, workspaceId: string) {
  const r = await q
    .select()
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.workspaceId, workspaceId))
    .orderBy(asc(schema.pipelineStages.position), asc(schema.pipelineStages.createdAt));
  return r.map(toStage);
}

/** The workspace's stages as stored, without creating defaults (for read-only callers such as MCP). */
export const storedStages = (q: Q, workspaceId: string) => selectStages(q, workspaceId);

/** The workspace's stages in board order, creating the defaults on first use (idempotent, race-safe). */
export async function listStages(q: Q, workspaceId: string): Promise<Stage[]> {
  const existing = await selectStages(q, workspaceId);
  if (existing.length) return existing;
  await q
    .insert(schema.pipelineStages)
    .values(DEFAULT_STAGES.map((s, position) => ({ ...s, position, workspaceId })))
    .onConflictDoNothing();
  return selectStages(q, workspaceId);
}

/** Where contacts without an explicit stage sit: the first open stage (or the first stage). */
export function defaultStage(stages: Stage[]): Stage {
  const s = stages.find((x) => x.kind === "open") ?? stages[0];
  if (!s) throw new PipelineError("This workspace has no pipeline stages.");
  return s;
}

export const wonStage = (stages: Stage[]) => stages.find((s) => s.kind === "won") ?? null;

/** Every pipeline needs somewhere for new leads and somewhere for paying customers. */
export function checkStageSet(stages: Pick<Stage, "kind">[]) {
  if (!stages.some((s) => s.kind === "open")) throw new PipelineError("Keep at least one open stage for new leads.");
  if (!stages.some((s) => s.kind === "won")) throw new PipelineError("Keep at least one won stage: payments move contacts there.");
}

// ---------------------------------------------------------------- moving contacts

export type MoveResult = { stage: Stage; moved: MovedContact[] };

/**
 * Move contacts (of this workspace only) to a stage. Contacts already there are skipped.
 * Writes one contact_stage_events row per moved contact.
 */
export async function moveContacts(
  db: DB,
  args: { workspaceId: string; contactIds: string[]; stageId: string; userId: string | null; source?: StageEventSource; at?: Date },
): Promise<MoveResult> {
  const ids = [...new Set(args.contactIds)];
  if (ids.length === 0) throw new PipelineError("Choose at least one contact.");
  if (ids.length > MAX_MOVE) throw new PipelineError(`Move at most ${MAX_MOVE} contacts at a time.`);
  const at = args.at ?? new Date();
  return db.transaction(async (tx) => {
    const stages = await listStages(tx, args.workspaceId);
    const target = stages.find((s) => s.id === args.stageId);
    if (!target) throw new PipelineError("That stage no longer exists. Reload the page.");
    const def = defaultStage(stages);
    const nameOf = new Map(stages.map((s) => [s.id, s.name]));
    const current = await tx
      .select({ id: schema.contacts.id, stageId: schema.contacts.stageId, stageChangedAt: schema.contacts.stageChangedAt })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, args.workspaceId), inArray(schema.contacts.id, ids)));
    const moving = current.filter((c) => (c.stageId ?? def.id) !== target.id);
    if (moving.length === 0) return { stage: target, moved: [] };
    await tx
      .update(schema.contacts)
      .set({ stageId: target.id, stageChangedAt: at })
      .where(and(eq(schema.contacts.workspaceId, args.workspaceId), inArray(schema.contacts.id, moving.map((c) => c.id))));
    const events = await tx
      .insert(schema.contactStageEvents)
      .values(
        moving.map((c) => {
          const from = c.stageId ?? def.id;
          return {
            workspaceId: args.workspaceId,
            contactId: c.id,
            fromStageId: from,
            toStageId: target.id,
            fromName: nameOf.get(from) ?? null,
            toName: target.name,
            source: args.source ?? "manual",
            userId: args.userId,
            occurredAt: at,
          };
        }),
      )
      .returning({ id: schema.contactStageEvents.id, contactId: schema.contactStageEvents.contactId });
    const eventOf = new Map(events.map((e) => [e.contactId, e.id]));
    return {
      stage: target,
      moved: moving.map((c) => ({
        contactId: c.id,
        fromStageId: c.stageId ?? def.id,
        fromChangedAt: c.stageChangedAt?.toISOString() ?? null,
        eventId: eventOf.get(c.id)!,
      })),
    };
  });
}

/**
 * Undo a move: put each contact back where it was (with its old "days in stage") and drop the
 * history row the move wrote, so an accidental drop does not count as reaching a stage.
 * Only contacts still in `toStageId`, and only recent manual events by the same user, are touched.
 */
export async function undoMove(
  db: DB,
  args: { workspaceId: string; toStageId: string; userId: string | null; entries: MovedContact[]; now?: Date },
): Promise<number> {
  if (args.entries.length === 0) return 0;
  if (args.entries.length > MAX_MOVE) throw new PipelineError(`Undo at most ${MAX_MOVE} contacts at a time.`);
  const since = new Date((args.now ?? new Date()).getTime() - UNDO_WINDOW_MS);
  return db.transaction(async (tx) => {
    const stages = await listStages(tx, args.workspaceId);
    const valid = new Set(stages.map((s) => s.id));
    const def = defaultStage(stages);
    const events = await tx
      .select({ id: schema.contactStageEvents.id, contactId: schema.contactStageEvents.contactId })
      .from(schema.contactStageEvents)
      .where(
        and(
          eq(schema.contactStageEvents.workspaceId, args.workspaceId),
          eq(schema.contactStageEvents.toStageId, args.toStageId),
          eq(schema.contactStageEvents.source, "manual"),
          args.userId ? eq(schema.contactStageEvents.userId, args.userId) : sql`${schema.contactStageEvents.userId} is null`,
          gt(schema.contactStageEvents.createdAt, since),
          inArray(schema.contactStageEvents.id, args.entries.map((e) => e.eventId)),
        ),
      );
    const eventOk = new Map(events.map((e) => [e.id, e.contactId]));
    let restored = 0;
    for (const e of args.entries) {
      if (eventOk.get(e.eventId) !== e.contactId) continue;
      const back = valid.has(e.fromStageId) ? e.fromStageId : def.id;
      const changedAt = e.fromChangedAt && !Number.isNaN(Date.parse(e.fromChangedAt)) ? new Date(e.fromChangedAt) : null;
      const updated = await tx
        .update(schema.contacts)
        .set({ stageId: back, stageChangedAt: changedAt })
        .where(and(eq(schema.contacts.workspaceId, args.workspaceId), eq(schema.contacts.id, e.contactId), eq(schema.contacts.stageId, args.toStageId)))
        .returning({ id: schema.contacts.id });
      if (updated.length === 0) continue;
      await tx.delete(schema.contactStageEvents).where(eq(schema.contactStageEvents.id, e.eventId));
      restored++;
    }
    return restored;
  });
}

/**
 * A payment moves the contact to the won stage (from any open or lost stage). Called inside the
 * revenue ingest transaction; a contact already in a won stage is left alone.
 */
export async function autoWinOnPayment(tx: Q, workspaceId: string, contactId: string, paidAt: Date): Promise<boolean> {
  const stages = await listStages(tx, workspaceId);
  const won = wonStage(stages);
  if (!won) return false;
  const [c] = await tx
    .select({ stageId: schema.contacts.stageId, stageChangedAt: schema.contacts.stageChangedAt, firstSeenAt: schema.contacts.firstSeenAt })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.id, contactId)));
  if (!c) return false;
  const from = stages.find((s) => s.id === c.stageId) ?? defaultStage(stages);
  if (from.kind === "won") return false;
  // History stays in order even when an old payment is backfilled after a later manual move.
  const since = c.stageChangedAt ?? c.firstSeenAt;
  const at = paidAt.getTime() > since.getTime() ? paidAt : since;
  await tx.update(schema.contacts).set({ stageId: won.id, stageChangedAt: at }).where(eq(schema.contacts.id, contactId));
  await tx.insert(schema.contactStageEvents).values({
    workspaceId,
    contactId,
    fromStageId: from.id,
    toStageId: won.id,
    fromName: from.name,
    toName: won.name,
    source: "payment",
    userId: null,
    occurredAt: at,
  });
  return true;
}

/**
 * One contact's stage and the workspace's stages (for the record page's stage pill), or null when
 * the contact isn't in this workspace.
 */
export async function contactStage(q: Q, workspaceId: string, contactId: string): Promise<{ stageId: string; stages: Stage[] } | null> {
  const [c] = await q
    .select({ stageId: schema.contacts.stageId })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.workspaceId, workspaceId), eq(schema.contacts.id, contactId)));
  if (!c) return null;
  const stages = await listStages(q, workspaceId);
  const stageId = stages.some((s) => s.id === c.stageId) ? c.stageId! : defaultStage(stages).id;
  return { stageId, stages };
}

/** Stage history of one contact, newest first (for the record page timeline). */
export async function stageHistory(db: DB, workspaceId: string, contactId: string) {
  return db
    .select({
      id: schema.contactStageEvents.id,
      fromName: schema.contactStageEvents.fromName,
      toName: schema.contactStageEvents.toName,
      toStageId: schema.contactStageEvents.toStageId,
      source: schema.contactStageEvents.source,
      userId: schema.contactStageEvents.userId,
      occurredAt: schema.contactStageEvents.occurredAt,
    })
    .from(schema.contactStageEvents)
    .where(and(eq(schema.contactStageEvents.workspaceId, workspaceId), eq(schema.contactStageEvents.contactId, contactId)))
    .orderBy(sql`${schema.contactStageEvents.occurredAt} desc, ${schema.contactStageEvents.createdAt} desc`);
}

// ---------------------------------------------------------------- configuring stages

function checkNames(names: string[]) {
  const seen = new Set<string>();
  for (const n of names) {
    const k = n.trim().toLowerCase();
    if (seen.has(k)) throw new PipelineError(`Two stages are called “${n.trim()}”. Stage names must be unique.`);
    seen.add(k);
  }
}

/** Normalise probability by kind: won is always 100 %, lost always 0 %. */
function normalise(s: StageInput): StageInput {
  if (s.kind === "won") return { ...s, probability: 100, rotDays: null };
  if (s.kind === "lost") return { ...s, probability: 0, rotDays: null };
  return s;
}

/**
 * Save the full, ordered stage list (rename, reorder, recolour, change kind/rotting/probability).
 * `stages` must contain exactly the workspace's existing stage ids.
 */
export async function saveStages(db: DB, workspaceId: string, input: (StageInput & { id: string })[]): Promise<Stage[]> {
  const parsed = input.map((s) => ({ id: s.id, ...normalise(stageInput.parse(s)) }));
  checkNames(parsed.map((s) => s.name));
  checkStageSet(parsed);
  return db.transaction(async (tx) => {
    const existing = await listStages(tx, workspaceId);
    const ids = new Set(existing.map((s) => s.id));
    if (parsed.length !== existing.length || !parsed.every((s) => ids.has(s.id)) || new Set(parsed.map((s) => s.id)).size !== parsed.length) {
      throw new PipelineError("The stages changed in another tab. Reload the page and try again.");
    }
    // Two passes so swapping two names never trips the unique (workspace, lower(name)) index.
    await tx
      .update(schema.pipelineStages)
      .set({ name: sql`'~' || ${schema.pipelineStages.id}::text` })
      .where(eq(schema.pipelineStages.workspaceId, workspaceId));
    for (const [position, s] of parsed.entries()) {
      await tx
        .update(schema.pipelineStages)
        .set({ name: s.name, position, kind: s.kind, color: s.color, rotDays: s.rotDays, probability: s.probability })
        .where(and(eq(schema.pipelineStages.workspaceId, workspaceId), eq(schema.pipelineStages.id, s.id)));
    }
    return selectStages(tx, workspaceId);
  });
}

/** Add a stage. Open stages go after the last open stage (before Won/Lost); others at the end. */
export async function addStage(db: DB, workspaceId: string, input: StageInput): Promise<Stage> {
  const s = normalise(stageInput.parse(input));
  return db.transaction(async (tx) => {
    const stages = await listStages(tx, workspaceId);
    if (stages.length >= MAX_STAGES) throw new PipelineError(`A pipeline can have at most ${MAX_STAGES} stages.`);
    checkNames([...stages.map((x) => x.name), s.name]);
    const lastOpen = stages.findLastIndex((x) => x.kind === "open");
    const at = s.kind === "open" ? lastOpen + 1 : stages.length;
    const [row] = await tx.insert(schema.pipelineStages).values({ workspaceId, ...s, position: at }).returning();
    const order = [...stages.slice(0, at).map((x) => x.id), row.id, ...stages.slice(at).map((x) => x.id)];
    for (const [position, id] of order.entries()) {
      await tx.update(schema.pipelineStages).set({ position }).where(and(eq(schema.pipelineStages.workspaceId, workspaceId), eq(schema.pipelineStages.id, id)));
    }
    return toStage({ ...row, position: at });
  });
}

/** Contacts currently in each stage (null stage_id counts toward the default stage). */
export async function stageCounts(q: Q, workspaceId: string, stages: Stage[]): Promise<Map<string, number>> {
  const def = defaultStage(stages);
  const r = rows<{ stage_id: string; n: string }>(
    await q.execute(sql`
      select coalesce(stage_id, ${def.id}::uuid) stage_id, count(*) n
      from contacts where workspace_id = ${workspaceId} group by 1`),
  );
  return new Map(r.map((x) => [x.stage_id, Number(x.n)]));
}

/**
 * Delete a stage. Its contacts move to `reassignTo` first (with a history row each, source
 * "system"). Refuses to leave the pipeline without an open or a won stage.
 */
export async function deleteStage(
  db: DB,
  args: { workspaceId: string; stageId: string; reassignTo: string | null; userId: string | null },
): Promise<{ moved: number; stage: Stage }> {
  return db.transaction(async (tx) => {
    const stages = await listStages(tx, args.workspaceId);
    const stage = stages.find((s) => s.id === args.stageId);
    if (!stage) throw new PipelineError("That stage no longer exists. Reload the page.");
    const rest = stages.filter((s) => s.id !== stage.id);
    checkStageSet(rest);
    const def = defaultStage(stages);
    const inStage = sql`workspace_id = ${args.workspaceId} and (stage_id = ${stage.id}::uuid ${stage.id === def.id ? sql`or stage_id is null` : sql``})`;
    const [{ n }] = rows<{ n: string }>(await tx.execute(sql`select count(*) n from contacts where ${inStage}`));
    const count = Number(n);
    let target: Stage | undefined;
    if (count > 0) {
      target = rest.find((s) => s.id === args.reassignTo);
      if (!target) throw new PipelineError(`Choose where the ${count} contact${count === 1 ? "" : "s"} in “${stage.name}” should go.`);
      await tx.execute(sql`
        insert into contact_stage_events (workspace_id, contact_id, from_stage_id, to_stage_id, from_name, to_name, source, user_id)
        select workspace_id, id, ${stage.id}::uuid, ${target.id}::uuid, ${stage.name}, ${target.name}, 'system', ${args.userId}::uuid
        from contacts where ${inStage}`);
      await tx.execute(sql`update contacts set stage_id = ${target.id}::uuid, stage_changed_at = now() where ${inStage}`);
    }
    await tx.delete(schema.pipelineStages).where(and(eq(schema.pipelineStages.workspaceId, args.workspaceId), eq(schema.pipelineStages.id, stage.id)));
    for (const [position, s] of rest.entries()) {
      if (s.position !== position) {
        await tx.update(schema.pipelineStages).set({ position }).where(eq(schema.pipelineStages.id, s.id));
      }
    }
    return { moved: count, stage };
  });
}
