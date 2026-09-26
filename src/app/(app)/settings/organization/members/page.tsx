import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { MembersPanel } from "@/components/settings/members-panel";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { canAssignRole, ROLES } from "@/lib/permissions";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const user = await requireUser("members.manage");
  const db = await getDb();
  const orgId = user.organization.id;
  const [members, invites] = await Promise.all([
    db
      .select({ membership: schema.memberships, user: { id: schema.users.id, email: schema.users.email, name: schema.users.name, lastLoginAt: schema.users.lastLoginAt } })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, orgId))
      .orderBy(schema.memberships.createdAt),
    db
      .select()
      .from(schema.invitations)
      .where(and(eq(schema.invitations.organizationId, orgId), isNull(schema.invitations.acceptedAt), gt(schema.invitations.expiresAt, new Date())))
      .orderBy(desc(schema.invitations.createdAt)),
  ]);
  return (
    <>
      <SettingsHeader title="Members & roles" description="Invite teammates and clients. Roles apply to every workspace, except Clients, who only see the workspaces you pick." />
      <MembersPanel
        me={user.id}
        roles={ROLES.map((r) => ({ ...r, assignable: canAssignRole(user.role, r.role) }))}
        workspaces={user.workspaces.map((w) => ({ id: w.id, name: w.name }))}
        members={members.map((m) => ({
          id: m.membership.id,
          userId: m.user.id,
          email: m.user.email,
          name: m.user.name,
          role: m.membership.role,
          workspaceIds: m.membership.workspaceIds,
          lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
          editable: m.user.id !== user.id && canAssignRole(user.role, m.membership.role),
        }))}
        invites={invites.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
      />
    </>
  );
}
