import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { TOUCH_TARGETS } from "@/components/settings/touch";
import { requireUser } from "@/lib/auth";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <PageHeader
        title="Settings"
        description={user.organization.name === user.workspace.name ? user.workspace.name : `${user.organization.name} · ${user.workspace.name}`}
      />
      <div className="mx-auto grid w-full max-w-[1440px] grid-cols-1 gap-4 px-4 pt-3 pb-10 md:px-6 md:pt-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8 lg:pt-6 xl:gap-10 2xl:px-8">
        <SettingsNav
          workspaceName={user.workspace.name}
          organizationName={user.organization.name}
          canWorkspace={user.can("workspace.settings")}
          canApi={user.can("apikeys.manage")}
          canMembers={user.can("members.manage")}
          canAudit={user.can("audit.view")}
          canAlerts={user.can("alerts.manage")}
          canBrand={user.can("org.branding")}
          canShare={user.can("reports.share")}
          canRoles={user.can("roles.manage")}
          canDevelopers={user.can("page.developers")}
        />
        {/* Container queries (@…/settings) let each page adapt to the width it actually gets. */}
        <div className={`@container/settings min-w-0 space-y-5 md:space-y-6 ${TOUCH_TARGETS}`}>{children}</div>
      </div>
    </>
  );
}
