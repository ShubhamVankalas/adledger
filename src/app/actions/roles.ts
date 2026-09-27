"use server";

import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit, type SessionUser } from "@/lib/auth";
import { randomToken } from "@/lib/crypto";
import { getDb, schema } from "@/lib/db";
import { canAssign, canEditRole, findRoleDef, isPermission, type Permission, type RoleDef } from "@/lib/permissions";
import { deleteRoleRow, listOrgRoles, saveRoleRow } from "@/lib/roles";

// Settings → Organization → Roles & permissions. Owner is fixed; nobody can grant a permission they
// don't hold themselves; a role in use can only be deleted by moving its members to another role.

type Input = { name: string; description: string; permissions: Permission[]; workspaceScoped: boolean };

function readForm(form: FormData): Input | string {
  const name = str(form, "name").slice(0, 40);
  if (!name) return "Give the role a name.";
  const permissions = [...new Set(form.getAll("permissions").map(String).filter(isPermission))];
  return { name, description: str(form, "description").slice(0, 200), permissions, workspaceScoped: form.get("workspaceScoped") === "on" };
}

/** Owners hold everything; others can't hand out what they don't have. */
function escalation(user: SessionUser, permissions: Permission[]): string | null {
  const missing = permissions.filter((p) => !user.can(p));
  return missing.length ? "You can't give a role permissions your own role doesn't have." : null;
}

function nameTaken(roles: RoleDef[], name: string, exceptKey?: string) {
  return roles.some((r) => r.key !== exceptKey && r.name.trim().toLowerCase() === name.trim().toLowerCase());
}

async function usage(organizationId: string, key: string) {
  const db = await getDb();
  const [[m], [i]] = await Promise.all([
    db.select({ n: count() }).from(schema.memberships).where(and(eq(schema.memberships.organizationId, organizationId), eq(schema.memberships.role, key))),
    db
      .select({ n: count() })
      .from(schema.invitations)
      .where(and(eq(schema.invitations.organizationId, organizationId), eq(schema.invitations.role, key), isNull(schema.invitations.acceptedAt))),
  ]);
  return { members: m?.n ?? 0, invites: i?.n ?? 0 };
}

export async function createRoleAction(form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("roles.manage");
    const input = readForm(form);
    if (typeof input === "string") return fail(input);
    const err = escalation(user, input.permissions);
    if (err) return fail(err);
    const db = await getDb();
    const roles = await listOrgRoles(db, user.organization.id);
    if (nameTaken(roles, input.name)) return fail("A role with that name already exists.");
    const key = `custom-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    await saveRoleRow(db, user.organization.id, { key, ...input });
    await audit(user, "role.created", input.name, { key, permissions: input.permissions.length });
    revalidatePath("/", "layout");
    return ok(`Role “${input.name}” created.`, { key });
  });
}

export async function updateRoleAction(key: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("roles.manage");
    const input = readForm(form);
    if (typeof input === "string") return fail(input);
    const db = await getDb();
    const roles = await listOrgRoles(db, user.organization.id);
    const target = findRoleDef(roles, key);
    if (!target) return fail("Role not found.");
    if (target.key === "owner") return fail("The Owner role always has every permission and can't be changed.");
    if (!canEditRole(user.roleDef, target)) return fail("This role has permissions your own role doesn't have, so you can't change it.");
    const err = escalation(user, input.permissions);
    if (err) return fail(err);
    if (nameTaken(roles, input.name, key)) return fail("A role with that name already exists.");
    if (input.workspaceScoped !== target.workspaceScoped) {
      const { members, invites } = await usage(user.organization.id, key);
      // Limiting existing members to "some workspaces" needs a per-person choice: do it on a fresh role.
      if (input.workspaceScoped && members + invites > 0) {
        return fail("People already have this role. To limit them to selected workspaces, create a new workspace-limited role and move them to it.");
      }
      if (!input.workspaceScoped) {
        await db
          .update(schema.memberships)
          .set({ workspaceIds: null })
          .where(and(eq(schema.memberships.organizationId, user.organization.id), eq(schema.memberships.role, key)));
      }
    }
    await saveRoleRow(db, user.organization.id, { key, ...input });
    const added = input.permissions.filter((p) => !target.permissions.includes(p));
    const removed = target.permissions.filter((p) => !input.permissions.includes(p));
    await audit(user, "role.updated", input.name, { key, added, removed, workspaceScoped: input.workspaceScoped });
    revalidatePath("/", "layout");
    return ok(`Role “${input.name}” saved. Changes apply on each member's next page load.`);
  });
}

