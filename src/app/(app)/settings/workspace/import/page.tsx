import { ImportPanel } from "@/components/settings/import-panel";
import { SettingsHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { publicUrl } from "@/lib/url";
import Link from "next/link";
import { ContactsImport } from "./contacts-import";

export const metadata = { title: "Import data" };

export default async function ImportPage() {
  const user = await requireUser("workspace.settings");
  const canMerge = user.can("workspace.data");
  return (
    <>
      <SettingsHeader
        title="Import data"
        description="Bring in contacts from another CRM, spend from any ad network we don’t connect to directly (Taboola, Outbrain, Quora, Amazon Ads, affiliates…) and payments from any checkout. Upload a CSV, or automate it with the API from Zapier, Make or n8n."
      >
        {canMerge ? (
          <Button variant="outline" size="sm" render={<Link href="/settings/workspace/duplicates" />}>
            Review duplicates
          </Button>
        ) : null}
      </SettingsHeader>
      <ContactsImport canMerge={canMerge} />
      <ImportPanel origin={await publicUrl()} currency={user.workspace.reportingCurrency} />
    </>
  );
}
