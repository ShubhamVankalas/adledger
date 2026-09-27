import { and, eq, isNull } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { schema } from "@/lib/db";
import type { Permission } from "@/lib/permissions";
import { parseLayout } from "./layout";
import { defaultPresetFor, presetLayout } from "./presets";
import { PRESET_KEYS, type DashboardScope, type Layout, type PresetKey } from "./types";

// Reading and writing `dashboards` rows. user_id null = workspace default, else a personal override.

type Row = typeof schema.dashboards.$inferSelect;

const scopeWhere = (workspaceId: string, userId: string | null) =>
  and(eq(schema.dashboards.workspaceId, workspaceId), userId ? eq(schema.dashboards.userId, userId) : isNull(schema.dashboards.userId));

export const isPresetKey = (v: unknown): v is PresetKey => typeof v === "string" && (PRESET_KEYS as readonly string[]).includes(v);

export type ResolvedDashboard = {
  layout: Layout;
  preset: PresetKey;
  /** Where the layout on screen came from. */
  source: "personal" | "workspace" | "preset";
  /** Version of the saved row for each scope (0 = no row yet). Sent back on save to catch conflicts. */
  versions: Record<DashboardScope, number>;
  /** The workspace default (or the preset when none is saved): what "Reset to workspace default" restores. */
  workspaceLayout: Layout;
  workspacePreset: PresetKey;
};

/** The layout a member sees: their personal override, else the workspace default, else the preset. */
export async function resolveDashboard(db: DB, ws: { id: string; isDemo: boolean }, userId: string): Promise<ResolvedDashboard> {
  const rows = await db
    .select()
    .from(schema.dashboards)
    .where(eq(schema.dashboards.workspaceId, ws.id));
  const personal = rows.find((r) => r.userId === userId);
  const shared = rows.find((r) => r.userId === null);
  const fallbackPreset = defaultPresetFor(ws);
  const workspacePreset = shared && isPresetKey(shared.preset) ? shared.preset : fallbackPreset;
  const workspaceLayout = shared ? parseLayout(shared.layout, presetLayout(workspacePreset)) : presetLayout(fallbackPreset);
  const versions = { personal: personal?.version ?? 0, workspace: shared?.version ?? 0 };
  if (personal) {
    const preset = isPresetKey(personal.preset) ? personal.preset : workspacePreset;
    return { layout: parseLayout(personal.layout, workspaceLayout), preset, source: "personal", versions, workspaceLayout, workspacePreset };
  }
  return { layout: workspaceLayout, preset: workspacePreset, source: shared ? "workspace" : "preset", versions, workspaceLayout, workspacePreset };
}

export type SaveResult = { ok: true; version: number } | { ok: false; conflict: true };

/**
 * Save a layout for a scope with optimistic concurrency: `expectedVersion` is the version the
 * editor started from (0 = no row yet). A stale version is rejected instead of silently
 * overwriting a teammate's (or another tab's) change.
 */
export async function saveDashboard(
  db: DB,
  input: { workspaceId: string; userId: string | null; layout: Layout; preset: PresetKey; expectedVersion: number },
): Promise<SaveResult> {
  const { workspaceId, userId, layout, preset, expectedVersion } = input;
  if (expectedVersion === 0) {
    const [row] = await db
      .insert(schema.dashboards)
      .values({ workspaceId, userId, layout, preset, version: 1 })
      .onConflictDoNothing()
      .returning({ version: schema.dashboards.version });
    return row ? { ok: true, version: row.version } : { ok: false, conflict: true };
  }
  const [row] = await db
    .update(schema.dashboards)
    .set({ layout, preset, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(scopeWhere(workspaceId, userId), eq(schema.dashboards.version, expectedVersion)))
    .returning({ version: schema.dashboards.version });
  return row ? { ok: true, version: row.version } : { ok: false, conflict: true };
}

/** Read-modify-write for small instant edits (pinning): never conflicts, always applies to the latest row. */
export async function updateDashboard(
  db: DB,
  input: { workspaceId: string; userId: string | null; base: Layout; preset: PresetKey },
  edit: (layout: Layout) => Layout | null,
): Promise<{ layout: Layout; version: number } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db.select().from(schema.dashboards).where(scopeWhere(input.workspaceId, input.userId));
    const current: Row | undefined = row;
    const layout = current ? parseLayout(current.layout, input.base) : input.base;
    const next = edit(layout);
    if (!next) return null;
    const preset = current && isPresetKey(current.preset) ? current.preset : input.preset;
    const saved = await saveDashboard(db, { ...input, layout: next, preset, expectedVersion: current?.version ?? 0 });
    if (saved.ok) return { layout: next, version: saved.version };
  }
  return null;
}

/** Remove a saved layout (personal: back to the workspace default; workspace: back to the preset). */
export async function deleteDashboard(db: DB, workspaceId: string, userId: string | null): Promise<boolean> {
  const deleted = await db.delete(schema.dashboards).where(scopeWhere(workspaceId, userId)).returning({ id: schema.dashboards.id });
  return deleted.length > 0;
}

/** Everyone with dashboard.edit may save a personal view; the workspace default also needs workspace.settings. */
export function canEditScope(can: (permission: Permission) => boolean, scope: DashboardScope): boolean {
  if (!can("dashboard.edit")) return false;
  return scope === "personal" || can("workspace.settings");
}

/**
 * Which scope a member's edits go to by default: their personal override when they have one;
 * otherwise admins edit the workspace default (what the team sees) and everyone else gets a
 * personal copy.
 */
export function defaultEditScope(opts: { hasPersonal: boolean; canEditWorkspace: boolean }): DashboardScope {
  if (opts.hasPersonal) return "personal";
  return opts.canEditWorkspace ? "workspace" : "personal";
}
