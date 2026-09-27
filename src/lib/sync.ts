import { eq, sql } from "drizzle-orm";
import { recomputeAttribution } from "./attribution";
import type { AdDayRow, DateWindow } from "./connectors/types";
import { ADS_CONNECTORS, getAdsConnector, getRevenueConnector } from "./connectors/registry";
import { getLeadConnector } from "./connectors/leads/index";
import { ingestRevenue } from "./connectors/revenue/ingest";
import { backfillStripe } from "./connectors/stripe";
import { schema, type DB } from "./db";
import type { Provider } from "./db/schema";
import { DAY, isoDate } from "./demo/world";
import { requestAttribution } from "./jobs";
import { log } from "./log";
import { notifyLater } from "./notify";
import { matchTouchpoints } from "./matching";
import { forcedMockMode, getConnection } from "./settings";

/** Default window: yesterday + trailing 7 days (platforms restate recent data). */
export function defaultWindow(now = new Date()): DateWindow {
  return { since: isoDate(new Date(now.getTime() - 8 * DAY)), until: isoDate(now) };
}

/** Upsert accounts/campaigns/ad groups/ads and daily insights. Idempotent. */
export async function upsertAdRows(db: DB, workspaceId: string, rows: AdDayRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const accountIds = new Map<string, string>();
  const campaignIds = new Map<string, string>();
  const groupIds = new Map<string, string>();
  const adIds = new Map<string, string>();
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const r of rows) {
      const aKey = `${r.platform}:${r.account.externalId}`;
      if (!accountIds.has(aKey)) {
        const [a] = await tx
          .insert(schema.adAccounts)
          .values({ workspaceId, platform: r.platform, externalId: r.account.externalId, name: r.account.name, currency: r.account.currency, timezone: r.account.timezone, status: "active", lastSyncedAt: now })
          .onConflictDoUpdate({
            target: [schema.adAccounts.workspaceId, schema.adAccounts.platform, schema.adAccounts.externalId],
            set: { name: r.account.name, currency: r.account.currency, timezone: r.account.timezone, lastSyncedAt: now },
          })
          .returning({ id: schema.adAccounts.id });
        accountIds.set(aKey, a.id);
      }
      const cKey = `${r.platform}:${r.campaign.externalId}`;
      if (!campaignIds.has(cKey)) {
        const [c] = await tx
          .insert(schema.campaigns)
          .values({ workspaceId, adAccountId: accountIds.get(aKey)!, platform: r.platform, externalId: r.campaign.externalId, name: r.campaign.name, status: r.campaign.status, objective: r.campaign.objective })
          .onConflictDoUpdate({
            target: [schema.campaigns.workspaceId, schema.campaigns.platform, schema.campaigns.externalId],
            set: {
              name: r.campaign.name,
              status: sql`coalesce(excluded.status, ${schema.campaigns.status})`,
              objective: sql`coalesce(excluded.objective, ${schema.campaigns.objective})`,
            },
          })
          .returning({ id: schema.campaigns.id });
        campaignIds.set(cKey, c.id);
      }
      const gKey = `${r.platform}:${r.adGroup.externalId}`;
      if (!groupIds.has(gKey)) {
        const [g] = await tx
          .insert(schema.adGroups)
          .values({ workspaceId, campaignId: campaignIds.get(cKey)!, platform: r.platform, externalId: r.adGroup.externalId, name: r.adGroup.name, status: r.adGroup.status })
          .onConflictDoUpdate({
            target: [schema.adGroups.workspaceId, schema.adGroups.platform, schema.adGroups.externalId],
            set: { name: r.adGroup.name, campaignId: campaignIds.get(cKey)!, status: sql`coalesce(excluded.status, ${schema.adGroups.status})` },
          })
          .returning({ id: schema.adGroups.id });
        groupIds.set(gKey, g.id);
      }
      const adKey = `${r.platform}:${r.ad.externalId}`;
      if (!adIds.has(adKey)) {
        const [ad] = await tx
          .insert(schema.ads)
          .values({ workspaceId, adGroupId: groupIds.get(gKey)!, campaignId: campaignIds.get(cKey)!, platform: r.platform, externalId: r.ad.externalId, name: r.ad.name, status: r.ad.status })
          .onConflictDoUpdate({
            target: [schema.ads.workspaceId, schema.ads.platform, schema.ads.externalId],
            set: { name: r.ad.name, adGroupId: groupIds.get(gKey)!, campaignId: campaignIds.get(cKey)!, status: sql`coalesce(excluded.status, ${schema.ads.status})` },
          })
          .returning({ id: schema.ads.id });
        adIds.set(adKey, ad.id);
      }
    }

    const insightRows = rows.map((r) => ({
      workspaceId,
      platform: r.platform,
      date: r.date,
      adAccountId: accountIds.get(`${r.platform}:${r.account.externalId}`)!,
      campaignId: campaignIds.get(`${r.platform}:${r.campaign.externalId}`)!,
      adGroupId: groupIds.get(`${r.platform}:${r.adGroup.externalId}`)!,
      adId: adIds.get(`${r.platform}:${r.ad.externalId}`)!,
      spendMinor: r.spendMinor,
      currency: r.account.currency,
      impressions: r.impressions,
      clicks: r.clicks,
      platformConversions: r.conversions,
      platformConversionValueMinor: r.conversionValueMinor ?? null,
    }));
    for (let i = 0; i < insightRows.length; i += 500) {
      await tx
        .insert(schema.adInsightsDaily)
        .values(insightRows.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [schema.adInsightsDaily.workspaceId, schema.adInsightsDaily.platform, schema.adInsightsDaily.adId, schema.adInsightsDaily.date],
          set: {
            spendMinor: sql`excluded.spend_minor`,
            currency: sql`excluded.currency`,
            impressions: sql`excluded.impressions`,
            clicks: sql`excluded.clicks`,
            platformConversions: sql`excluded.platform_conversions`,
            platformConversionValueMinor: sql`excluded.platform_conversion_value_minor`,
            campaignId: sql`excluded.campaign_id`,
            adGroupId: sql`excluded.ad_group_id`,
          },
        });
    }
  });
  return rows.length;
}

