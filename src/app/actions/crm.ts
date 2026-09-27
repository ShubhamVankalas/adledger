"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, guard, ok, run, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { displayEmail } from "@/lib/contact-display";
import { normalizeTag, VIEW_KEYS } from "@/lib/crm-query";
import { getDb, rows, schema } from "@/lib/db";
import { csvCell, eraseContact, minorToDecimal } from "@/lib/privacy";
import { contactRecord, isEditingMember, ownedContactIds } from "@/lib/reports-crm";
import { currencyExponent } from "@/lib/money";
import { UUID_RE } from "@/lib/request-auth";

// CRM writes: owner, tags, lifecycle, name, notes, tasks, saved views, bulk delete and export.
// Every action starts with guard(permission), checks ids belong to the current workspace, and
// writes audit(). Values that undo a change are returned so the UI can offer Undo.

const MAX_BULK = 500;
const ids = z.array(z.string().regex(UUID_RE)).min(1).max(MAX_BULK);
const uuid = z.string().regex(UUID_RE);

const refresh = () => {
  revalidatePath("/contacts", "layout");
  revalidatePath("/tasks");
};

// ---------------------------------------------------------------- read (peek panel)

export async function loadContactAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.view");
    if (!UUID_RE.test(id)) return fail("Contact not found.");
    const db = await getDb();
    const record = await contactRecord(db, user.workspace, id, user, { withNotes: user.can("contacts.notes") });
    if (!record) return fail("Contact not found. It may have been deleted.");
    return ok(undefined, { record });
  });
}

// ---------------------------------------------------------------- owner

export async function setOwnerAction(contactIds: string[], ownerUserId: string | null): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    const parsed = ids.safeParse(contactIds);
    if (!parsed.success || (ownerUserId !== null && !UUID_RE.test(ownerUserId))) return fail("Pick contacts and an owner.");
    const db = await getDb();
    if (ownerUserId && !(await isEditingMember(db, user.workspace, ownerUserId))) return fail("That person can't own contacts in this workspace.");
    const owned = await ownedContactIds(db, user.workspace, parsed.data);
    if (!owned.length) return fail("Contact not found.");
    const previous = await db
      .select({ id: schema.contacts.id, ownerUserId: schema.contacts.ownerUserId })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, user.workspace.id), inArray(schema.contacts.id, owned)));
    await db
      .update(schema.contacts)
      .set({ ownerUserId })
      .where(and(eq(schema.contacts.workspaceId, user.workspace.id), inArray(schema.contacts.id, owned)));
    await audit(user, "contact.owner_set", owned.length === 1 ? owned[0] : `${owned.length} contacts`, { owner: ownerUserId, contacts: owned.length });
    refresh();
    return ok(ownerUserId ? "Owner assigned" : "Owner removed", { previous });
  });
}

/** Undo for setOwnerAction: put each contact's previous owner back. */
export async function restoreOwnersAction(previous: { id: string; ownerUserId: string | null }[]): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    const list = z.array(z.object({ id: uuid, ownerUserId: uuid.nullable() })).max(MAX_BULK).safeParse(previous);
    if (!list.success || !list.data.length) return fail("Nothing to undo.");
    const db = await getDb();
    const owned = new Set(await ownedContactIds(db, user.workspace, list.data.map((p) => p.id)));
    const byOwner = new Map<string | null, string[]>();
    for (const p of list.data) if (owned.has(p.id)) byOwner.set(p.ownerUserId, [...(byOwner.get(p.ownerUserId) ?? []), p.id]);
    for (const [owner, group] of byOwner) {
      await db
        .update(schema.contacts)
        .set({ ownerUserId: owner })
        .where(and(eq(schema.contacts.workspaceId, user.workspace.id), inArray(schema.contacts.id, group)));
    }
    await audit(user, "contact.owner_set", `${owned.size} contacts`, { undo: true, contacts: owned.size });
    refresh();
    return ok("Owner change undone");
  });
}

// ---------------------------------------------------------------- tags

