import { adDayMetrics, dateRange, demoAdsFor } from "../../demo/world";
import { fromMicros } from "../../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "../types";

// Pinterest API v5: GET /ad_accounts/{id}/ads/analytics (granularity=DAY, ≤100 ad ids per call).
// Spend is SPEND_IN_MICRO_DOLLAR — micro-units of the ad account's currency despite the name.
// Docs: https://developers.pinterest.com/docs/api/v5/ads-analytics/

const COLUMNS = ["SPEND_IN_MICRO_DOLLAR", "PAID_IMPRESSION", "CLICKTHROUGH_1", "TOTAL_CONVERSIONS"];
const MAX_DAYS = 90;
const MAX_ADS = 100;

export type PinterestAnalyticsRow = {
  AD_ID: string;
  DATE: string; // YYYY-MM-DD
  SPEND_IN_MICRO_DOLLAR?: number | string;
  PAID_IMPRESSION?: number;
  CLICKTHROUGH_1?: number;
  TOTAL_CONVERSIONS?: number;
};

type Page<T> = { items: T[]; bookmark?: string | null };
export type PinterestEntities = {
  adAccount: { id: string; name: string; currency: string };
  campaigns: Page<{ id: string; name: string; status?: string; objective_type?: string }>[];
  adGroups: Page<{ id: string; name: string; status?: string; campaign_id: string }>[];
  ads: Page<{ id: string; name?: string | null; status?: string; ad_group_id: string; campaign_id: string; pin_id?: string }>[];
};

export function parsePinterestAnalytics(rows: PinterestAnalyticsRow[], entities: PinterestEntities): AdDayRow[] {
  const acc = entities.adAccount;
  const currency = acc.currency.toUpperCase();
  const campaigns = new Map(entities.campaigns.flatMap((p) => p.items).map((c) => [c.id, c]));
  const groups = new Map(entities.adGroups.flatMap((p) => p.items).map((g) => [g.id, g]));
  const ads = new Map(entities.ads.flatMap((p) => p.items).map((a) => [a.id, a]));
  return rows.map((r) => {
    const adId = String(r.AD_ID);
    const ad = ads.get(adId);
    const group = ad ? groups.get(ad.ad_group_id) : undefined;
    const campaign = ad ? campaigns.get(ad.campaign_id) : undefined;
    return {
      platform: "pinterest",
      account: { externalId: acc.id, name: acc.name, currency, timezone: null },
      campaign: { externalId: ad?.campaign_id ?? "", name: campaign?.name ?? "Unknown campaign", status: campaign?.status ?? null, objective: campaign?.objective_type ?? null },
      adGroup: { externalId: ad?.ad_group_id ?? "", name: group?.name ?? "Unknown ad group", status: group?.status ?? null },
      ad: { externalId: adId, name: ad?.name || `Ad ${adId}`, status: ad?.status ?? null },
      date: r.DATE.slice(0, 10),
      spendMinor: fromMicros(String(r.SPEND_IN_MICRO_DOLLAR ?? 0).split(".")[0], currency),
      impressions: Number(r.PAID_IMPRESSION ?? 0),
      clicks: Number(r.CLICKTHROUGH_1 ?? 0),
      conversions: Number(r.TOTAL_CONVERSIONS ?? 0).toFixed(2),
    };
  });
}

function chunks(window: DateWindow, size: number): DateWindow[] {
  const days = dateRange(window.since, window.until);
  const out: DateWindow[] = [];
  for (let i = 0; i < days.length; i += size) out.push({ since: days[i], until: days[Math.min(i + size, days.length) - 1] });
  return out;
}

async function pinterestAccessToken(conn: ConnectionLike, base: string): Promise<string> {
  const { accessToken, appSecret, refreshToken } = conn.secrets;
  const appId = conn.config.appId;
  if (refreshToken && appId && appSecret) {
    const res = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; message?: string; error?: string };
    if (!res.ok || !body.access_token) throw new Error(`Pinterest OAuth error: ${body.message ?? body.error ?? res.status}`);
    return body.access_token;
  }
  if (!accessToken) throw new Error("Pinterest access token is missing");
  return accessToken;
}

