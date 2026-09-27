import { ImportPanel } from "@/components/settings/import-panel";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "Import data" };

export default async function ImportPage() {
  const user = await requireUser("workspace.settings");
  return (
    <>
      <SettingsHeader
        title="Import data"
        description="Bring in spend from any ad network we don’t connect to directly (Taboola, Outbrain, Quora, Amazon Ads, affiliates…) and payments from any checkout. Upload a CSV, or automate it with the API from Zapier, Make or n8n."
      />
      <ImportPanel origin={await publicUrl()} currency={user.workspace.reportingCurrency} />
    </>
  );
}
