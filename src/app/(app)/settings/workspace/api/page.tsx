import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { ApiSection } from "@/components/settings/api-section";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "API & MCP" };

export default async function ApiPage() {
  const user = await requireUser("apikeys.manage");
  const db = await getDb();
  const keys = await db
    .select({ ...getTableColumns(schema.apiKeys), expired: sql<boolean>`coalesce(${schema.apiKeys.expiresAt} <= now(), false)` })
    .from(schema.apiKeys).where(eq(schema.apiKeys.workspaceId, user.workspace.id)).orderBy(desc(schema.apiKeys.createdAt));
  return (
    <>
      <SettingsHeader title="API & MCP" description="Keys for scripts, dashboards and AI agents. Pick what each key may read or write." />
      <ApiSection
        origin={await publicUrl()}
        canPii={user.can("export.contacts")}
        keys={keys.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revoked: Boolean(k.revokedAt),
          scopes: k.scopes,
          expiresAt: k.expiresAt?.toISOString() ?? null,
          expired: k.expired,
        }))}
      />
    </>
  );
}
