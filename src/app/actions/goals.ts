"use server";

import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { deleteGoal, GOAL_METRICS, parseGoalInput, upsertGoal } from "@/lib/reports-goals";

// Workspace targets (Settings → Workspace → Targets & goals). Owners and admins only.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveGoalAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    let input;
    try {
      input = parseGoalInput(
        { metric: str(form, "metric"), period: str(form, "period"), target: str(form, "target"), budget: str(form, "budget") },
        user.workspace.reportingCurrency,
      );
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Check the target and try again.");
    }
    const db = await getDb();
    const goal = await upsertGoal(db, user.workspace, input);
    await audit(user, "goal.saved", goal.metric, { period: goal.period, hasBudget: goal.budgetMinor !== null });
    revalidatePath("/settings/workspace/goals");
    revalidatePath("/");
    return ok(`${GOAL_METRICS[goal.metric].label} target saved.`);
  });
}

export async function deleteGoalAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    if (!UUID.test(id)) return fail("That goal no longer exists.");
    const db = await getDb();
    const goal = await deleteGoal(db, user.workspace, id);
    if (!goal) return fail("That goal no longer exists.");
    await audit(user, "goal.deleted", goal.metric);
    revalidatePath("/settings/workspace/goals");
    revalidatePath("/");
    return ok(`${GOAL_METRICS[goal.metric].label} target removed.`);
  });
}
