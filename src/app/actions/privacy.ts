"use server";

import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { applyRetention, eraseContact, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, setRetention } from "@/lib/privacy";
import { UUID_RE } from "@/lib/request-auth";

// Privacy & data ownership actions (erasure, retention). Exports are route handlers
// under /api/v1/exports so they can stream.

export async function deleteContactAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.data");
    if (!UUID_RE.test(id)) return fail("Contact not found.");
    const db = await getDb();
    const result = await eraseContact(db, user.workspace.id, id);
    if (!result) return fail("Contact not found. It may already have been deleted.");
    await audit(user, "contact.erased", id, { via: "dashboard", ...result });
    revalidatePath("/", "layout");
    return ok("Contact deleted. Their revenue is kept anonymously so your totals don't change.", { ...result });
  });
}

export async function saveRetentionAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.data");
    const raw = str(form, "eventsDays");
    const days = raw === "" || raw === "0" ? null : Number(raw);
    if (days !== null && (!Number.isInteger(days) || days < RETENTION_MIN_DAYS || days > RETENTION_MAX_DAYS)) {
      return fail(`Enter a whole number of days between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS}, or leave it empty to keep events forever.`);
    }
    const db = await getDb();
    await setRetention(db, user.workspace.id, days);
    await audit(user, "retention.updated", days ? `${days} days` : "off");
    // Apply right away so the setting's effect is visible; the daily job keeps it enforced.
    const deleted = days ? await applyRetention(db, user.workspace.id) : null;
    revalidatePath("/settings", "layout");
    if (!days) return ok("Data retention turned off. Raw events are kept until you delete them.");
    return ok(`Raw events older than ${days} days are deleted daily${deleted ? ` (${deleted.toLocaleString("en-US")} removed now)` : ""}.`);
  });
}
