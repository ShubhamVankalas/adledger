import { createHmac, randomBytes } from "node:crypto";
import { adDayMetrics, dateRange, demoAdsFor } from "../../demo/world";
import { fromMicros } from "../../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "../types";

// X (Twitter) Ads API v12: synchronous stats GET /12/stats/accounts/{id} for PROMOTED_TWEET entities,
// granularity=DAY (≤7 days and ≤20 entity ids per call). Money is billed_charge_local_micro.
// Auth is OAuth 1.0a user context (HMAC-SHA1).
// Docs: https://developer.x.com/en/docs/x-ads-api/analytics/api-reference/synchronous
// Mapping: campaign → campaign, line item → ad group, promoted post → ad.

export const X_ADS_API_VERSION = "12";
const API = `https://ads-api.x.com/${X_ADS_API_VERSION}`;
const MAX_DAYS = 7;
const MAX_IDS = 20;
const PLACEMENTS = ["ALL_ON_TWITTER", "PUBLISHER_NETWORK"];

// ---------------------------------------------------------------- OAuth 1.0a

/** RFC 3986 percent-encoding as OAuth 1.0a requires. */
export const oauthEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export type OAuth1Credentials = { consumerKey: string; consumerSecret: string; token: string; tokenSecret: string };

/** HMAC-SHA1 signature over method, base URL and all (query + oauth_*) parameters. */
export function oauth1Signature(method: string, url: string, params: [string, string][], consumerSecret: string, tokenSecret: string): string {
  const u = new URL(url);
  const all: [string, string][] = [...params, ...[...u.searchParams.entries()]];
  const normalized = all
    .map(([k, v]) => [oauthEncode(k), oauthEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const base = [method.toUpperCase(), oauthEncode(baseUrl), oauthEncode(normalized)].join("&");
  return createHmac("sha1", `${oauthEncode(consumerSecret)}&${oauthEncode(tokenSecret)}`).update(base).digest("base64");
}

/** Authorization header for a request; `extra` holds form-body params that are part of the signature. */
export function oauth1Header(
  method: string,
  url: string,
  creds: OAuth1Credentials,
  opts: { nonce?: string; timestamp?: number; extra?: [string, string][] } = {},
): string {
  const oauth: [string, string][] = [
    ["oauth_consumer_key", creds.consumerKey],
    ["oauth_nonce", opts.nonce ?? randomBytes(16).toString("hex")],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", String(opts.timestamp ?? Math.floor(Date.now() / 1000))],
    ["oauth_token", creds.token],
    ["oauth_version", "1.0"],
  ];
  const signature = oauth1Signature(method, url, [...oauth, ...(opts.extra ?? [])], creds.consumerSecret, creds.tokenSecret);
  return `OAuth ${[...oauth, ["oauth_signature", signature]].map(([k, v]) => `${oauthEncode(k)}="${oauthEncode(v)}"`).join(", ")}`;
}

// ---------------------------------------------------------------- parser

type Series = (number | null)[] | null;
type ConvMetric = { metric?: Series } | null;
export type XStatsResponse = {
  data_type?: string;
  time_series_length?: number;
  data: {
    id: string;
    id_data: {
      segment: unknown;
      metrics: {
        impressions?: Series;
        clicks?: Series;
        billed_charge_local_micro?: Series;
        conversion_purchases?: ConvMetric;
        conversion_sign_ups?: ConvMetric;
      };
    }[];
  }[];
  request: { params: { start_time: string; end_time?: string; granularity?: string; placement?: string } };
};

type Cursor<T> = { data: T[]; next_cursor?: string | null };
type Base = { id: string; entity_status?: string; deleted?: boolean };
export type XEntities = {
  account: { data: { id: string; name: string; timezone?: string } };
  campaigns: Cursor<Base & { name: string; currency?: string }>[];
  lineItems: Cursor<Base & { name: string; campaign_id: string; objective?: string; currency?: string }>[];
  promotedTweets: Cursor<Base & { line_item_id: string; tweet_id: string }>[];
};

/** Local calendar date of a UTC instant in `timeZone`. */
function localDate(ms: number, timeZone: string | undefined): string {
  if (!timeZone) return new Date(ms).toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

const at = (s: Series | undefined, i: number) => Number(s?.[i] ?? 0);

export function parseXStats(res: XStatsResponse, entities: XEntities): AdDayRow[] {
  const acc = entities.account.data;
  const campaigns = new Map(entities.campaigns.flatMap((p) => p.data).map((c) => [c.id, c]));
  const lineItems = new Map(entities.lineItems.flatMap((p) => p.data).map((l) => [l.id, l]));
  const tweets = new Map(entities.promotedTweets.flatMap((p) => p.data).map((t) => [t.id, t]));
  // Day i starts at local midnight; +12h keeps the date right across DST shifts.
  const start = Date.parse(res.request.params.start_time) + 12 * 3_600_000;
  const out: AdDayRow[] = [];
  for (const entity of res.data) {
    const pt = tweets.get(entity.id);
    const li = pt ? lineItems.get(pt.line_item_id) : undefined;
    const c = li ? campaigns.get(li.campaign_id) : undefined;
    const currency = (li?.currency ?? c?.currency ?? "USD").toUpperCase();
    for (const d of entity.id_data) {
      const m = d.metrics;
      const len = Math.max(m.impressions?.length ?? 0, m.clicks?.length ?? 0, m.billed_charge_local_micro?.length ?? 0);
      for (let i = 0; i < len; i++) {
        const spend = at(m.billed_charge_local_micro, i);
        const impressions = at(m.impressions, i);
        const clicks = at(m.clicks, i);
        if (!spend && !impressions && !clicks) continue;
        out.push({
          platform: "x",
          account: { externalId: acc.id, name: acc.name, currency, timezone: acc.timezone ?? null },
          campaign: { externalId: li?.campaign_id ?? "", name: c?.name ?? "Unknown campaign", status: c?.entity_status ?? null, objective: li?.objective ?? null },
          adGroup: { externalId: pt?.line_item_id ?? "", name: li?.name ?? "Unknown ad group", status: li?.entity_status ?? null },
          ad: { externalId: entity.id, name: pt ? `Post ${pt.tweet_id}` : `Promoted post ${entity.id}`, status: pt?.entity_status ?? null },
          date: localDate(start + i * 86_400_000, acc.timezone),
          spendMinor: fromMicros(Math.round(spend), currency),
          impressions,
          clicks,
          conversions: (at(m.conversion_purchases?.metric, i) + at(m.conversion_sign_ups?.metric, i)).toFixed(2),
        });
      }
    }
  }
  return out;
}

/** Sum rows for the same ad-day (stats are fetched once per placement). */
export function mergeXRows(rows: AdDayRow[]): AdDayRow[] {
  const byKey = new Map<string, AdDayRow>();
  for (const r of rows) {
    const k = `${r.ad.externalId}|${r.date}`;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...r });
    else {
      prev.spendMinor += r.spendMinor;
      prev.impressions += r.impressions;
      prev.clicks += r.clicks;
      prev.conversions = (Number(prev.conversions) + Number(r.conversions)).toFixed(2);
    }
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- live

function chunks(window: DateWindow, size: number): DateWindow[] {
  const days = dateRange(window.since, window.until);
  const out: DateWindow[] = [];
  for (let i = 0; i < days.length; i += size) out.push({ since: days[i], until: days[Math.min(i + size, days.length) - 1] });
  return out;
}

function offsetMinutes(timeZone: string, ms: number): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

/** Local midnight of `date` in `timeZone` as a whole-hour UTC timestamp (what DAY stats require). */
export function xBoundary(date: string, timeZone: string): string {
  const utc = Date.parse(`${date}T00:00:00Z`);
  const off = offsetMinutes(timeZone, utc - offsetMinutes(timeZone, utc) * 60_000);
  return new Date(utc - off * 60_000).toISOString().replace(".000Z", "Z");
}

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function fetchXLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]> {
  const creds: OAuth1Credentials = {
    consumerKey: conn.config.consumerKey ?? "",
    consumerSecret: conn.secrets.consumerSecret ?? "",
    token: conn.config.accessToken ?? "",
    tokenSecret: conn.secrets.accessTokenSecret ?? "",
  };
  if (!creds.consumerKey || !creds.consumerSecret) throw new Error("X API key and secret are missing");
  if (!creds.token || !creds.tokenSecret) throw new Error("X access token and secret are missing");
  const ids = (conn.config.adAccountIds ?? "").split(/[\s,]+/).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one X ads account ID");

  const get = async <T>(url: string): Promise<T> => {
    const res = await fetch(url, { headers: { Authorization: oauth1Header("GET", url, creds), Accept: "application/json" } });
    const body = (await res.json().catch(() => null)) as (T & { errors?: { code?: string; message?: string }[] }) | null;
    if (!res.ok || !body || body.errors?.length) {
      const e = body?.errors?.[0];
      throw new Error(`X Ads API error (${e?.code ?? res.status}): ${e?.message ?? "unknown error"}`);
    }
    return body;
  };
  const all = async <T>(url: string): Promise<Cursor<T>[]> => {
    const pages: Cursor<T>[] = [];
    let cursor: string | null | undefined;
    do {
      const page: Cursor<T> = await get(`${url}${url.includes("?") ? "&" : "?"}count=1000&with_deleted=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      pages.push(page);
      cursor = page.next_cursor;
    } while (cursor);
    return pages;
  };

  const out: AdDayRow[] = [];
  for (const id of ids) {
    const entities: XEntities = {
      account: await get(`${API}/accounts/${id}`),
      campaigns: await all(`${API}/accounts/${id}/campaigns`),
      lineItems: await all(`${API}/accounts/${id}/line_items`),
      promotedTweets: await all(`${API}/accounts/${id}/promoted_tweets`),
    };
    const tz = entities.account.data.timezone || "UTC";
    const tweetIds = entities.promotedTweets.flatMap((p) => p.data.map((t) => t.id));
    const rows: AdDayRow[] = [];
    for (const w of chunks(window, MAX_DAYS)) {
      for (let i = 0; i < tweetIds.length; i += MAX_IDS) {
        for (const placement of PLACEMENTS) {
          const qs = new URLSearchParams({
            entity: "PROMOTED_TWEET",
            entity_ids: tweetIds.slice(i, i + MAX_IDS).join(","),
            start_time: xBoundary(w.since, tz),
            end_time: xBoundary(nextDay(w.until), tz),
            granularity: "DAY",
            metric_groups: "ENGAGEMENT,BILLING,WEB_CONVERSION",
            placement,
          });
          rows.push(...parseXStats(await get<XStatsResponse>(`${API}/stats/accounts/${id}?${qs}`), entities));
        }
      }
    }
    out.push(...mergeXRows(rows));
  }
  return out;
}

// ---------------------------------------------------------------- mock

/** Mock X: demo world served as a DAY stats response (arrays per metric) plus entity lists. */
export function mockX(window: DateWindow, currency: string): { stats: XStatsResponse; entities: XEntities } {
  const ads = demoAdsFor("x");
  const acc = ads[0].account;
  const uniq = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  const entities: XEntities = {
    account: { data: { id: acc.externalId, name: acc.name, timezone: acc.timezone } },
    campaigns: [{ data: uniq(ads, (a) => a.campaign.externalId).map((a) => ({ id: a.campaign.externalId, name: a.campaign.name, entity_status: "ACTIVE", currency })), next_cursor: null }],
    lineItems: [{ data: uniq(ads, (a) => a.group.externalId).map((a) => ({ id: a.group.externalId, name: a.group.name, campaign_id: a.campaign.externalId, objective: "WEBSITE_CONVERSIONS", entity_status: "ACTIVE", currency })), next_cursor: null }],
    promotedTweets: [{ data: ads.map((a) => ({ id: a.ad.externalId, line_item_id: a.group.externalId, tweet_id: `18${a.ad.externalId}`, entity_status: "ACTIVE" })), next_cursor: null }],
  };
  const days = dateRange(window.since, window.until);
  const stats: XStatsResponse = {
    data_type: "stats",
    time_series_length: days.length,
    data: ads.map((ad) => {
      const ms = days.map((d) => adDayMetrics(ad, d, currency));
      return {
        id: ad.ad.externalId,
        id_data: [{
          segment: null,
          metrics: {
            impressions: ms.map((m) => m.impressions),
            clicks: ms.map((m) => m.clicks),
            billed_charge_local_micro: ms.map((m) => Math.round(m.spend * 1_000_000)),
            conversion_purchases: { metric: ms.map(() => 0) },
            conversion_sign_ups: { metric: ms.map((m) => Math.round(m.conversions)) },
          },
        }],
      };
    }),
    request: { params: { start_time: xBoundary(window.since, acc.timezone), end_time: xBoundary(nextDay(window.until), acc.timezone), granularity: "DAY", placement: "ALL_ON_TWITTER" } },
  };
  return { stats, entities };
}

export const xConnector: AdsConnector = {
  platform: "x",
  meta: {
    provider: "x_ads",
    name: "X Ads",
    category: "ads",
    description: "X (Twitter) promoted post spend, impressions, clicks and conversions per campaign and ad group.",
    status: "beta",
    color: "#000000",
    docsUrl: "https://developer.x.com/en/docs/x-ads-api/getting-started",
    fields: [
      { name: "adAccountIds", label: "Ads account IDs", placeholder: "18ce54d4x5t", hint: "Comma-separated. ads.x.com → the ID in the URL after /accounts/." },
      { name: "consumerKey", label: "API key (consumer key)" },
      { name: "consumerSecret", label: "API key secret", secret: true },
      { name: "accessToken", label: "Access token", hint: "Generated for an X user that has access to the ads account." },
      { name: "accessTokenSecret", label: "Access token secret", secret: true },
    ],
    steps: [
      "Create a project and app at developer.x.com, then apply for Ads API access for that app (approval can take a few days).",
      "In the app's Keys and tokens tab copy the API key and secret, then generate an access token and secret while logged in as a user with access to the ads account.",
      "In ads.x.com → Account settings → Account access, make sure that user has at least Analyst access.",
      "Paste the four keys and your ads account IDs here.",
    ],
  },
  fetchLive: (conn, window) => fetchXLive(conn, window),
  mock: (window, currency) => {
    const m = mockX(window, currency);
    return parseXStats(m.stats, m.entities);
  },
};