const tagInput = z
  .string()
  .transform(normalizeTag)
  .pipe(z.string().min(1, "Enter a tag.").regex(/^[\p{L}\p{N} _\-/.&+#]+$/u, "Tags can use letters, numbers, spaces and - _ / . & + #"));

export async function addTagAction(contactIds: string[], rawTag: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    const parsed = ids.safeParse(contactIds);
    const tag = tagInput.safeParse(rawTag);
    if (!parsed.success) return fail("Pick at least one contact.");
    if (!tag.success) return fail(tag.error.issues[0]?.message ?? "Enter a tag.");
    const db = await getDb();
    const owned = await ownedContactIds(db, user.workspace, parsed.data);
    if (!owned.length) return fail("Contact not found.");
    const added = await db
      .insert(schema.contactTags)
      .values(owned.map((contactId) => ({ workspaceId: user.workspace.id, contactId, tag: tag.data })))
      .onConflictDoNothing()
      .returning({ contactId: schema.contactTags.contactId });
    await audit(user, "contact.tag_added", owned.length === 1 ? owned[0] : `${owned.length} contacts`, { tag: tag.data, added: added.length });
    refresh();
    return ok(added.length ? `Tagged ${added.length === 1 ? "1 contact" : `${added.length} contacts`} “${tag.data}”` : `Already tagged “${tag.data}”`, {
      tag: tag.data,
      added: added.map((a) => a.contactId),
    });
  });
}

export async function removeTagAction(contactIds: string[], rawTag: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    const parsed = ids.safeParse(contactIds);
    const tag = normalizeTag(String(rawTag ?? ""));
    if (!parsed.success || !tag) return fail("Nothing to remove.");
    const db = await getDb();
    const removed = await db
      .delete(schema.contactTags)
      .where(
        and(
          eq(schema.contactTags.workspaceId, user.workspace.id),
          inArray(schema.contactTags.contactId, parsed.data),
          eq(schema.contactTags.tag, tag),
        ),
      )
      .returning({ contactId: schema.contactTags.contactId });
    await audit(user, "contact.tag_removed", removed.length === 1 ? removed[0].contactId : `${removed.length} contacts`, { tag, removed: removed.length });
    refresh();
    return ok(`Removed “${tag}”`, { tag, removed: removed.map((r) => r.contactId) });
  });
}

// ---------------------------------------------------------------- lifecycle and name

export async function setLifecycleAction(contactId: string, lifecycle: "lead" | "customer"): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    if (!UUID_RE.test(contactId) || (lifecycle !== "lead" && lifecycle !== "customer")) return fail("Contact not found.");
    const db = await getDb();
    const [before] = await db
      .select({ lifecycle: schema.contacts.lifecycle })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, user.workspace.id), eq(schema.contacts.id, contactId)));
    if (!before) return fail("Contact not found.");
    await db
      .update(schema.contacts)
      .set({ lifecycle })
      .where(and(eq(schema.contacts.workspaceId, user.workspace.id), eq(schema.contacts.id, contactId)));
    await audit(user, "contact.lifecycle_set", contactId, { from: before.lifecycle, to: lifecycle });
    refresh();
    return ok(lifecycle === "customer" ? "Marked as customer" : "Marked as lead", { previous: before.lifecycle });
  });
}

export async function renameContactAction(contactId: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    const clean = String(name ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (!UUID_RE.test(contactId)) return fail("Contact not found.");
    const db = await getDb();
    const [before] = await db
      .select({ name: schema.contacts.name })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, user.workspace.id), eq(schema.contacts.id, contactId)));
    if (!before) return fail("Contact not found.");
    await db
      .update(schema.contacts)
      .set({ name: clean || null })
      .where(and(eq(schema.contacts.workspaceId, user.workspace.id), eq(schema.contacts.id, contactId)));
    // Names are PII: the audit entry records that it changed, not the value.
    await audit(user, "contact.renamed", contactId);
    refresh();
    return ok("Name saved", { previous: before.name });
  });
}

// ---------------------------------------------------------------- notes

const noteBody = z.string().trim().min(1, "Write something first.").max(5000, "Notes can be up to 5,000 characters.");