export type SyncResult = { provider: Provider; status: "success" | "error" | "skipped"; rows: number; error?: string };

/**
 * Sync one provider for the workspace. Records a sync_run, never throws.
 * `inlineAttribution` recomputes synchronously (used by setup/demo); otherwise it's debounced.
 */
export async function syncProvider(
  db: DB,
  workspaceId: string,
  provider: Provider,
  opts: { window?: DateWindow; backfillDays?: number; inlineAttribution?: boolean } = {},
): Promise<SyncResult> {
  const conn = await getConnection(workspaceId, provider, db);
  if (!conn || !conn.enabled) return { provider, status: "skipped", rows: 0 };
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return { provider, status: "skipped", rows: 0 };
  const mock = forcedMockMode() || conn.mode === "mock";
  const [run] = await db
    .insert(schema.syncRuns)
    .values({ workspaceId, provider, status: "running" })
    .returning({ id: schema.syncRuns.id });

  try {
    let n = 0;
    const ads = getAdsConnector(provider);
    const revenue = getRevenueConnector(provider);
    if (provider === "stripe") {
      n = await backfillStripe(db, workspaceId, conn, { days: opts.backfillDays ?? 90, mock, currency: ws.reportingCurrency });
    } else if (revenue) {
      if (!revenue.backfill || mock) {
        n = 0; // webhook-only source (or demo mode): nothing to pull
      } else {
        const events = await revenue.backfill(conn, { sinceMs: Date.now() - (opts.backfillDays ?? 90) * DAY });
        n = await ingestRevenue(db, workspaceId, revenue.source, events);
      }
    } else if (ads) {
      const window =
        opts.window ??
        (mock && conn.config.demoAnchor && !conn.lastSyncedAt
          ? { since: isoDate(new Date(Date.parse(conn.config.demoAnchor) - 89 * DAY)), until: conn.config.demoAnchor }
          : defaultWindow());
      const rows = mock ? ads.mock(window, ws.reportingCurrency) : await ads.fetchLive(conn, window);
      n = await upsertAdRows(db, workspaceId, rows);
      await matchTouchpoints(db, workspaceId);
    } else if (getLeadConnector(provider)) {
      n = 0; // native lead forms arrive by webhook only
    } else {
      throw new Error(`${provider} has nothing to sync`);
    }
    const finished = new Date();
    await db.update(schema.syncRuns).set({ status: "success", finishedAt: finished, rowsUpserted: n }).where(eq(schema.syncRuns.id, run.id));
    await db.update(schema.connections).set({ lastSyncedAt: finished, lastError: null }).where(eq(schema.connections.id, conn.id));
    if (opts.inlineAttribution) await recomputeAttribution(db, workspaceId);
    else await requestAttribution(workspaceId);
    return { provider, status: "success", rows: n };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`sync ${provider} failed`, err);
    await db.update(schema.syncRuns).set({ status: "error", finishedAt: new Date(), error: message.slice(0, 1000) }).where(eq(schema.syncRuns.id, run.id));
    await db.update(schema.connections).set({ lastError: message.slice(0, 1000) }).where(eq(schema.connections.id, conn.id));
    notifyLater(workspaceId, "sync_failed", () => ({
      title: `${provider} sync failed`,
      text: `The last sync returned an error:\n- ${message.slice(0, 300)}\n\nCheck the credentials in Settings → Integrations.`,
      severity: "critical",
      url: process.env.PUBLIC_URL ? `${process.env.PUBLIC_URL.replace(/\/$/, "")}/settings/workspace/integrations` : undefined,
    }), db);
    return { provider, status: "error", rows: 0, error: message };
  }
}

/** Scheduled: sync every enabled live ad connection (Stripe arrives via webhooks; demo data stays frozen). */
export async function syncAll(db: DB, workspaceId: string) {
  const results: SyncResult[] = [];
  for (const p of ADS_CONNECTORS.map((c) => c.meta.provider)) {
    const conn = await getConnection(workspaceId, p, db);
    if (!conn || conn.mode === "mock") continue;
    results.push(await syncProvider(db, workspaceId, p));
  }
  return results;
}