async function fetchPinterestLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]> {
  const ids = (conn.config.adAccountIds ?? "").split(/[\s,]+/).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one Pinterest ad account ID");
  const base = conn.config.environment === "sandbox" ? "https://api-sandbox.pinterest.com/v5" : "https://api.pinterest.com/v5";
  const token = await pinterestAccessToken(conn, base);

  const get = async <T>(path: string, params: Record<string, string> = {}): Promise<T> => {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${base}${path}${qs ? `?${qs}` : ""}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as (T & { code?: number; message?: string }) | null;
    if (!res.ok || body === null) throw new Error(`Pinterest API error (${body?.code ?? res.status}): ${body?.message ?? "unknown error"}`);
    return body;
  };
  const all = async <T>(path: string, params: Record<string, string> = {}): Promise<Page<T>[]> => {
    const pages: Page<T>[] = [];
    let bookmark: string | null | undefined;
    do {
      const page: Page<T> = await get(path, { ...params, page_size: "250", ...(bookmark ? { bookmark } : {}) });
      pages.push(page);
      bookmark = page.bookmark;
    } while (bookmark);
    return pages;
  };

  const out: AdDayRow[] = [];
  for (const id of ids) {
    const statuses = { entity_statuses: "ACTIVE,PAUSED,ARCHIVED" };
    const entities: PinterestEntities = {
      adAccount: await get(`/ad_accounts/${id}`),
      campaigns: await all(`/ad_accounts/${id}/campaigns`, statuses),
      adGroups: await all(`/ad_accounts/${id}/ad_groups`, statuses),
      ads: await all(`/ad_accounts/${id}/ads`, statuses),
    };
    const adIds = entities.ads.flatMap((p) => p.items.map((a) => a.id));
    for (const w of chunks(window, MAX_DAYS)) {
      for (let i = 0; i < adIds.length; i += MAX_ADS) {
        const rows = await get<PinterestAnalyticsRow[]>(`/ad_accounts/${id}/ads/analytics`, {
          start_date: w.since,
          end_date: w.until,
          ad_ids: adIds.slice(i, i + MAX_ADS).join(","),
          columns: COLUMNS.join(","),
          granularity: "DAY",
        });
        out.push(...parsePinterestAnalytics(rows, entities));
      }
    }
  }
  return out;
}

/** Mock Pinterest: demo world served as ads/analytics rows plus the entity list responses. */
export function mockPinterest(window: DateWindow, currency: string): { rows: PinterestAnalyticsRow[]; entities: PinterestEntities } {
  const ads = demoAdsFor("pinterest");
  const uniq = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  const entities: PinterestEntities = {
    adAccount: { id: ads[0].account.externalId, name: ads[0].account.name, currency },
    campaigns: [{ items: uniq(ads, (a) => a.campaign.externalId).map((a) => ({ id: a.campaign.externalId, name: a.campaign.name, status: "ACTIVE", objective_type: "WEB_CONVERSION" })), bookmark: null }],
    adGroups: [{ items: uniq(ads, (a) => a.group.externalId).map((a) => ({ id: a.group.externalId, name: a.group.name, status: "ACTIVE", campaign_id: a.campaign.externalId })), bookmark: null }],
    ads: [{ items: ads.map((a) => ({ id: a.ad.externalId, name: a.ad.name, status: "ACTIVE", ad_group_id: a.group.externalId, campaign_id: a.campaign.externalId })), bookmark: null }],
  };
  const rows: PinterestAnalyticsRow[] = [];
  for (const date of dateRange(window.since, window.until)) {
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      rows.push({
        AD_ID: ad.ad.externalId,
        DATE: date,
        SPEND_IN_MICRO_DOLLAR: Math.round(m.spend * 1_000_000),
        PAID_IMPRESSION: m.impressions,
        CLICKTHROUGH_1: m.clicks,
        TOTAL_CONVERSIONS: Math.round(m.conversions),
      });
    }
  }
  return { rows, entities };
}

export const pinterestConnector: AdsConnector = {
  platform: "pinterest",
  meta: {
    provider: "pinterest_ads",
    name: "Pinterest Ads",
    category: "ads",
    description: "Promoted pin spend, paid impressions, clicks and conversions per campaign, ad group and ad.",
    status: "beta",
    color: "#e60023",
    docsUrl: "https://developers.pinterest.com/docs/api/v5/ads-analytics/",
    fields: [
      { name: "adAccountIds", label: "Ad account IDs", placeholder: "549755885175", hint: "Comma-separated. Ads Manager → the number in the URL after /advertiser/." },
      { name: "accessToken", label: "Access token", secret: true, optional: true, hint: "Token with ads:read scope. Expires after 30 days unless you add the refresh details below." },
      { name: "appId", label: "App ID", optional: true },
      { name: "appSecret", label: "App secret key", secret: true, optional: true },
      { name: "refreshToken", label: "Refresh token", secret: true, optional: true, hint: "With app ID + secret, AdLedger renews access tokens itself." },
      { name: "environment", label: "Environment", placeholder: "production", optional: true, hint: "Type `sandbox` to use api-sandbox.pinterest.com." },
    ],
    steps: [
      "Go to developers.pinterest.com → My apps → Connect app (you need a Pinterest business account that can see the ad account).",
      "Once the app has Trial access, open it and generate an access token with the `ads:read` scope — or, for syncs that never expire, run the OAuth flow once and keep the refresh token.",
      "Paste the token (or app ID, app secret and refresh token) and the ad account IDs here.",
      "Just testing? Generate a sandbox token on the app page, set Environment to `sandbox`, and use a sandbox ad account ID.",
    ],
  },
  fetchLive: (conn, window) => fetchPinterestLive(conn, window),
  mock: (window, currency) => {
    const m = mockPinterest(window, currency);
    return parsePinterestAnalytics(m.rows, m.entities);
  },
};
