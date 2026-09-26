import { PrivacySection } from "@/components/settings/privacy-section";
import { SettingsHeader } from "@/components/settings/section";
import { WorkspaceGeneral } from "@/components/settings/workspace-general";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getRetention, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "@/lib/privacy";

export const metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage() {
  const user = await requireUser();
  const ws = user.workspace;
  const retention = await getRetention(await getDb(), ws.id);
  return (
    <>
      <SettingsHeader title="General" description="Settings for this workspace. Each client or brand gets its own workspace with separate data and integrations." />
      <WorkspaceGeneral
        workspace={{ name: ws.name, reportingCurrency: ws.reportingCurrency, timezone: ws.timezone, attributionWindowDays: ws.attributionWindowDays, isDemo: ws.isDemo }}
        canEdit={user.can("workspace.settings")}
        canData={user.can("workspace.data")}
      />
      <PrivacySection retention={retention} canData={user.can("workspace.data")} minDays={RETENTION_MIN_DAYS} maxDays={RETENTION_MAX_DAYS} />
    </>
  );
}
