"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getIntegration } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";
import { syncAll } from "@/lib/sync";
import { publicUrl } from "@/lib/url";

// Actions behind the ⌘K palette's "Sync now" and "Copy pixel snippet" commands.

export async function syncAllNowAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    const results = await syncAll(db, user.workspace.id);
    if (results.length === 0) return fail("No live ad accounts to sync. Connect one in Settings → Integrations.");
    await audit(user, "sync.manual", results.map((r) => r.provider).join(","));
    revalidatePath("/", "layout");
    const failed = results.filter((r) => r.status === "error");
    const names = (list: typeof results) => list.map((r) => getIntegration(r.provider)?.name ?? r.provider).join(", ");
    if (failed.length === results.length) return fail(`Sync failed for ${names(failed)}. Check Settings → Integrations.`);
    const rowsSynced = results.reduce((sum, r) => sum + r.rows, 0);
    const summary = `Synced ${rowsSynced.toLocaleString("en-US")} rows from ${names(results.filter((r) => r.status === "success"))}.`;
    return ok(failed.length ? `${summary} ${names(failed)} failed.` : summary);
  });
}

/** Origin + public key of the workspace's first website, for building the pixel snippet in the browser. */
export async function pixelSnippetAction(): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    const db = await getDb();
    const [site] = await db
      .select({ publicKey: schema.pixelSites.publicKey, name: schema.pixelSites.name })
      .from(schema.pixelSites)
      .where(eq(schema.pixelSites.workspaceId, user.workspace.id))
      .orderBy(schema.pixelSites.createdAt)
      .limit(1);
    if (!site) return fail("Add your website first in Settings → Tracking & forms.");
    return ok(undefined, { origin: await publicUrl(), publicKey: site.publicKey, site: site.name });
  });
}
