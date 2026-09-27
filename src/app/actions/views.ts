"use server";

import { revalidatePath } from "next/cache";
import { Denied, fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit, type SessionUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import type { SavedViewPage } from "@/lib/db/schema";
import {
  cleanViewName,
  countPinnedViews,
  countViews,
  PINNED_VIEWS_MAX,
  createView,
  deleteView,
  getView,
  isViewPage,
  listViews,
  sanitizeViewParams,
  updateView,
  VIEWS_PER_PAGE_MAX,
  type SavedView,
} from "@/lib/views";

// Saved views. Anyone who can see reports keeps personal views; shared (workspace) views need
// `views.share`. Every change is audited. Results carry the page's fresh view list so the
// Views menu updates without re-rendering the report; the layout is revalidated only when
// the sidebar's pinned list can change.

type Result = ActionResult & { views?: SavedView[]; view?: SavedView };
const runView = (fn: () => Promise<Result>) => run(fn) as Promise<Result>;

async function pageViews(user: SessionUser, page: SavedViewPage) {
  return listViews(await getDb(), user.workspace.id, user.id, page);
}

/** The view if the user may change it: their own personal view, or a shared one with views.share. */
async function editable(user: SessionUser, id: unknown): Promise<SavedView> {
  if (typeof id !== "string") throw new Denied("That view no longer exists.");
  const view = await getView(await getDb(), user.workspace.id, user.id, id);
  if (!view) throw new Denied("That view no longer exists.");
  if (view.shared ? !user.can("views.share") : !view.mine) {
    throw new Denied("Only admins and analysts can change shared views.");
  }
  return view;
}

export async function saveViewAction(input: { page: string; name: string; params: unknown; shared?: boolean }): Promise<Result> {
  return runView(async () => {
    const user = await guard(input?.shared ? "views.share" : "reports.view");
    if (!isViewPage(input?.page)) return fail("Unknown page.");
    const name = cleanViewName(input.name);
    if (!name) return fail("Give the view a name.");
    const db = await getDb();
    const owner = input.shared ? null : user.id;
    if ((await countViews(db, user.workspace.id, owner, input.page)) >= VIEWS_PER_PAGE_MAX) {
      return fail(`You can keep up to ${VIEWS_PER_PAGE_MAX} views here. Delete one first.`);
    }
    const view = await createView(db, {
      workspaceId: user.workspace.id,
      userId: owner,
      ownerId: user.id,
      page: input.page,
      name,
      params: sanitizeViewParams(input.page, input.params),
    });
    await audit(user, "view.create", view.id, { page: view.page, name, shared: view.shared });
    return { ...ok(`Saved “${name}”.`), view, views: await pageViews(user, input.page) };
  });
}

/** Overwrite a view's saved state with the current URL state. */
export async function updateViewParamsAction(id: string, params: unknown): Promise<Result> {
  return runView(async () => {
    const user = await guard("reports.view");
    const view = await editable(user, id);
    await updateView(await getDb(), user.workspace.id, view.id, { params: sanitizeViewParams(view.page, params) });
    await audit(user, "view.update", view.id, { page: view.page });
    if (view.pinned) revalidatePath("/", "layout");
    return { ...ok(`Updated “${view.name}”.`), views: await pageViews(user, view.page) };
  });
}

export async function renameViewAction(id: string, name: string): Promise<Result> {
  return runView(async () => {
    const user = await guard("reports.view");
    const view = await editable(user, id);
    const clean = cleanViewName(name);
    if (!clean) return fail("Give the view a name.");
    await updateView(await getDb(), user.workspace.id, view.id, { name: clean });
    await audit(user, "view.rename", view.id, { page: view.page, from: view.name, to: clean });
    if (view.pinned) revalidatePath("/", "layout");
    return { ...ok("View renamed."), views: await pageViews(user, view.page) };
  });
}

export async function setViewPinnedAction(id: string, pinned: boolean): Promise<Result> {
  return runView(async () => {
    const user = await guard("reports.view");
    const view = await editable(user, id);
    const db = await getDb();
    if (pinned && !view.pinned && (await countPinnedViews(db, user.workspace.id, user.id)) >= PINNED_VIEWS_MAX) {
      return fail(`The sidebar holds up to ${PINNED_VIEWS_MAX} pinned views. Unpin one first.`);
    }
    await updateView(db, user.workspace.id, view.id, { pinned: Boolean(pinned) });
    await audit(user, pinned ? "view.pin" : "view.unpin", view.id, { page: view.page });
    revalidatePath("/", "layout");
    return { ...ok(pinned ? `Pinned “${view.name}” to the sidebar.` : `Unpinned “${view.name}”.`), views: await pageViews(user, view.page) };
  });
}

export async function deleteViewAction(id: string): Promise<Result> {
  return runView(async () => {
    const user = await guard("reports.view");
    const view = await editable(user, id);
    await deleteView(await getDb(), user.workspace.id, view.id);
    await audit(user, "view.delete", view.id, { page: view.page, name: view.name, shared: view.shared });
    if (view.pinned) revalidatePath("/", "layout");
    return { ...ok(`Deleted “${view.name}”.`), views: await pageViews(user, view.page) };
  });
}
