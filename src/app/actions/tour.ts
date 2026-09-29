"use server";

import { and, eq, isNull } from "drizzle-orm";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

/**
 * The signed-in user finished or skipped the product tour: stop offering it on login. Only the
 * first completion is stored and audited; replays from Settings or the palette are no-ops here.
 */
export async function completeTourAction(outcome: "finished" | "skipped"): Promise<ActionResult> {
  return run(async () => {
    const user = await guard();
    if (outcome !== "finished" && outcome !== "skipped") return fail("Unknown outcome.");
    const db = await getDb();
    const changed = await db
      .update(schema.users)
      .set({ tourCompletedAt: new Date() })
      .where(and(eq(schema.users.id, user.id), isNull(schema.users.tourCompletedAt)))
      .returning({ id: schema.users.id });
    if (changed.length > 0) await audit(user, "account.tour_completed", null, { outcome });
    return ok();
  });
}
