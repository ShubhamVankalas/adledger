import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { DB } from "./db";
import { schema } from "./db";
import type { SavedViewPage } from "./db/schema";
import { PINNED_VIEWS_MAX, viewHref, type SavedView } from "./view-params";

// Saved views storage. The URL rules (whitelisted keys, names, links) live in view-params.ts so
// client components can use them too; they are re-exported here.
export * from "./view-params";

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
  and(eq(schema.savedViews.workspaceId, workspaceId), or(isNull(schema.savedViews.userId), eq(schema.savedViews.userId, userId)));

/** Views on one page the user can open: shared first, then personal, each in saved order. */
export async function listViews(db: DB, workspaceId: string, userId: string, page: SavedViewPage): Promise<SavedView[]> {
  const rows = await db
    .select()
    .from(schema.savedViews)
    .where(and(visibleTo(workspaceId, userId), eq(schema.savedViews.page, page)))
    .orderBy(sql`${schema.savedViews.userId} is not null`, asc(schema.savedViews.position), asc(schema.savedViews.createdAt));
  return rows.map((r) => toView(r, userId));
}

/** Pinned views across every page, for the sidebar (at most PINNED_VIEWS_MAX). */
export async function listPinnedViews(db: DB, workspaceId: string, userId: string): Promise<SavedView[]> {
  const rows = await db
    .select()
    .from(schema.savedViews)
    .where(and(visibleTo(workspaceId, userId), eq(schema.savedViews.pinned, true)))
    .orderBy(asc(schema.savedViews.page), sql`${schema.savedViews.userId} is not null`, asc(schema.savedViews.position), asc(schema.savedViews.createdAt))
    .limit(PINNED_VIEWS_MAX);
  return rows.map((r) => toView(r, userId));
}

/** How many pinned views the user sees in the sidebar (shared and personal). */
export async function countPinnedViews(db: DB, workspaceId: string, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.savedViews)
    .where(and(visibleTo(workspaceId, userId), eq(schema.savedViews.pinned, true)));
  return Number(r?.n ?? 0);
}

export async function getView(db: DB, workspaceId: string, userId: string, id: string): Promise<SavedView | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
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
