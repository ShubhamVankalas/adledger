import { and, desc, eq, gt } from "drizzle-orm";
import { AccountForms } from "@/components/settings/account-forms";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser();
  const db = await getDb();
  const sessions = await db
    .select({ id: schema.sessions.id, createdAt: schema.sessions.createdAt, expiresAt: schema.sessions.expiresAt, workspace: schema.workspaces.name })
    .from(schema.sessions)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.sessions.workspaceId))
    .where(and(eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.createdAt));
  const memberships = await db
    .select({ org: schema.organizations.name, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, user.id));

  return (
    <>
      <SettingsHeader title="Profile & security" description="Your personal details, password and the devices you're signed in on." />
      <AccountForms
        name={user.name ?? ""}
        email={user.email}
        memberships={memberships.map((m) => ({ org: m.org, role: roleLabel(m.role) }))}
        sessions={sessions.map((s) => ({ id: s.id, createdAt: s.createdAt.toISOString(), workspace: s.workspace, current: s.id === user.sessionId }))}
      />
    </>
  );
}