async function noteForEdit(noteId: string) {
  const user = await guard("contacts.edit");
  if (!UUID_RE.test(noteId)) return { user, note: null };
  const db = await getDb();
  const [note] = await db
    .select()
    .from(schema.contactNotes)
    .where(and(eq(schema.contactNotes.workspaceId, user.workspace.id), eq(schema.contactNotes.id, noteId)));
  // Authors edit their own notes; owners and admins can tidy up anyone's.
  const mayEdit = note && (note.authorUserId === user.id || user.role === "owner" || user.role === "admin");
  return { user, note: mayEdit ? note : null, exists: Boolean(note) };
}

export async function addNoteAction(contactId: string, body: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    const parsed = noteBody.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Write something first.");
    const db = await getDb();
    if (!UUID_RE.test(contactId) || !(await ownedContactIds(db, user.workspace, [contactId])).length) return fail("Contact not found.");
    const [note] = await db
      .insert(schema.contactNotes)
      .values({ workspaceId: user.workspace.id, contactId, authorUserId: user.id, body: parsed.data })
      .returning({ id: schema.contactNotes.id });
    // The body is never written to the audit log (notes can hold PII).
    await audit(user, "contact.note_added", contactId, { note: note.id });
    refresh();
    return ok("Note added", { id: note.id });
  });
}

export async function updateNoteAction(noteId: string, body: string): Promise<ActionResult> {
  return run(async () => {
    const { user, note, exists } = await noteForEdit(noteId);
    if (!note) return fail(exists ? "You can only edit your own notes." : "Note not found.");
    const parsed = noteBody.safeParse(body);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Write something first.");
    const db = await getDb();
    await db.update(schema.contactNotes).set({ body: parsed.data, updatedAt: new Date() }).where(eq(schema.contactNotes.id, note.id));
    await audit(user, "contact.note_edited", note.contactId, { note: note.id });
    refresh();
    return ok("Note saved");
  });
}

export async function pinNoteAction(noteId: string, pinned: boolean): Promise<ActionResult> {
  return run(async () => {
    const { user, note, exists } = await noteForEdit(noteId);
    if (!note) return fail(exists ? "You can only pin your own notes." : "Note not found.");
    const db = await getDb();
    await db.update(schema.contactNotes).set({ pinned: Boolean(pinned) }).where(eq(schema.contactNotes.id, note.id));
    await audit(user, pinned ? "contact.note_pinned" : "contact.note_unpinned", note.contactId, { note: note.id });
    refresh();
    return ok(pinned ? "Note pinned" : "Note unpinned");
  });
}

export async function deleteNoteAction(noteId: string): Promise<ActionResult> {
  return run(async () => {
    const { user, note, exists } = await noteForEdit(noteId);
    if (!note) return fail(exists ? "You can only delete your own notes." : "Note not found.");
    const db = await getDb();
    await db.delete(schema.contactNotes).where(eq(schema.contactNotes.id, note.id));
    await audit(user, "contact.note_deleted", note.contactId, { note: note.id });
    refresh();
    // The body goes back to the browser that just deleted it, so Undo can restore it.
    return ok("Note deleted", { contactId: note.contactId, body: note.body, pinned: note.pinned });
  });
}

// ---------------------------------------------------------------- tasks

const taskInput = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200, "Keep the title under 200 characters."),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  contactId: uuid.nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
});

export async function createTaskAction(input: z.input<typeof taskInput>): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("contacts.edit");
    const parsed = taskInput.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the task and try again.");
    const t = parsed.data;
    const db = await getDb();
    if (t.contactId && !(await ownedContactIds(db, user.workspace, [t.contactId])).length) return fail("Contact not found.");
    const assignee = t.assigneeUserId ?? user.id;
    if (assignee !== user.id && !(await isEditingMember(db, user.workspace, assignee))) return fail("That person can't be assigned tasks in this workspace.");
    const [task] = await db
      .insert(schema.tasks)
      .values({
        workspaceId: user.workspace.id,
        contactId: t.contactId ?? null,
        title: t.title,
        dueAt: t.dueAt ? new Date(t.dueAt) : null,
        assigneeUserId: assignee,
        createdByUserId: user.id,
      })
      .returning({ id: schema.tasks.id });
    await audit(user, "task.created", task.id, { contact: t.contactId ?? null, assignee });
    refresh();
    return ok("Task added", { id: task.id });
  });
}

