import { count, eq, inArray } from "drizzle-orm";
import { OrganizationPanel } from "@/components/settings/organization-panel";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

export const metadata = { title: "Organization" };

export default async function OrganizationPage() {
  const user = await requireUser();
  const db = await getDb();
  const ids = user.workspaces.map((w) => w.id);
  const [workspaces, contactCounts, memberCount] = await Promise.all([
    db.select().from(schema.workspaces).where(inArray(schema.workspaces.id, ids)),
    db
      .select({ ws: schema.contacts.workspaceId, n: count() })
      .from(schema.contacts)
      .where(inArray(schema.contacts.workspaceId, ids))
      .groupBy(schema.contacts.workspaceId),
    db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.organizationId, user.organization.id)),
  ]);
  return (
    <>
      <SettingsHeader
        title="Organization & workspaces"
        description="An organization is your business or agency. Create a workspace for each brand, store or client — each has its own tracking, integrations and reports."
      />
      <OrganizationPanel
        organization={{ id: user.organization.id, name: user.organization.name, logoUrl: user.organization.logoUrl, members: memberCount[0]?.n ?? 0 }}
        currentWorkspaceId={user.workspace.id}
        workspaces={workspaces
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map((w) => ({
            id: w.id,
            name: w.name,
            currency: w.reportingCurrency,
            timezone: w.timezone,
            isDemo: w.isDemo,
            contacts: contactCounts.find((c) => c.ws === w.id)?.n ?? 0,
            createdAt: w.createdAt.toISOString(),
          }))}
        defaults={{ currency: user.workspace.reportingCurrency, timezone: user.workspace.timezone }}
        canManageOrg={user.can("org.manage")}
        canBrandOrg={user.can("org.branding")}
        canManageWorkspaces={user.can("workspaces.manage")}
      />
    </>
  );
}
