import { SettingsHeader } from "@/components/settings/section";
import { WorkspaceGeneral } from "@/components/settings/workspace-general";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage() {
  const user = await requireUser();
  const ws = user.workspace;
  return (
    <>
      <SettingsHeader title="General" description="Settings for this workspace. Each client or brand gets its own workspace with separate data and integrations." />
      <WorkspaceGeneral
        workspace={{ name: ws.name, reportingCurrency: ws.reportingCurrency, timezone: ws.timezone, attributionWindowDays: ws.attributionWindowDays, isDemo: ws.isDemo }}
        canEdit={user.can("workspace.settings")}
        canData={user.can("workspace.data")}
      />
    </>
  );
}
