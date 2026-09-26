import { adDayMetrics, dateRange, demoAdsFor } from "../../demo/world";
import { fromMicros } from "../../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "../types";

// Snapchat Marketing API v1: GET /adaccounts/{id}/stats?granularity=DAY&breakdown=ad.
// Spend is micro-currency in the ad account's currency; clicks are "swipes".
// Docs: https://developers.snap.com/api/marketing-api/Ads-API/measurement

const API = "https://adsapi.snapchat.com/v1";
const FIELDS = "impressions,swipes,spend,conversion_purchases,conversion_sign_ups";
const MAX_DAYS = 31;

export type SnapStats = { impressions?: number; swipes?: number; spend?: number; conversion_purchases?: number; conversion_sign_ups?: number };
export type SnapStatsResponse = {
  request_status: string;
  request_id?: string;
  timeseries_stats?: {
    sub_request_status: string;
    timeseries_stat: {
      id: string;
      type: string;
      granularity: string;
      start_time: string;
      end_time: string;
      breakdown_stats?: {
        ad?: { id: string; type: "AD"; granularity: string; timeseries: { start_time: string; end_time: string; stats: SnapStats }[] }[];
      };
    };
  }[];
  paging?: { next_link?: string };
};

type Paging = { request_status?: string; paging?: { next_link?: string } };
type SnapCampaign = { id: string; name: string; status?: string; objective?: string };
type SnapSquad = { id: string; name: string; status?: string; campaign_id: string };
type SnapAd = { id: string; name: string; status?: string; ad_squad_id: string };
export type SnapEntities = {
  adaccount: { id: string; name: string; currency: string; timezone: string };
  campaigns: (Paging & { campaigns?: { sub_request_status?: string; campaign: SnapCampaign }[] })[];
  adsquads: (Paging & { adsquads?: { sub_request_status?: string; adsquad: SnapSquad }[] })[];
  ads: (Paging & { ads?: { sub_request_status?: string; ad: SnapAd }[] })[];
};

export function parseSnapchatStats(res: SnapStatsResponse, entities: SnapEntities): AdDayRow[] {
  const acc = entities.adaccount;
  const currency = acc.currency.toUpperCase();
  const campaigns = new Map(entities.campaigns.flatMap((p) => p.campaigns ?? []).map((c) => [c.campaign.id, c.campaign]));
  const squads = new Map(entities.adsquads.flatMap((p) => p.adsquads ?? []).map((s) => [s.adsquad.id, s.adsquad]));
  const ads = new Map(entities.ads.flatMap((p) => p.ads ?? []).map((a) => [a.ad.id, a.ad]));
  const out: AdDayRow[] = [];
  for (const t of res.timeseries_stats ?? []) {
    for (const adStats of t.timeseries_stat.breakdown_stats?.ad ?? []) {
      const ad = ads.get(adStats.id);
      const squad = ad ? squads.get(ad.ad_squad_id) : undefined;
      const campaign = squad ? campaigns.get(squad.campaign_id) : undefined;
      for (const point of adStats.timeseries) {
        const s = point.stats;
        if (!s.spend && !s.impressions && !s.swipes) continue; // DAY series include empty days
        out.push({
          platform: "snapchat",
          account: { externalId: acc.id, name: acc.name, currency, timezone: acc.timezone ?? null },
          campaign: { externalId: squad?.campaign_id ?? "", name: campaign?.name ?? "Unknown campaign", status: campaign?.status ?? null, objective: campaign?.objective ?? null },
          adGroup: { externalId: ad?.ad_squad_id ?? "", name: squad?.name ?? "Unknown ad squad", status: squad?.status ?? null },
          ad: { externalId: adStats.id, name: ad?.name || `Ad ${adStats.id}`, status: ad?.status ?? null },
          date: point.start_time.slice(0, 10), // local to the account's time zone
          spendMinor: fromMicros(Math.round(Number(s.spend ?? 0)), currency),
          impressions: Number(s.impressions ?? 0),
          clicks: Number(s.swipes ?? 0),
          conversions: (Number(s.conversion_purchases ?? 0) + Number(s.conversion_sign_ups ?? 0)).toFixed(2),
        });
      }
    }
  }
  return out;
}

