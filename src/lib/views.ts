import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { DB } from "./db";
import { schema } from "./db";
import type { SavedViewPage } from "./db/schema";

// Saved views: a named snapshot of a report page's URL state. Shared views (user_id null) are
// visible to everyone in the workspace; personal views only to their owner. Only whitelisted,
// non-PII query keys are ever stored, so a view can't smuggle arbitrary data into a URL.

export type SavedView = {
  id: string;
  page: SavedViewPage;
  name: string;
  params: Record<string, string>;
  pinned: boolean;
  position: number;
  shared: boolean;
  /** True when the viewer owns this personal view. */
  mine: boolean;
  /** Link that reopens the view (see viewHref). */
  href: string;
};

export const VIEW_PAGES: Record<SavedViewPage, { path: string; label: string; keys: readonly string[] }> = {
  performance: {
    path: "/performance",
    label: "Performance",
    keys: ["range", "from", "to", "model", "platform", "compare", "level", "parent", "q", "preset", "cols", "density", "sort", "dir", "mode"],
  },
};

export const VIEW_NAME_MAX = 60;
export const VIEWS_PER_PAGE_MAX = 50;
const VALUE_MAX = 300;

export function isViewPage(v: unknown): v is SavedViewPage {
  return typeof v === "string" && Object.hasOwn(VIEW_PAGES, v);
}

/** Keep only the page's whitelisted keys with short, printable string values. */
export function sanitizeViewParams(page: SavedViewPage, input: unknown): Record<string, string> {
  const keys = VIEW_PAGES[page].keys;
  const entries: [string, unknown][] =
    input instanceof URLSearchParams
      ? [...input.entries()]
      : typeof input === "string"
        ? [...new URLSearchParams(input).entries()]
        : input && typeof input === "object"
          ? Object.entries(input)
          : [];
  const out: Record<string, string> = {};
  for (const [k, raw] of entries) {
    if (!keys.includes(k) || typeof raw !== "string") continue;
    // Control characters never belong in a query value.
    // eslint-disable-next-line no-control-regex
    const v = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, VALUE_MAX);
    if (v) out[k] = v;
  }
  return out;
}

export function cleanViewName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const v = name.replace(/\s+/g, " ").trim().slice(0, VIEW_NAME_MAX);
  return v || null;
}

/** Link that reopens a view: its params plus `view=<id>` so the page can show it as active. */
export function viewHref(v: { id: string; page: SavedViewPage; params: Record<string, string> }): string {
  const qs = new URLSearchParams({ ...v.params, view: v.id });
  return `${VIEW_PAGES[v.page].path}?${qs}`;
}

type Row = typeof schema.savedViews.$inferSelect;
const toView = (r: Row, userId: string): SavedView => ({
  href: viewHref({ id: r.id, page: r.page, params: r.params ?? {} }),
  id: r.id,
  page: r.page,
  name: r.name,
  params: r.params ?? {},
  pinned: r.pinned,
  position: r.position,
  shared: r.userId === null,
  mine: r.userId === userId,
});

const visibleTo = (workspaceId: string, userId: string) =>
  and(
    eq(schema.savedViews.workspaceId, workspaceId),
    or(isNull(schema.savedViews.userId), eq(schema.savedViews.userId, userId)),
  );

/** Views on one page the user can open: shared first, then personal, each in saved order. */
export async function listViews(db: DB, workspaceId: string, userId: string, page: SavedViewPage): Promise<SavedView[]> {
  const rows = await db
    .select()
    .from(schema.savedViews)
    .where(and(visibleTo(workspaceId, userId), eq(schema.savedViews.page, page)))
    .orderBy(sql`${schema.savedViews.userId} is not null`, asc(schema.savedViews.position), asc(schema.savedViews.createdAt));
  return rows.map((r) => toView(r, userId));
}

/** Pinned views across every page, for the sidebar. */
export async function listPinnedViews(db: DB, workspaceId: string, userId: string): Promise<SavedView[]> {
  const rows = await db
    .select()
    .from(schema.savedViews)
    .where(and(visibleTo(workspaceId, userId), eq(schema.savedViews.pinned, true)))
    .orderBy(asc(schema.savedViews.page), sql`${schema.savedViews.userId} is not null`, asc(schema.savedViews.position), asc(schema.savedViews.createdAt));
  return rows.map((r) => toView(r, userId));
}

export async function getView(db: DB, workspaceId: string, userId: string, id: string): Promise<SavedView | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await db
    .select()
    .from(schema.savedViews)
    .where(and(visibleTo(workspaceId, userId), eq(schema.savedViews.id, id)));
  return r ? toView(r, userId) : null;
}

export async function countViews(db: DB, workspaceId: string, userId: string | null, page: SavedViewPage): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.savedViews)
    .where(
      and(
        eq(schema.savedViews.workspaceId, workspaceId),
        eq(schema.savedViews.page, page),
        userId ? eq(schema.savedViews.userId, userId) : isNull(schema.savedViews.userId),
      ),
    );
  return Number(r?.n ?? 0);
}

export async function createView(
  db: DB,
  v: { workspaceId: string; userId: string | null; ownerId: string; page: SavedViewPage; name: string; params: Record<string, string>; pinned?: boolean },
): Promise<SavedView> {
  const [last] = await db
    .select({ position: schema.savedViews.position })
    .from(schema.savedViews)
    .where(and(eq(schema.savedViews.workspaceId, v.workspaceId), eq(schema.savedViews.page, v.page)))
    .orderBy(desc(schema.savedViews.position))
    .limit(1);
  const [row] = await db
    .insert(schema.savedViews)
    .values({
      workspaceId: v.workspaceId,
      userId: v.userId,
      page: v.page,
      name: v.name,
      params: v.params,
      pinned: v.pinned ?? false,
      position: (last?.position ?? -1) + 1,
    })
    .returning();
  return toView(row, v.ownerId);
}

export async function updateView(
  db: DB,
  workspaceId: string,
  id: string,
  patch: Partial<{ name: string; params: Record<string, string>; pinned: boolean }>,
): Promise<void> {
  await db
    .update(schema.savedViews)
    .set(patch)
    .where(and(eq(schema.savedViews.workspaceId, workspaceId), eq(schema.savedViews.id, id)));
}

export async function deleteView(db: DB, workspaceId: string, id: string): Promise<void> {
  await db.delete(schema.savedViews).where(and(eq(schema.savedViews.workspaceId, workspaceId), eq(schema.savedViews.id, id)));
}
