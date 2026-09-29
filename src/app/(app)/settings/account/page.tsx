import { and, count, eq, gt, ne } from "drizzle-orm";
import { AccountForms } from "@/components/settings/account-forms";
import { SettingsHeader } from "@/components/settings/section";
import { TourCard } from "@/components/settings/tour-card";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { mediaUrl } from "@/lib/media";
import { roleLabel } from "@/lib/permissions";
import { orgRolesCached } from "@/lib/roles";

export const metadata = { title: "Profile" };

export default async function AccountPage() {
  const user = await requireUser();
  const db = await getDb();
  const [{ n: otherSessions }] = await db
    .select({ n: count() })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date()), ne(schema.sessions.id, user.sessionId)));
  const memberships = await db
    .select({ id: schema.organizations.id, org: schema.organizations.name, logoUpdatedAt: schema.organizations.logoUpdatedAt, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organizationId))
    .where(eq(schema.memberships.userId, user.id));
  const roleSets = await Promise.all(memberships.map((m) => orgRolesCached(m.id)));

  return (
    <>
      <SettingsHeader title="Profile" description="Your name, picture and appearance, and where you have access." />
      <AccountForms
        id={user.id}
        name={user.name ?? ""}
        email={user.email}
        avatarUrl={user.avatarUrl}
        memberships={memberships.map((m, i) => ({ id: m.id, org: m.org, logoUrl: mediaUrl("org", m.id, m.logoUpdatedAt), role: roleLabel(m.role, roleSets[i]) }))}
        has2fa={user.has2fa}
        otherSessions={otherSessions}
      />
      <TourCard completedOn={user.tourCompletedAt ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(user.tourCompletedAt) : null} />
    </>
  );
}