async function taskInWorkspace(taskId: string) {
  const user = await guard("contacts.edit");
  if (!UUID_RE.test(taskId)) return { user, task: null };
  const db = await getDb();
  const [task] = await db
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.workspaceId, user.workspace.id), eq(schema.tasks.id, taskId)));
  return { user, task: task ?? null };
}

export async function setTaskDoneAction(taskId: string, done: boolean): Promise<ActionResult> {
  return run(async () => {
    const { user, task } = await taskInWorkspace(taskId);
    if (!task) return fail("Task not found.");
    const db = await getDb();
    await db
      .update(schema.tasks)
      .set({ doneAt: done ? new Date() : null })
      .where(eq(schema.tasks.id, task.id));
    await audit(user, done ? "task.completed" : "task.reopened", task.id);
    refresh();
    return ok(done ? "Task completed" : "Task reopened");
  });
}

export async function updateTaskAction(taskId: string, patch: { title?: string; dueAt?: string | null; assigneeUserId?: string | null }): Promise<ActionResult> {
  return run(async () => {
    const { user, task } = await taskInWorkspace(taskId);
    if (!task) return fail("Task not found.");
    const parsed = taskInput.partial().safeParse(patch);
    if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the task and try again.");
    const db = await getDb();
    const p = parsed.data;
    if (p.assigneeUserId && p.assigneeUserId !== user.id && !(await isEditingMember(db, user.workspace, p.assigneeUserId))) {
      return fail("That person can't be assigned tasks in this workspace.");
    }
    await db
      .update(schema.tasks)
      .set({
        ...(p.title !== undefined ? { title: p.title } : {}),
        ...(p.dueAt !== undefined ? { dueAt: p.dueAt ? new Date(p.dueAt) : null } : {}),
        ...(p.assigneeUserId !== undefined ? { assigneeUserId: p.assigneeUserId } : {}),
      })
      .where(eq(schema.tasks.id, task.id));
    await audit(user, "task.updated", task.id, { fields: Object.keys(p) });
    refresh();
    return ok("Task saved");
  });
}

export async function deleteTaskAction(taskId: string): Promise<ActionResult> {
  return run(async () => {
    const { user, task } = await taskInWorkspace(taskId);
    if (!task) return fail("Task not found.");
    const db = await getDb();
    await db.delete(schema.tasks).where(eq(schema.tasks.id, task.id));
    await audit(user, "task.deleted", task.id);
    refresh();
    return ok("Task deleted", {
      title: task.title,
      dueAt: task.dueAt?.toISOString() ?? null,
      contactId: task.contactId,
      assigneeUserId: task.assigneeUserId,
    });
  });
}

// ---------------------------------------------------------------- saved views

const viewFilters = z.record(z.string(), z.string().max(2000)).transform((f) => {
  const allowed = new Set<string>(VIEW_KEYS);
  return Object.fromEntries(Object.entries(f).filter(([k, v]) => allowed.has(k) && v));
});

export async function saveViewAction(name: string, filters: Record<string, string>): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.view");
    const clean = String(name ?? "").trim().slice(0, 60);
    const f = viewFilters.safeParse(filters);
    if (!clean) return fail("Name the view.");
    if (!f.success) return fail("That view can't be saved.");
    const db = await getDb();
    const [{ count }] = rows<{ count: string }>(
      await db.execute(sql`select count(*) count from contact_views where workspace_id = ${user.workspace.id} and user_id = ${user.id}`),
    );
    if (Number(count) >= 30) return fail("You can keep up to 30 views. Delete one first.");
    const [view] = await db
      .insert(schema.contactViews)
      .values({ workspaceId: user.workspace.id, userId: user.id, name: clean, filters: f.data })
      .returning({ id: schema.contactViews.id });
    await audit(user, "contact_view.created", view.id, { name: clean });
    refresh();
    return ok(`Saved “${clean}”`, { id: view.id });
  });
}

