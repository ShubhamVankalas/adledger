import { desc, eq } from "drizzle-orm";
import { IntegrationsCatalog, type IntegrationState } from "@/components/settings/integrations-catalog";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { uploadStats } from "@/lib/capi";
import { allIntegrations } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";
import { oauthConfigured } from "@/lib/oauth/flow";
import { getConnection, secretKeysOf } from "@/lib/settings";
import { publicUrl } from "@/lib/url";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser("workspace.settings");
  const db = await getDb();
  const ws = user.workspace;
  const [origin, conns, runs, uploads] = await Promise.all([
    publicUrl(),
    db.select().from(schema.connections).where(eq(schema.connections.workspaceId, ws.id)),
    db.select().from(schema.syncRuns).where(eq(schema.syncRuns.workspaceId, ws.id)).orderBy(desc(schema.syncRuns.startedAt)).limit(100),
    uploadStats(db, ws.id),
  ]);
  const catalog = allIntegrations().filter((i) => i.category !== "notifications");
  const states: Record<string, IntegrationState> = {};
  for (const i of catalog) {
    const c = conns.find((x) => x.provider === i.provider);
    const full = c ? await getConnection(ws.id, i.provider, db) : undefined;
    const last = runs.find((r) => r.provider === i.provider);
    states[i.provider] = {
      connected: Boolean(c),
      mode: c?.mode ?? null,
      config: c && c.mode === "live" ? c.config : {},
      secretKeys: c?.mode === "live" ? secretKeysOf(full) : [],
      lastSyncedAt: c?.lastSyncedAt?.toISOString() ?? null,
      lastError: c?.lastError ?? null,
      lastRun: last ? { status: last.status, rows: last.rowsUpserted, at: last.startedAt.toISOString() } : null,
      uploads: uploadsFor(i.provider, c?.config ?? {}, uploads),
      webhookUrl:
        i.category === "revenue" ? (i.provider === "stripe" ? `${origin}/api/v1/webhooks/stripe/${ws.id}` : `${origin}/api/v1/webhooks/${i.provider}/${ws.id}`) : null,
      oauthReady: i.oauth ? oauthConfigured(i.provider) : false,
    };
  }
  const connectedCount = Object.values(states).filter((s) => s.connected).length;

  return (
    <>
      <SettingsHeader
        title="Integrations"
        description={`Connect ad platforms and payment tools. ${connectedCount} connected. Credentials are encrypted and never shown again after saving. Anything missing can come in through CSV or the API.`}
      />
      <IntegrationsCatalog integrations={catalog} states={states} forcedMock={process.env.CONNECTOR_MODE === "mock"} />
    </>
  );
}

/** Upload stats for the Meta / Google Ads dialogs, once uploads were switched on (or have history). */
function uploadsFor(provider: string, config: Record<string, string>, stats: Awaited<ReturnType<typeof uploadStats>>): IntegrationState["uploads"] {
  const key = provider === "meta" ? "meta" : provider === "google_ads" ? "google" : null;
  if (!key) return null;
  const s = stats[key];
  const enabled = ["on", "true"].includes(config[key === "meta" ? "capiEnabled" : "conversionUploads"] ?? "");
  return enabled || s.sent + s.failed + s.pending + s.skipped > 0 ? s : null;
}
