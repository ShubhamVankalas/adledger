import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema, type DB } from "./db";
import type { BuiltinRole } from "./db/schema";
import { BUILTIN_ROLES, isBuiltinRole, isPermission, type RoleDef } from "./permissions";

// An organization's roles: the built-in defaults from lib/permissions.ts, overridden or deleted by
// org_roles rows, plus custom roles. Built-ins without a row follow the code defaults (so a new
// permission added to the matrix reaches every organization that never edited that role).

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

export type OrgRole = RoleDef & { id: string | null };

type Row = typeof schema.orgRoles.$inferSelect;

function fromRow(r: Row): OrgRole {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.permissions.filter(isPermission),
    builtin: Boolean(r.base),
    workspaceScoped: r.workspaceScoped,
  };
}

/** Every live role of an organization: built-ins first (Owner always), then custom roles by name. */
export async function listOrgRoles(db: Q, organizationId: string): Promise<OrgRole[]> {
  const rows = await db.select().from(schema.orgRoles).where(eq(schema.orgRoles.organizationId, organizationId));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const builtins: OrgRole[] = [];
  for (const b of BUILTIN_ROLES) {
    const row = byKey.get(b.key);
    // Owner is fixed: a stored row (there shouldn't be one) is ignored.
    if (b.key === "owner" || !row) builtins.push({ ...b, id: null });
    else if (!row.deletedAt) builtins.push(fromRow(row));
  }
  const custom = rows
    .filter((r) => !r.base && !r.deletedAt && !isBuiltinRole(r.key))
    .map(fromRow)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...builtins, ...custom];
}

/** Per-request cached copy for the session (React.cache; a plain call outside a render). */
export const orgRolesCached = cache(async (organizationId: string) => listOrgRoles(await getDb(), organizationId));

/** One role of an organization (null when deleted or unknown). */
export async function getOrgRole(db: Q, organizationId: string, key: string): Promise<OrgRole | null> {
  return (await listOrgRoles(db, organizationId)).find((r) => r.key === key) ?? null;
}

/** Insert or replace the row that defines `key` (a built-in override or a custom role). */
export async function saveRoleRow(
  db: Q,
  organizationId: string,
  role: { key: string; name: string; description: string; permissions: string[]; workspaceScoped: boolean },
) {
  const base: BuiltinRole | null = isBuiltinRole(role.key) ? role.key : null;
  const now = new Date();
  await db
    .insert(schema.orgRoles)
    .values({ organizationId, key: role.key, name: role.name, description: role.description, permissions: role.permissions, workspaceScoped: role.workspaceScoped, base })
    .onConflictDoUpdate({
      target: [schema.orgRoles.organizationId, schema.orgRoles.key],
      set: { name: role.name, description: role.description, permissions: role.permissions, workspaceScoped: role.workspaceScoped, base, updatedAt: now, deletedAt: null },
    });
}

/** Mark a role deleted (built-in: a tombstone row; custom: deleted_at). */
export async function deleteRoleRow(db: Q, organizationId: string, role: RoleDef) {
  const [existing] = await db
    .select({ id: schema.orgRoles.id })
    .from(schema.orgRoles)
    .where(and(eq(schema.orgRoles.organizationId, organizationId), eq(schema.orgRoles.key, role.key)));
  if (existing) {
    await db.update(schema.orgRoles).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(schema.orgRoles.id, existing.id));
    return;
  }
  await saveRoleRow(db, organizationId, role);
  await db
    .update(schema.orgRoles)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.orgRoles.organizationId, organizationId), eq(schema.orgRoles.key, role.key)));
}
