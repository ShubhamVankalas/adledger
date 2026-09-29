import { AccessDenied, gatePage } from "@/components/access-denied";
import { ApiSection } from "@/components/settings/api-section";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { apiKeyRows } from "@/lib/developers";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "API keys" };

export default async function DeveloperKeysPage() {
  const denied = await gatePage("page.developers");
  if (denied) return denied;
  const user = await requireUser();
  if (!user.can("apikeys.manage")) return <AccessDenied user={user} />;
  const db = await getDb();
  const [origin, keys] = await Promise.all([publicUrl(), apiKeyRows(db, user.workspace.id)]);
  return <ApiSection origin={origin} canPii={user.can("export.contacts")} keys={keys} />;
}
