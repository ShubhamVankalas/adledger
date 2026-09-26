import { adDayMetrics, dateRange, demoAdsFor } from "../../demo/world";
import { fromMicros } from "../../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "../types";

// Reddit Ads API v3: POST /ad_accounts/{id}/reports with breakdowns AD_ID + DATE.
// Spend is micro-currency in the ad account's currency.
// Docs: https://ads-api.reddit.com/docs/v3/

const API = "https://ads-api.reddit.com/api/v3";
const USER_AGENT = "AdLedger/0.1 (self-hosted ad attribution)";
const FIELDS = ["SPEND", "IMPRESSIONS", "CLICKS", "KEY_CONVERSION_TOTAL_COUNT"];

export type RedditMetricRow = {
  ad_id: string;
  date: string; // YYYY-MM-DD (or an ISO timestamp) in the report time zone
  spend?: number; // micro-currency
  impressions?: number;
  clicks?: number;
  key_conversion_total_count?: number;
};
export type RedditReportResponse = { data: { metrics: RedditMetricRow[] }; pagination?: { next_url?: string | null } };

type Page<T> = { data: T[]; pagination?: { next_url?: string | null } };
type Status = { configured_status?: string; effective_status?: string };
export type RedditEntities = {
  adAccount: { data: { id: string; name: string; currency: string; time_zone_id?: string } };
  campaigns: Page<{ id: string; name: string; objective?: string } & Status>[];
  adGroups: Page<{ id: string; name: string; campaign_id: string } & Status>[];
  ads: Page<{ id: string; name: string; ad_group_id: string; campaign_id: string } & Status>[];
};

const status = (s: Status | undefined) => s?.effective_status ?? s?.configured_status ?? null;

export function parseRedditReport(rows: RedditMetricRow[], entities: RedditEntities): AdDayRow[] {
  const acc = entities.adAccount.data;
  const currency = acc.currency.toUpperCase();
  const campaigns = new Map(entities.campaigns.flatMap((p) => p.data).map((c) => [c.id, c]));
  const groups = new Map(entities.adGroups.flatMap((p) => p.data).map((g) => [g.id, g]));
  const ads = new Map(entities.ads.flatMap((p) => p.data).map((a) => [a.id, a]));
  return rows.map((r) => {
    const ad = ads.get(r.ad_id);
    const group = ad ? groups.get(ad.ad_group_id) : undefined;
    const campaign = ad ? campaigns.get(ad.campaign_id) : undefined;
    return {
      platform: "reddit",
      account: { externalId: acc.id, name: acc.name, currency, timezone: acc.time_zone_id ?? null },
      campaign: { externalId: ad?.campaign_id ?? "", name: campaign?.name ?? "Unknown campaign", status: status(campaign), objective: campaign?.objective ?? null },
      adGroup: { externalId: ad?.ad_group_id ?? "", name: group?.name ?? "Unknown ad group", status: status(group) },
      ad: { externalId: r.ad_id, name: ad?.name || `Ad ${r.ad_id}`, status: status(ad) },
      date: r.date.slice(0, 10),
      spendMinor: fromMicros(Math.round(Number(r.spend ?? 0)), currency),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      conversions: Number(r.key_conversion_total_count ?? 0).toFixed(2),
    };
  });
}

/** UTC offset (minutes) of `timeZone` at instant `ms`. */
function offsetMinutes(timeZone: string, ms: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Local midnight of `date` in `timeZone` as a UTC timestamp on a whole hour, e.g. 2026-09-01T04:00:00Z. */
export function redditBoundary(date: string, timeZone: string): string {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const off = offsetMinutes(timeZone, utc - offsetMinutes(timeZone, utc) * 60_000);
  return new Date(utc - off * 60_000).toISOString().replace(".000Z", "Z");
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function redditAccessToken(conn: ConnectionLike): Promise<string> {
  const { accessToken, appSecret, refreshToken } = conn.secrets;
  const appId = conn.config.appId;
  if (refreshToken && appId && appSecret) {
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": USER_AGENT,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; message?: string };
    if (!res.ok || !body.access_token) throw new Error(`Reddit OAuth error: ${body.error ?? body.message ?? res.status}`);
    return body.access_token;
  }
  if (!accessToken) throw new Error("Reddit access token is missing");
  return accessToken;
}

async function fetchRedditLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]> {
  const ids = (conn.config.adAccountIds ?? "").split(/[\s,]+/).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one Reddit ad account ID");
  const token = await redditAccessToken(conn);
  const call = async <T>(url: string, body?: unknown): Promise<T> => {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: string } | string; message?: string }) | null;
    if (!res.ok || !json) {
      const e = json?.error;
      throw new Error(`Reddit API error (${res.status}): ${(typeof e === "string" ? e : e?.message) ?? json?.message ?? "unknown error"}`);
    }
    return json;
  };
  const all = async <T extends { pagination?: { next_url?: string | null } }>(url: string, body?: unknown): Promise<T[]> => {
    const pages: T[] = [];
    for (let next: string | null | undefined = url; next; ) {
      const page: T = await call<T>(next, body);
      pages.push(page);
      next = page.pagination?.next_url;
    }
    return pages;
  };

  const out: AdDayRow[] = [];
  for (const id of ids) {
    const entities: RedditEntities = {
      adAccount: await call(`${API}/ad_accounts/${id}`),
      campaigns: await all(`${API}/ad_accounts/${id}/campaigns?page.size=1000`),
      adGroups: await all(`${API}/ad_accounts/${id}/ad_groups?page.size=1000`),
      ads: await all(`${API}/ad_accounts/${id}/ads?page.size=1000`),
    };
    const tz = entities.adAccount.data.time_zone_id || "UTC";
    const report = {
      data: {
        breakdowns: ["AD_ID", "DATE"],
        fields: FIELDS,
        starts_at: redditBoundary(window.since, tz),
        ends_at: redditBoundary(nextDay(window.until), tz),
        time_zone_id: tz,
      },
    };
    for (const page of await all<RedditReportResponse>(`${API}/ad_accounts/${id}/reports`, report)) {
      out.push(...parseRedditReport(page.data?.metrics ?? [], entities));
    }
  }
  return out;
}

