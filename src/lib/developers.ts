import { and, desc, eq, getTableColumns, gt, isNull, sql } from "drizzle-orm";
import { schema, type DB } from "./db";
import type { Permission } from "./permissions";

// Shared data for the Developers area (src/app/(app)/developers) and the legacy API page.

/** Tabs of the Developers area; `permission` hides a tab (and gates its page) for roles without it. */
export const DEVELOPER_TABS: { href: string; label: string; permission?: Permission }[] = [
  { href: "/developers", label: "Overview" },
  { href: "/developers/keys", label: "API keys", permission: "apikeys.manage" },
  { href: "/developers/webhooks", label: "Webhooks", permission: "developers.access" },
  { href: "/developers/reference", label: "API reference" },
  { href: "/developers/recipes", label: "Recipes" },
];

/** API keys of a workspace as the key list renders them. */
export async function apiKeyRows(db: DB, workspaceId: string) {
  const keys = await db
    .select({ ...getTableColumns(schema.apiKeys), expired: sql<boolean>`coalesce(${schema.apiKeys.expiresAt} <= now(), false)` })
    .from(schema.apiKeys)
    .where(eq(schema.apiKeys.workspaceId, workspaceId))
    .orderBy(desc(schema.apiKeys.createdAt));
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revoked: Boolean(k.revokedAt),
    scopes: k.scopes,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    expired: k.expired,
  }));
}

/** Numbers for the Developers overview. */
export async function developerStats(db: DB, workspaceId: string) {
  const since = new Date(Date.now() - 86_400_000);
  const d = schema.webhookDeliveries;
  const [keys, endpoints, deliveries] = await Promise.all([
    db.$count(schema.apiKeys, and(eq(schema.apiKeys.workspaceId, workspaceId), isNull(schema.apiKeys.revokedAt), sql`(${schema.apiKeys.expiresAt} is null or ${schema.apiKeys.expiresAt} > now())`)),
    db.$count(schema.webhookEndpoints, and(eq(schema.webhookEndpoints.workspaceId, workspaceId), eq(schema.webhookEndpoints.enabled, true))),
    db
      .select({ status: d.status, n: sql<number>`count(*)::int` })
      .from(d)
      .where(and(eq(d.workspaceId, workspaceId), gt(d.createdAt, since)))
      .groupBy(d.status),
  ]);
  const by = (s: string) => deliveries.find((r) => r.status === s)?.n ?? 0;
  return { activeKeys: keys, activeEndpoints: endpoints, delivered24h: by("delivered"), failed24h: by("failed"), pending: by("pending") };
}
