import { redirect } from "next/navigation";
import { ApiSection } from "@/components/settings/api-section";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiKeyRows } from "@/lib/developers";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "API & MCP" };

// API keys moved to Developers → API keys. Roles that manage keys without the Developers page
// (Analyst by default) keep this page, so moving it didn't take anything away from them.
export default async function ApiPage() {
  const user = await requireUser("apikeys.manage");
  if (user.can("page.developers")) redirect("/developers/keys");
  const db = await getDb();
  return (
    <>
      <SettingsHeader title="API & MCP" description="Keys for scripts, dashboards and AI agents. Pick what each key may read or write." />
      <ApiSection origin={await publicUrl()} canPii={user.can("export.contacts")} keys={await apiKeyRows(db, user.workspace.id)} />
    </>
  );
}