/** Mock Reddit: demo world served as a v3 report response plus the entity list responses. */
export function mockReddit(window: DateWindow, currency: string): { report: RedditReportResponse; entities: RedditEntities } {
  const ads = demoAdsFor("reddit");
  const acc = ads[0].account;
  const uniq = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  const entities: RedditEntities = {
    adAccount: { data: { id: acc.externalId, name: acc.name, currency, time_zone_id: acc.timezone } },
    campaigns: [{ data: uniq(ads, (a) => a.campaign.externalId).map((a) => ({ id: a.campaign.externalId, name: a.campaign.name, objective: "CONVERSIONS", configured_status: "ACTIVE" })), pagination: { next_url: null } }],
    adGroups: [{ data: uniq(ads, (a) => a.group.externalId).map((a) => ({ id: a.group.externalId, name: a.group.name, campaign_id: a.campaign.externalId, configured_status: "ACTIVE" })), pagination: { next_url: null } }],
    ads: [{ data: ads.map((a) => ({ id: a.ad.externalId, name: a.ad.name, ad_group_id: a.group.externalId, campaign_id: a.campaign.externalId, configured_status: "ACTIVE" })), pagination: { next_url: null } }],
  };
  const metrics: RedditMetricRow[] = [];
  for (const date of dateRange(window.since, window.until)) {
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      metrics.push({ ad_id: ad.ad.externalId, date, spend: Math.round(m.spend * 1_000_000), impressions: m.impressions, clicks: m.clicks, key_conversion_total_count: Math.round(m.conversions) });
    }
  }
  return { report: { data: { metrics }, pagination: { next_url: null } }, entities };
}

export const redditConnector: AdsConnector = {
  platform: "reddit",
  meta: {
    provider: "reddit_ads",
    name: "Reddit Ads",
    category: "ads",
    description: "Promoted post spend, impressions, clicks and key conversions per campaign, ad group and ad.",
    status: "beta",
    color: "#ff4500",
    docsUrl: "https://ads-api.reddit.com/docs/v3/",
    fields: [
      { name: "adAccountIds", label: "Ad account IDs", placeholder: "t2_abc123", hint: "Comma-separated. Reddit Ads → the account ID shown in the account switcher / URL." },
      { name: "appId", label: "App ID (client ID)", optional: true },
      { name: "appSecret", label: "App secret", secret: true, optional: true },
      { name: "refreshToken", label: "Refresh token", secret: true, optional: true, hint: "With app ID + secret, AdLedger renews the 1-hour access tokens itself." },
      { name: "accessToken", label: "Access token", secret: true, optional: true, hint: "Only for a quick test — it expires within a day." },
    ],
    steps: [
      "In Reddit Ads → Developer Applications (ads.reddit.com), create an app with a redirect URI such as https://localhost and note the app ID and secret.",
      "Open https://www.reddit.com/api/v1/authorize?client_id=YOUR_ID&response_type=code&state=x&redirect_uri=https://localhost&duration=permanent&scope=adsread and approve.",
      "Exchange the code at https://www.reddit.com/api/v1/access_token (basic auth with the app ID/secret) for a refresh token.",
      "Paste the app ID, secret, refresh token and ad account IDs here.",
    ],
  },
  fetchLive: (conn, window) => fetchRedditLive(conn, window),
  mock: (window, currency) => {
    const m = mockReddit(window, currency);
    return parseRedditReport(m.report.data.metrics, m.entities);
  },
};
