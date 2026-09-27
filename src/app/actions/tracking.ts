"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { CONSENT_MODES, isConsentMode } from "@/lib/tracking/consent-modes";

// Pixel consent settings (Settings → Tracking).

export async function setPixelConsentModeAction(siteId: string, mode: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.settings");
    if (!isConsentMode(mode)) return fail("Choose one of the consent modes.");
    const db = await getDb();
    const [site] = await db
      .update(schema.pixelSites)
      .set({ consentMode: mode })
      .where(and(eq(schema.pixelSites.id, siteId), eq(schema.pixelSites.workspaceId, user.workspace.id)))
      .returning({ name: schema.pixelSites.name });
    if (!site) return fail("That website no longer exists.");
    await audit(user, "pixel_site.consent_mode", site.name, { mode });
    revalidatePath("/settings", "layout");
    const next = mode === "required" ? " and connect your cookie banner" : "";
    return ok(`${CONSENT_MODES[mode].label} saved. Update the snippet on your site${next}.`);
  });
}