export async function updateViewAction(viewId: string, patch: { name?: string; filters?: Record<string, string> }): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.view");
    if (!UUID_RE.test(viewId)) return fail("View not found.");
    const f = patch.filters ? viewFilters.safeParse(patch.filters) : null;
    if (f && !f.success) return fail("That view can't be saved.");
    const name = patch.name?.trim().slice(0, 60);
    if (patch.name !== undefined && !name) return fail("Name the view.");
    const db = await getDb();
    const updated = await db
      .update(schema.contactViews)
      .set({ ...(name ? { name } : {}), ...(f?.success ? { filters: f.data } : {}) })
      .where(
        and(eq(schema.contactViews.workspaceId, user.workspace.id), eq(schema.contactViews.userId, user.id), eq(schema.contactViews.id, viewId)),
      )
      .returning({ id: schema.contactViews.id });
    if (!updated.length) return fail("View not found.");
    await audit(user, "contact_view.updated", viewId);
    refresh();
    return ok("View saved");
  });
}

export async function deleteViewAction(viewId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.view");
    if (!UUID_RE.test(viewId)) return fail("View not found.");
    const db = await getDb();
    const deleted = await db
      .delete(schema.contactViews)
      .where(
        and(eq(schema.contactViews.workspaceId, user.workspace.id), eq(schema.contactViews.userId, user.id), eq(schema.contactViews.id, viewId)),
      )
      .returning({ id: schema.contactViews.id });
    if (!deleted.length) return fail("View not found.");
    await audit(user, "contact_view.deleted", viewId);
    refresh();
    return ok("View deleted");
  });
}

// ---------------------------------------------------------------- bulk delete and export

export async function deleteContactsAction(contactIds: string[]): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("workspace.data");
    const parsed = ids.max(200).safeParse(contactIds);
    if (!parsed.success) return fail("Pick up to 200 contacts to delete at a time.");
    const db = await getDb();
    let deleted = 0;
    for (const id of await ownedContactIds(db, user.workspace, parsed.data)) {
      if (await eraseContact(db, user.workspace.id, id)) deleted++;
    }
    await audit(user, "contact.erased", `${deleted} contacts`, { via: "bulk", contacts: deleted });
    revalidatePath("/", "layout");
    return ok(`${deleted === 1 ? "1 contact" : `${deleted} contacts`} deleted. Their revenue is kept anonymously so your totals don't change.`, { deleted });
  });
}

/** CSV of the selected contacts (the same columns as the full export). Notes are never exported. */
export async function exportContactsAction(contactIds: string[]): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("reports.export");
    const parsed = ids.safeParse(contactIds);
    if (!parsed.success) return fail(`Pick between 1 and ${MAX_BULK} contacts to export.`);
    const db = await getDb();
    const ws = user.workspace;
    const exp = currencyExponent(ws.reportingCurrency);
    const result = rows<Record<string, string | number | null>>(
      await db.execute(sql`select c.id, c.email, c.name, c.lifecycle, c.first_seen_at, s.first_lead_at, s.first_touch_channel,
          cp.name first_campaign, coalesce(s.touches, 0) touches, coalesce(s.revenue_minor, 0) revenue
        from contacts c left join contact_stats s on s.contact_id = c.id left join campaigns cp on cp.id = s.first_touch_campaign_id
        where c.workspace_id = ${ws.id} and c.id in (${sql.join(parsed.data.map((i) => sql`${i}::uuid`), sql`, `)})
        order by c.first_seen_at desc`),
    );
    const header = "id,email,name,lifecycle,first_seen_at,first_lead_at,first_channel,first_campaign,touchpoints,revenue,revenue_minor,currency";
    const toIso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    const lines = result.map((r) =>
      [
        r.id as string,
        displayEmail(r.email as string | null, user),
        r.name as string | null,
        r.lifecycle as string,
        toIso(r.first_seen_at),
        toIso(r.first_lead_at),
        r.first_touch_channel as string | null,
        r.first_campaign as string | null,
        Number(r.touches),
        minorToDecimal(Number(r.revenue), exp),
        Number(r.revenue),
        ws.reportingCurrency,
      ]
        .map(csvCell)
        .join(","),
    );
    await audit(user, "contacts.exported", null, { via: "dashboard", selected: result.length });
    return ok(`Exported ${result.length === 1 ? "1 contact" : `${result.length} contacts`}`, { csv: `${[header, ...lines].join("\r\n")}\r\n` });
  });
}
