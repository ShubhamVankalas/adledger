import { desc, eq } from "drizzle-orm";
import { ApiSection } from "@/components/settings/api-section";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "API & MCP" };

export default async function ApiPage() {
  const user = await requireUser("apikeys.manage");
  const db = await getDb();
  const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, user.workspace.id)).orderBy(desc(schema.apiKeys.createdAt));
  return (
    <>
      <SettingsHeader title="API & MCP" description="API keys give read access to this workspace's reports and write access to the Spend and Conversions APIs." />
      <ApiSection
        origin={await publicUrl()}
        keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revoked: Boolean(k.revokedAt) }))}
      />
    </>
  );
}
