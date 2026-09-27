import { count, eq } from "drizzle-orm";
import { RolesPanel } from "@/components/settings/roles-panel";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { ALL_PERMISSIONS, canAssign, canEditRole } from "@/lib/permissions";
import { orgRolesCached } from "@/lib/roles";

export const metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  const user = await requireUser("roles.manage");
  const db = await getDb();
  const [roles, usage] = await Promise.all([
    orgRolesCached(user.organization.id),
    db
      .select({ role: schema.memberships.role, n: count() })
      .from(schema.memberships)
      .where(eq(schema.memberships.organizationId, user.organization.id))
      .groupBy(schema.memberships.role),
  ]);
  const members = new Map(usage.map((u) => [u.role, u.n]));
  return (
    <>
      <SettingsHeader
        title="Roles & permissions"
        description={`Decide what each role in ${user.organization.name} can open and do: hide pages, exports or settings from a role, or create your own roles.`}
      />
      <RolesPanel
        myRole={user.role}
        mine={ALL_PERMISSIONS.filter((p) => user.can(p))}
        roles={roles.map((r) => ({
          key: r.key,
          name: r.name,
          description: r.description,
          permissions: r.permissions,
          builtin: r.builtin,
          workspaceScoped: r.workspaceScoped,
          members: members.get(r.key) ?? 0,
          editable: canEditRole(user.roleDef, r),
          assignable: canAssign(user.roleDef, r),
        }))}
      />
    </>
  );
}
