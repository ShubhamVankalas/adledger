"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { isLayoutShape, parseLayout } from "@/lib/dashboard/layout";
import { togglePin } from "@/lib/dashboard/ops";
import { presetLayout } from "@/lib/dashboard/presets";
import { canEditScope, defaultEditScope, deleteDashboard, resolveDashboard, saveDashboard, updateDashboard } from "@/lib/dashboard/store";
import { PRESET_KEYS, type DashboardScope } from "@/lib/dashboard/types";
import { getDb } from "@/lib/db";
import { widgetMeta } from "@/lib/widgets/catalog";

// Overview layout actions. Everyone with dashboard.edit can save a personal view; the workspace
// default (what new members, digests and share links see) also needs workspace.settings.

const MAX_LAYOUT_BYTES = 32_000;
const scopeSchema = z.enum(["personal", "workspace"]);
const DENIED_WORKSPACE = "Only admins can change the workspace default. Save it as your personal view instead.";
const CONFLICT = "This layout was changed in another tab or by a teammate. Reload the page to get the latest version, then try again.";

const saveInput = z.object({
  scope: scopeSchema,
  layout: z.unknown(),
  preset: z.enum(PRESET_KEYS),
  version: z.number().int().min(0),
});

/** Save the edited board (edit mode → Save) for the chosen scope. */
export async function saveDashboardAction(input: z.input<typeof saveInput>): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("dashboard.edit");
    const parsed = saveInput.safeParse(input);
    if (!parsed.success || !isLayoutShape(parsed.data.layout)) return fail("That layout isn't valid. Reload the page and try again.");
    const { scope, preset, version } = parsed.data;
    if (!canEditScope(user.can, scope)) return fail(DENIED_WORKSPACE);
    if (JSON.stringify(parsed.data.layout).length > MAX_LAYOUT_BYTES) return fail("That layout is too large. Remove a few widgets and save again.");
    const layout = parseLayout(parsed.data.layout, presetLayout(preset));

    const db = await getDb();
    const saved = await saveDashboard(db, {
      workspaceId: user.workspace.id,
      userId: scope === "personal" ? user.id : null,
      layout,
      preset,
      expectedVersion: version,
    });
    if (!saved.ok) return fail(CONFLICT);
    await audit(user, "dashboard.save", scope, { preset, pinned: layout.pinned.length, widgets: layout.sections.reduce((n, s) => n + s.items.length, 0) });
    revalidatePath("/");
    return ok(scope === "personal" ? "Saved as your personal view." : "Saved as the workspace default.", { version: saved.version, layout });
  });
}

/** Delete a saved layout: personal → back to the workspace default; workspace → back to the preset. */
export async function resetDashboardAction(input: { scope: DashboardScope }): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("dashboard.edit");
    const scope = scopeSchema.safeParse(input?.scope);
    if (!scope.success) return fail("Pick which layout to reset.");
    if (!canEditScope(user.can, scope.data)) return fail(DENIED_WORKSPACE);
    const db = await getDb();
    const removed = await deleteDashboard(db, user.workspace.id, scope.data === "personal" ? user.id : null);
    if (removed) await audit(user, "dashboard.reset", scope.data);
    revalidatePath("/");
    return ok(scope.data === "personal" ? "Back to the workspace default." : "Workspace default reset to its preset.");
  });
}

/**
 * Pin a KPI tile to the strip or unpin it, outside edit mode. Applies to the layout the member is
 * looking at (their personal view, or the workspace default for admins without one).
 */
export async function togglePinAction(input: { type: string }): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("dashboard.edit");
    const type = typeof input?.type === "string" ? input.type : "";
    const meta = widgetMeta(type);
    if (!meta || meta.category !== "kpi") return fail("Only number tiles can be pinned.");
    const db = await getDb();
    const resolved = await resolveDashboard(db, user.workspace, user.id);
    const scope = defaultEditScope({ hasPersonal: resolved.source === "personal", canEditWorkspace: canEditScope(user.can, "workspace") });
    let pinned = false;
    const result = await updateDashboard(
      db,
      { workspaceId: user.workspace.id, userId: scope === "personal" ? user.id : null, base: resolved.layout, preset: resolved.preset },
      (layout) => {
        const next = togglePin(layout, type);
        if (!next) return null;
        pinned = next.pinned;
        return next.layout;
      },
    );
    if (!result) return fail("The strip holds six tiles. Unpin one first.");
    await audit(user, pinned ? "dashboard.pin" : "dashboard.unpin", type, { scope });
    // No revalidatePath: the board already moved the tile optimistically and every tile it can
    // pin is on screen, so re-rendering every widget on the server would be wasted work.
    return ok(pinned ? `Pinned ${meta.title}.` : `Unpinned ${meta.title}.`, { layout: result.layout, version: result.version, scope, pinned });
  });
}
