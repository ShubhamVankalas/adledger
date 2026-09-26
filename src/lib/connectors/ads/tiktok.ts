import { adDayMetrics, dateRange, demoAdsFor } from "../../demo/world";
import { currencyExponent, fromDecimalString } from "../../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "../types";

// TikTok API for Business v1.3 — synchronous integrated report at AUCTION_AD level.
// Docs: https://business-api.tiktok.com/portal/docs (Reporting → Synchronous reports)

export const TIKTOK_API_VERSION = "v1.3";
const METRICS = ["spend", "impressions", "clicks", "conversion", "campaign_id", "campaign_name", "adgroup_id", "adgroup_name", "ad_name", "objective_type"];
const MAX_DAYS = 30; // stat_time_day reports accept at most 30 days per request

export type TikTokReportRow = {
  dimensions: { ad_id: string; stat_time_day: string }; // "2026-09-20 00:00:00"
  metrics: {
    spend?: string;
    impressions?: string;
    clicks?: string;
    conversion?: string;
    campaign_id?: string;
    campaign_name?: string;
    adgroup_id?: string;
    adgroup_name?: string;
    ad_name?: string;
    objective_type?: string;
  };
};

export type TikTokReportResponse = {
  code: number;
  message: string;
  request_id?: string;
  data?: {
    list: TikTokReportRow[];
    page_info?: { page: number; page_size: number; total_number: number; total_page: number };
  };
};

type Account = AdDayRow["account"];

