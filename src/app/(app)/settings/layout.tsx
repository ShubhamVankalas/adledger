import { PageHeader } from "@/components/page-header";
import { SettingsNav } from "@/components/settings/settings-nav";
import { requireUser } from "@/lib/auth";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Settings" description={`${user.organization.name} · ${user.workspace.name}`} />
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-1 gap-6 p-4 md:grid-cols-[220px_minmax(0,1fr)] md:p-6 xl:gap-10">
        <SettingsNav
          workspaceName={user.workspace.name}
          organizationName={user.organization.name}
          canWorkspace={user.can("workspace.settings")}
          canApi={user.can("apikeys.manage")}
          canMembers={user.can("members.manage")}
          canAudit={user.can("audit.view")}
        />
        <div className="min-w-0 space-y-6">{children}</div>
      </div>
    </>
  );
}
