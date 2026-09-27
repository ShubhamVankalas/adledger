"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { addStage, deleteStage, listStages, MAX_MOVE, moveContacts, saveStages, stageInput, undoMove } from "@/lib/pipeline";
import { pipelineCards } from "@/lib/reports-pipeline";

// Pipeline: moving contacts between stages (pipeline.move) and configuring the stages
// themselves (workspace.settings). Every change is audited; audit meta never carries PII.

const uuid = z.uuid();
const moveInput = z.object({ contactIds: z.array(uuid).min(1).max(MAX_MOVE), stageId: uuid });
const undoInput = z.object({
  toStageId: uuid,
  entries: z
    .array(z.object({ contactId: uuid, fromStageId: uuid, fromChangedAt: z.string().max(40).nullable(), eventId: uuid }))
    .min(1)
    .max(MAX_MOVE),
});
const stagesInput = z.array(stageInput.extend({ id: uuid })).min(1).max(20);

/** First validation message of a zod error, else null. */
function invalid(err: unknown): string | null {
  return err instanceof z.ZodError ? (err.issues[0]?.message ?? "Check the form and try again.") : null;
}

function revalidate() {
  revalidatePath("/pipeline");
  revalidatePath("/settings/workspace/pipeline");
}

export async function moveContactsAction(contactIds: string[], stageId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("pipeline.move");
    const parsed = moveInput.safeParse({ contactIds, stageId });
    if (!parsed.success) return fail("Those contacts could not be moved. Reload the page and try again.");
    const db = await getDb();
    const r = await moveContacts(db, { workspaceId: user.workspace.id, ...parsed.data, userId: user.id });
    if (r.moved.length) {
      await audit(user, "pipeline.contacts_moved", r.stage.name, { stageId: r.stage.id, count: r.moved.length });
      revalidatePath("/pipeline");
    }
    return ok(undefined, { stageName: r.stage.name, moved: r.moved });
  });
}

export async function undoMoveAction(toStageId: string, entries: unknown[]): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("pipeline.move");
    const parsed = undoInput.safeParse({ toStageId, entries });
    if (!parsed.success) return fail("That move can no longer be undone.");
    const db = await getDb();
    const restored = await undoMove(db, { workspaceId: user.workspace.id, userId: user.id, ...parsed.data });
    if (restored === 0) return fail("That move can no longer be undone.");
    await audit(user, "pipeline.move_undone", null, { stageId: parsed.data.toStageId, count: restored });
    revalidatePath("/pipeline");
    return ok(undefined, { restored });
  });
}

/** Next page of cards for one column ("Show more"). Read-only. */
export async function loadStageCardsAction(stageId: string, offset: number): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.view");
    if (!uuid.safeParse(stageId).success || !Number.isSafeInteger(offset) || offset < 0) return fail("Could not load more contacts.");
    const db = await getDb();
    const stages = await listStages(db, user.workspace.id);
    if (!stages.some((s) => s.id === stageId)) return fail("That stage no longer exists. Reload the page.");
    const cards = await pipelineCards(db, user.workspace, stages, { stageId, offset });
    return ok(undefined, { cards });
  });
}

export async function saveStagesAction(stages: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    try {
      const input = stagesInput.parse(stages);
      const db = await getDb();
      const saved = await saveStages(db, user.workspace.id, input);
      await audit(user, "pipeline.stages_saved", null, { stages: saved.map((s) => ({ id: s.id, name: s.name, kind: s.kind })) });
      revalidate();
      return ok("Stages saved.", { stages: saved });
    } catch (err) {
      const msg = invalid(err);
      if (msg) return fail(msg);
      throw err;
    }
  });
}

export async function addStageAction(input: unknown): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    try {
      const db = await getDb();
      const stage = await addStage(db, user.workspace.id, stageInput.parse(input));
      await audit(user, "pipeline.stage_added", stage.name, { stageId: stage.id, kind: stage.kind });
      revalidate();
      return ok(`Added “${stage.name}”.`, { stage });
    } catch (err) {
      const msg = invalid(err);
      if (msg) return fail(msg);
      throw err;
    }
  });
}

export async function deleteStageAction(stageId: string, reassignTo: string | null): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    if (!uuid.safeParse(stageId).success || (reassignTo !== null && !uuid.safeParse(reassignTo).success)) return fail("Reload the page and try again.");
    const db = await getDb();
    const r = await deleteStage(db, { workspaceId: user.workspace.id, stageId, reassignTo, userId: user.id });
    await audit(user, "pipeline.stage_deleted", r.stage.name, { stageId, reassignTo, moved: r.moved });
    revalidate();
    return ok(r.moved ? `Deleted “${r.stage.name}” and moved ${r.moved} contact${r.moved === 1 ? "" : "s"}.` : `Deleted “${r.stage.name}”.`);
  });
}