const num = (s: string | number | undefined) => {
  const n = Number(s ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const decimal = (s: string | undefined) => (s && /^-?\d*\.?\d+$/.test(s.trim()) ? s.trim() : "0");

export function parseTikTokReport(rows: TikTokReportRow[], account: Account): AdDayRow[] {
  return rows.map((r) => {
    const m = r.metrics;
    return {
      platform: "tiktok",
      account,
      campaign: { externalId: String(m.campaign_id ?? ""), name: m.campaign_name ?? "", status: null, objective: m.objective_type ?? null },
      adGroup: { externalId: String(m.adgroup_id ?? ""), name: m.adgroup_name ?? "", status: null },
      ad: { externalId: String(r.dimensions.ad_id), name: m.ad_name || `Ad ${r.dimensions.ad_id}`, status: null },
      date: r.dimensions.stat_time_day.slice(0, 10),
      spendMinor: fromDecimalString(decimal(m.spend), account.currency),
      impressions: num(m.impressions),
      clicks: num(m.clicks),
      conversions: num(m.conversion).toFixed(2),
    };
  });
}

function chunks(window: DateWindow, size: number): DateWindow[] {
  const days = dateRange(window.since, window.until);
  const out: DateWindow[] = [];
  for (let i = 0; i < days.length; i += size) out.push({ since: days[i], until: days[Math.min(i + size, days.length) - 1] });
  return out;
}

async function tiktokGet<T>(base: string, path: string, params: Record<string, string>, token: string): Promise<T> {
  const res = await fetch(`${base}${path}?${new URLSearchParams(params)}`, { headers: { "Access-Token": token, Accept: "application/json" } });
  const body = (await res.json().catch(() => null)) as { code?: number; message?: string; data?: T } | null;
  if (!res.ok || !body || body.code !== 0) {
    throw new Error(`TikTok API error (${body?.code ?? res.status}): ${body?.message ?? "unknown error"}`);
  }
  return body.data as T;
}

async function fetchTikTokLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]> {
  const token = conn.secrets.accessToken;
  if (!token) throw new Error("TikTok access token is missing");
  const ids = (conn.config.advertiserIds ?? "").split(/[\s,]+/).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one TikTok advertiser ID");
  const host = (conn.config.apiHost || "business-api.tiktok.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const base = `https://${host}/open_api/${TIKTOK_API_VERSION}`;

  const info = await tiktokGet<{ list: { advertiser_id: string; name?: string; currency?: string; timezone?: string; display_timezone?: string }[] }>(
    base,
    "/advertiser/info/",
    { advertiser_ids: JSON.stringify(ids), fields: JSON.stringify(["name", "currency", "timezone", "display_timezone"]) },
    token,
  );

  const out: AdDayRow[] = [];
  for (const id of ids) {
    const a = info.list.find((x) => String(x.advertiser_id) === id);
    if (!a?.currency) throw new Error(`TikTok advertiser ${id} was not found or this token has no access to it`);
    const account: Account = { externalId: id, name: a.name ?? `TikTok ${id}`, currency: a.currency.toUpperCase(), timezone: a.display_timezone ?? a.timezone ?? null };
    for (const w of chunks(window, MAX_DAYS)) {
      for (let page = 1, totalPages = 1; page <= totalPages; page++) {
        const data = await tiktokGet<NonNullable<TikTokReportResponse["data"]>>(
          base,
          "/report/integrated/get/",
          {
            advertiser_id: id,
            service_type: "AUCTION",
            report_type: "BASIC",
            data_level: "AUCTION_AD",
            dimensions: JSON.stringify(["ad_id", "stat_time_day"]),
            metrics: JSON.stringify(METRICS),
            start_date: w.since,
            end_date: w.until,
            page: String(page),
            page_size: "1000",
          },
          token,
        );
        out.push(...parseTikTokReport(data.list ?? [], account));
        totalPages = data.page_info?.total_page ?? 1;
      }
    }
  }
  return out;
}

/** Mock TikTok: demo world served in the integrated report format (strings everywhere). */
export function mockTikTokReport(window: DateWindow, currency: string): { account: Account; response: TikTokReportResponse } {
  const ads = demoAdsFor("tiktok");
  const list: TikTokReportRow[] = [];
  for (const date of dateRange(window.since, window.until)) {
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      list.push({
        dimensions: { ad_id: ad.ad.externalId, stat_time_day: `${date} 00:00:00` },
        metrics: {
          spend: m.spend.toFixed(currencyExponent(currency)),
          impressions: String(m.impressions),
          clicks: String(m.clicks),
          conversion: String(m.conversions),
          campaign_id: ad.campaign.externalId,
          campaign_name: ad.campaign.name,
          adgroup_id: ad.group.externalId,
          adgroup_name: ad.group.name,
          ad_name: ad.ad.name,
          objective_type: ad.campaign.objective,
        },
      });
    }
  }
  const acc = ads[0].account;
  return {
    account: { externalId: acc.externalId, name: acc.name, currency, timezone: acc.timezone },
    response: {
      code: 0,
      message: "OK",
      request_id: "mock",
      data: { list, page_info: { page: 1, page_size: list.length, total_number: list.length, total_page: 1 } },
    },
  };
}

export const tiktokConnector: AdsConnector = {
  platform: "tiktok",
  meta: {
    provider: "tiktok_ads",
    name: "TikTok Ads",
    category: "ads",
    description: "TikTok spend, impressions, clicks and conversions per campaign, ad group and ad.",
    status: "beta",
    color: "#ff0050",
    docsUrl: "https://business-api.tiktok.com/portal/docs",
    fields: [
      { name: "advertiserIds", label: "Advertiser IDs", placeholder: "7300000000000000001", hint: "Comma-separated. TikTok Ads Manager → account menu → copy the ID under the account name." },
      { name: "accessToken", label: "Access token", secret: true, hint: "Long-term token from your TikTok for Business developer app (doesn't expire)." },
      { name: "apiHost", label: "API host", placeholder: "business-api.tiktok.com", optional: true, hint: "Use sandbox-ads.tiktok.com for a sandbox advertiser." },
    ],
    steps: [
      "Sign up at business-api.tiktok.com as a developer and create an app with the Ads Management and Reporting scopes.",
      "Open the app's authorization URL while logged in to the TikTok Ads account, approve it, then exchange the auth_code for a long-term access token (Tools → Get access token).",
      "Paste the access token and the advertiser IDs it was granted for. No live account yet? Create a Sandbox advertiser in the developer portal and set the API host to `sandbox-ads.tiktok.com`.",
    ],
  },
  fetchLive: (conn, window) => fetchTikTokLive(conn, window),
  mock: (window, currency) => {
    const m = mockTikTokReport(window, currency);
    return parseTikTokReport(m.response.data?.list ?? [], m.account);
  },
};