export async function duplicateRoleAction(key: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("roles.manage");
    const db = await getDb();
    const roles = await listOrgRoles(db, user.organization.id);
    const source = findRoleDef(roles, key);
    if (!source) return fail("Role not found.");
    const permissions = source.permissions.filter((p) => user.can(p));
    let name = `${source.name} copy`.slice(0, 40);
    for (let n = 2; nameTaken(roles, name); n++) name = `${source.name} copy ${n}`.slice(0, 40);
    const newKey = `custom-${randomToken(6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    await saveRoleRow(db, user.organization.id, { key: newKey, name, description: source.description, permissions, workspaceScoped: source.workspaceScoped });
    await audit(user, "role.created", name, { key: newKey, from: source.key });
    revalidatePath("/", "layout");
    return ok(`Created “${name}”.`, { key: newKey });
  });
}

/**
 * Delete a role. When members or pending invitations use it, `replacement` names the role they move
 * to (the actor must be allowed to assign it).
 */
export async function deleteRoleAction(key: string, replacement: string | null): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("roles.manage");
    const db = await getDb();
    const roles = await listOrgRoles(db, user.organization.id);
    const target = findRoleDef(roles, key);
    if (!target) return fail("Role not found.");
    if (target.key === "owner") return fail("The Owner role can't be deleted.");
    if (!canEditRole(user.roleDef, target)) return fail("This role has permissions your own role doesn't have, so you can't delete it.");
    if (key === user.role) return fail("You can't delete your own role. Ask someone else, or move yourself to another role first.");
    const { members, invites } = await usage(user.organization.id, key);
    let moveTo: RoleDef | null = null;
    if (members + invites > 0) {
      moveTo = replacement ? findRoleDef(roles, replacement) : null;
      if (!moveTo || moveTo.key === key) return fail("Choose the role its members should move to.");
      if (!canAssign(user.roleDef, moveTo)) return fail("You can only move members to a role with permissions you have yourself.");
      if (moveTo.workspaceScoped && !target.workspaceScoped) {
        return fail("Move them to a role with access to every workspace, or change members one by one in Members.");
      }
    }
    await db.transaction(async (tx) => {
      if (moveTo) {
        const keepWorkspaces = moveTo.workspaceScoped;
        await tx
          .update(schema.memberships)
          .set(keepWorkspaces ? { role: moveTo.key } : { role: moveTo.key, workspaceIds: null })
          .where(and(eq(schema.memberships.organizationId, user.organization.id), eq(schema.memberships.role, key)));
        await tx
          .update(schema.invitations)
          .set(keepWorkspaces ? { role: moveTo.key } : { role: moveTo.key, workspaceIds: null })
          .where(and(eq(schema.invitations.organizationId, user.organization.id), inArray(schema.invitations.role, [key]), isNull(schema.invitations.acceptedAt)));
      }
      await deleteRoleRow(tx, user.organization.id, target);
    });
    await audit(user, "role.deleted", target.name, { key, movedTo: moveTo?.key ?? null, members });
    revalidatePath("/", "layout");
    return ok(moveTo ? `Role “${target.name}” deleted. ${members} ${members === 1 ? "member" : "members"} moved to ${moveTo.name}.` : `Role “${target.name}” deleted.`);
  });
}