function chunks(window: DateWindow, size: number): DateWindow[] {
  const days = dateRange(window.since, window.until);
  const out: DateWindow[] = [];
  for (let i = 0; i < days.length; i += size) out.push({ since: days[i], until: days[Math.min(i + size, days.length) - 1] });
  return out;
}

/** UTC offset (minutes) of `timeZone` at instant `ms`, via Intl's "GMT-04:00" style names. */
function offsetMinutes(timeZone: string, ms: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Local midnight of `date` in `timeZone` as ISO 8601 with offset, e.g. 2026-09-01T00:00:00-04:00. */
export function localMidnight(date: string, timeZone: string): string {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const off = offsetMinutes(timeZone, utc - offsetMinutes(timeZone, utc) * 60_000);
  const abs = Math.abs(off);
  return `${date}T00:00:00${off < 0 ? "-" : "+"}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function snapAccessToken(conn: ConnectionLike): Promise<string> {
  const clientId = conn.config.clientId;
  const { clientSecret, refreshToken } = conn.secrets;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Snapchat client ID, client secret and refresh token are required");
  const res = await fetch("https://accounts.snapchat.com/login/oauth2/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Snapchat OAuth error: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token;
}

async function fetchSnapchatLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]> {
  const ids = (conn.config.adAccountIds ?? "").split(/[\s,]+/).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one Snapchat ad account ID");
  const token = await snapAccessToken(conn);
  const get = async <T>(url: string): Promise<T> => {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as (T & { request_status?: string; debug_message?: string; display_message?: string }) | null;
    if (!res.ok || !body || body.request_status === "ERROR") {
      throw new Error(`Snapchat API error (${res.status}): ${body?.debug_message ?? body?.display_message ?? "unknown error"}`);
    }
    return body;
  };
  const all = async <T extends { paging?: { next_link?: string } }>(url: string): Promise<T[]> => {
    const pages: T[] = [];
    for (let next: string | undefined = url; next; ) {
      const page: T = await get<T>(next);
      pages.push(page);
      next = page.paging?.next_link;
    }
    return pages;
  };

  const out: AdDayRow[] = [];
  for (const id of ids) {
    const accRes = await get<{ adaccounts: { adaccount: SnapEntities["adaccount"] }[] }>(`${API}/adaccounts/${id}`);
    const adaccount = accRes.adaccounts?.[0]?.adaccount;
    if (!adaccount) throw new Error(`Snapchat ad account ${id} was not found`);
    const entities: SnapEntities = {
      adaccount,
      campaigns: await all(`${API}/adaccounts/${id}/campaigns?limit=1000`),
      adsquads: await all(`${API}/adaccounts/${id}/adsquads?limit=1000`),
      ads: await all(`${API}/adaccounts/${id}/ads?limit=1000`),
    };
    const tz = adaccount.timezone || "UTC";
    for (const w of chunks(window, MAX_DAYS)) {
      const qs = new URLSearchParams({
        granularity: "DAY",
        breakdown: "ad",
        fields: FIELDS,
        start_time: localMidnight(w.since, tz),
        end_time: localMidnight(nextDay(w.until), tz),
      });
      for (const page of await all<SnapStatsResponse>(`${API}/adaccounts/${id}/stats?${qs}`)) {
        out.push(...parseSnapchatStats(page, entities));
      }
    }
  }
  return out;
}

/** Mock Snapchat: demo world served as the stats breakdown response plus entity lists. */
export function mockSnapchat(window: DateWindow, currency: string): { stats: SnapStatsResponse; entities: SnapEntities } {
  const ads = demoAdsFor("snapchat");
  const acc = ads[0].account;
  const uniq = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  const ok = { sub_request_status: "SUCCESS" };
  const entities: SnapEntities = {
    adaccount: { id: acc.externalId, name: acc.name, currency, timezone: acc.timezone },
    campaigns: [{ request_status: "SUCCESS", campaigns: uniq(ads, (a) => a.campaign.externalId).map((a) => ({ ...ok, campaign: { id: a.campaign.externalId, name: a.campaign.name, status: "ACTIVE", objective: "WEB_CONVERSION" } })) }],
    adsquads: [{ request_status: "SUCCESS", adsquads: uniq(ads, (a) => a.group.externalId).map((a) => ({ ...ok, adsquad: { id: a.group.externalId, name: a.group.name, status: "ACTIVE", campaign_id: a.campaign.externalId } })) }],
    ads: [{ request_status: "SUCCESS", ads: ads.map((a) => ({ ...ok, ad: { id: a.ad.externalId, name: a.ad.name, status: "ACTIVE", ad_squad_id: a.group.externalId } })) }],
  };
  const days = dateRange(window.since, window.until);
  const stats: SnapStatsResponse = {
    request_status: "SUCCESS",
    request_id: "mock",
    timeseries_stats: [{
      sub_request_status: "SUCCESS",
      timeseries_stat: {
        id: acc.externalId,
        type: "AD_ACCOUNT",
        granularity: "DAY",
        start_time: localMidnight(window.since, acc.timezone),
        end_time: localMidnight(nextDay(window.until), acc.timezone),
        breakdown_stats: {
          ad: ads.map((ad) => ({
            id: ad.ad.externalId,
            type: "AD" as const,
            granularity: "DAY",
            timeseries: days.map((date) => {
              const m = adDayMetrics(ad, date, currency);
              return {
                start_time: localMidnight(date, acc.timezone),
                end_time: localMidnight(nextDay(date), acc.timezone),
                stats: { impressions: m.impressions, swipes: m.clicks, spend: Math.round(m.spend * 1_000_000), conversion_purchases: 0, conversion_sign_ups: Math.round(m.conversions) },
              };
            }),
          })),
        },
      },
    }],
  };
  return { stats, entities };
}

export const snapchatConnector: AdsConnector = {
  platform: "snapchat",
  meta: {
    provider: "snapchat_ads",
    name: "Snapchat Ads",
    category: "ads",
    description: "Snap ads spend, impressions, swipe-ups and conversions per campaign, ad squad and ad.",
    status: "beta",
    color: "#fffc00",
    docsUrl: "https://developers.snap.com/api/marketing-api/Ads-API/introduction",
    fields: [
      { name: "adAccountIds", label: "Ad account IDs", placeholder: "8b1c…-…", hint: "Comma-separated UUIDs. Ads Manager → the ID in the URL after /adaccounts/." },
      { name: "clientId", label: "OAuth client ID" },
      { name: "clientSecret", label: "OAuth client secret", secret: true },
      { name: "refreshToken", label: "Refresh token", secret: true, hint: "Access tokens last 30 minutes, so AdLedger refreshes them each sync." },
    ],
    steps: [
      "In Snapchat Business Manager → Business Details, create an OAuth app (Snap Kit / Marketing API) with a redirect URI such as https://localhost.",
      "Open https://accounts.snapchat.com/login/oauth2/authorize?response_type=code&client_id=YOUR_ID&redirect_uri=https://localhost&scope=snapchat-marketing-api and approve.",
      "Exchange the returned code at accounts.snapchat.com/login/oauth2/access_token for a refresh token.",
      "Paste the client ID, client secret, refresh token and your ad account IDs here.",
    ],
  },
  fetchLive: (conn, window) => fetchSnapchatLive(conn, window),
  mock: (window, currency) => {
    const m = mockSnapchat(window, currency);
    return parseSnapchatStats(m.stats, m.entities);
  },
};
