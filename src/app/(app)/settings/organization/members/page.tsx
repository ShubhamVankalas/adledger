import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { MembersPanel } from "@/components/settings/members-panel";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { mediaUrl } from "@/lib/media";
import { canAssign, findRoleDef } from "@/lib/permissions";
import { orgRolesCached } from "@/lib/roles";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const user = await requireUser("members.manage");
  const db = await getDb();
  const orgId = user.organization.id;
  const [members, invites, roles] = await Promise.all([
    db
      .select({ membership: schema.memberships, user: { id: schema.users.id, email: schema.users.email, name: schema.users.name, lastLoginAt: schema.users.lastLoginAt, avatarUpdatedAt: schema.users.avatarUpdatedAt } })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, orgId))
      .orderBy(schema.memberships.createdAt),
    db
      .select()
      .from(schema.invitations)
      .where(and(eq(schema.invitations.organizationId, orgId), isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, new Date())))
      .orderBy(desc(schema.invitations.createdAt)),
    orgRolesCached(orgId),
  ]);
  return (
    <>
      <SettingsHeader title="Members & roles" description="Invite teammates and clients. Roles apply to every workspace, except workspace-limited roles like Client, who only see the workspaces you pick." />
      <MembersPanel
        me={user.id}
        canManageRoles={user.can("roles.manage")}
        roles={roles.map((r) => ({ role: r.key, label: r.name, description: r.description, workspaceScoped: r.workspaceScoped, assignable: canAssign(user.roleDef, r) }))}
        workspaces={user.workspaces.map((w) => ({ id: w.id, name: w.name }))}
        members={members.map((m) => ({
          id: m.membership.id,
          userId: m.user.id,
          email: m.user.email,
          name: m.user.name,
          avatarUrl: mediaUrl("user", m.user.id, m.user.avatarUpdatedAt),
          role: m.membership.role,
          workspaceIds: m.membership.workspaceIds,
          lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
          editable: m.user.id !== user.id && (() => {
            const def = findRoleDef(roles, m.membership.role);
            return def ? canAssign(user.roleDef, def) : user.can("members.manage");
          })(),
        }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
      />
    </>
  );
}
