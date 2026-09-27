import { adDayMetrics, dateRange, demoAdsFor, platformClaim } from "../demo/world";
import { currencyExponent, fromDecimalString, fromMicros } from "../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "./types";

type Connection = ConnectionLike;

export type { AdDayRow, DateWindow } from "./types";

export const META_API_VERSION_DEFAULT = "v26.0";
export const GOOGLE_ADS_API_VERSION_DEFAULT = "v25";

// ---------------------------------------------------------------- Meta

export type MetaInsightRow = {
  date_start: string;
  account_id?: string;
  account_name?: string;
  account_currency?: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
};

/** Purchase value aliases, most inclusive first. They describe the same purchases, so only one is used. */
const PURCHASE_VALUE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase", "onsite_web_purchase"];

/** Meta's claimed purchase value in minor units; null when the row carries no action_values at all. */
function metaPurchaseValue(values: MetaInsightRow["action_values"], currency: string): number | null {
  if (!values) return null;
  for (const type of PURCHASE_VALUE_ACTIONS) {
    const hit = values.find((v) => v.action_type === type);
    if (hit) return fromDecimalString(hit.value || "0", currency);
  }
  return 0;
}

const LEAD_ACTIONS = new Set(["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead", "complete_registration", "purchase", "offsite_conversion.fb_pixel_purchase"]);

export function parseMetaInsights(
  rows: MetaInsightRow[],
  account: { externalId: string; name: string; currency: string; timezone: string | null },
  statuses: { campaigns: Map<string, { status?: string; objective?: string }>; } = { campaigns: new Map() },
): AdDayRow[] {
  return rows.map((r) => {
    const currency = (r.account_currency ?? account.currency).toUpperCase();
    const conv = (r.actions ?? [])
      .filter((a) => LEAD_ACTIONS.has(a.action_type))
      .reduce((s, a) => s + Number(a.value || 0), 0);
    const c = statuses.campaigns.get(r.campaign_id);
    return {
      platform: "meta",
      account: { ...account, name: r.account_name ?? account.name, currency },
      campaign: { externalId: r.campaign_id, name: r.campaign_name, status: c?.status ?? null, objective: c?.objective ?? null },
      adGroup: { externalId: r.adset_id, name: r.adset_name, status: null },
      ad: { externalId: r.ad_id, name: r.ad_name, status: null },
      date: r.date_start,
      spendMinor: fromDecimalString(r.spend ?? "0", currency),
      impressions: Number(r.impressions ?? 0),
      clicks: Number(r.clicks ?? 0),
      conversions: conv.toFixed(2),
      conversionValueMinor: metaPurchaseValue(r.action_values, currency),
    };
  });
}

async function graphGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok || body.error) {
    throw new Error(`Meta API error (${res.status}): ${body.error?.message ?? "unknown error"}`);
  }
  return body;
}

async function fetchMetaLive(conn: Connection, window: DateWindow): Promise<AdDayRow[]> {
  const token = conn.secrets.accessToken;
  const ids = (conn.config.adAccountIds ?? "").split(/[\s,]+/).filter(Boolean);
  if (!token) throw new Error("Meta access token is missing");
  if (ids.length === 0) throw new Error("Add at least one Meta ad account ID (act_...)");
  const version = conn.config.apiVersion || META_API_VERSION_DEFAULT;
  const base = `https://graph.facebook.com/${version}`;
  const out: AdDayRow[] = [];

  for (const raw of ids) {
    const act = raw.startsWith("act_") ? raw : `act_${raw}`;
    const q = (params: Record<string, string>) =>
      new URLSearchParams({ ...params, access_token: token }).toString();
    const info = await graphGet<{ name: string; currency: string; timezone_name?: string }>(
      `${base}/${act}?${q({ fields: "name,currency,account_status,timezone_name" })}`,
    );
    const account = { externalId: act, name: info.name, currency: info.currency, timezone: info.timezone_name ?? null };

    const campaigns = new Map<string, { status?: string; objective?: string }>();
    let next: string | undefined = `${base}/${act}/campaigns?${q({ fields: "id,name,effective_status,objective", limit: "500" })}`;
    while (next) {
      const page: { data: { id: string; effective_status?: string; objective?: string }[]; paging?: { next?: string } } =
        await graphGet(next);
      for (const c of page.data) campaigns.set(c.id, { status: c.effective_status, objective: c.objective });
      next = page.paging?.next;
    }

    next = `${base}/${act}/insights?${q({
      level: "ad",
      time_increment: "1",
      time_range: JSON.stringify({ since: window.since, until: window.until }),
      fields: "account_currency,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,actions,action_values",
      use_unified_attribution_setting: "true",
      limit: "500",
    })}`;
    while (next) {
      const page: { data: MetaInsightRow[]; paging?: { next?: string } } = await graphGet(next);
      out.push(...parseMetaInsights(page.data, account, { campaigns }));
      next = page.paging?.next;
    }
  }
  return out;
}

/** Mock Meta: demo world served in the Graph API's insights format. */
export function mockMetaInsights(window: DateWindow, currency: string): { account: AdDayRow["account"]; rows: MetaInsightRow[] }[] {
  const ads = demoAdsFor("meta");
  const byAccount = new Map<string, { account: AdDayRow["account"]; rows: MetaInsightRow[] }>();
  for (const date of dateRange(window.since, window.until)) {
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      const claim = platformClaim(ad, date, currency);
      const acc = byAccount.get(ad.account.externalId) ?? {
        account: { externalId: ad.account.externalId, name: ad.account.name, currency, timezone: ad.account.timezone },
        rows: [],
      };
      acc.rows.push({
        date_start: date,
        account_currency: currency,
        campaign_id: ad.campaign.externalId,
        campaign_name: ad.campaign.name,
        adset_id: ad.group.externalId,
        adset_name: ad.group.name,
        ad_id: ad.ad.externalId,
        ad_name: ad.ad.name,
        spend: m.spend.toFixed(currencyExponent(currency)),
        impressions: String(m.impressions),
        clicks: String(m.clicks),
        actions: [
          ...(claim.leads > 0 ? [{ action_type: "lead", value: String(claim.leads) }] : []),
          ...(claim.purchases > 0 ? [{ action_type: "purchase", value: String(claim.purchases) }] : []),
        ],
        action_values: claim.purchases > 0 ? [{ action_type: "purchase", value: claim.value.toFixed(currencyExponent(currency)) }] : [],
      });
      byAccount.set(ad.account.externalId, acc);
    }
  }
  return [...byAccount.values()];
}

// ---------------------------------------------------------------- Google Ads

export type GoogleAdsResult = {
  customer?: { id?: string; currencyCode?: string; descriptiveName?: string; timeZone?: string };
  campaign: { id: string; name: string; status?: string; advertisingChannelType?: string };
  adGroup: { id: string; name: string; status?: string };
  adGroupAd: { ad: { id: string; name?: string }; status?: string };
  segments: { date: string };
  metrics: {
    costMicros?: string | number;
    impressions?: string | number;
    clicks?: string | number;
    conversions?: string | number;
    conversionsValue?: string | number;
  };
};

/** Google's conversionsValue (a double in account currency) to minor units; null when absent. */
function googleValue(v: string | number | undefined, currency: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (/^-?\d*\.?\d+$/.test(s)) return fromDecimalString(s, currency);
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10 ** currencyExponent(currency)) : null;
}

export function parseGoogleAdsStream(batches: { results?: GoogleAdsResult[] }[], customerId: string): AdDayRow[] {
  const out: AdDayRow[] = [];
  for (const batch of batches) {
    for (const r of batch.results ?? []) {
      const currency = (r.customer?.currencyCode ?? "USD").toUpperCase();
      out.push({
        platform: "google",
        account: {
          externalId: customerId,
          name: r.customer?.descriptiveName || `Google Ads ${customerId}`,
          currency,
          timezone: r.customer?.timeZone ?? null,
        },
        campaign: { externalId: String(r.campaign.id), name: r.campaign.name, status: r.campaign.status ?? null, objective: r.campaign.advertisingChannelType ?? null },
        adGroup: { externalId: String(r.adGroup.id), name: r.adGroup.name, status: r.adGroup.status ?? null },
        ad: { externalId: String(r.adGroupAd.ad.id), name: r.adGroupAd.ad.name || `Ad ${r.adGroupAd.ad.id}`, status: r.adGroupAd.status ?? null },
        date: r.segments.date,
        spendMinor: fromMicros(String(r.metrics.costMicros ?? "0"), currency),
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
        conversions: Number(r.metrics.conversions ?? 0).toFixed(2),
        conversionValueMinor: googleValue(r.metrics.conversionsValue, currency),
      });
    }
  }
  return out;
}

export function googleAdsQuery(window: DateWindow): string {
  return `SELECT customer.currency_code, customer.descriptive_name, customer.time_zone,
  campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
  ad_group.id, ad_group.name, ad_group.status,
  ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.status,
  segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions,
  metrics.conversions_value
FROM ad_group_ad
WHERE segments.date BETWEEN '${window.since}' AND '${window.until}'`;
}

export async function googleAccessToken(conn: Connection): Promise<string> {
  const clientId = conn.config.clientId;
  const { clientSecret, refreshToken } = conn.secrets;
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google OAuth client ID, secret and refresh token are required");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error_description?: string; error?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google OAuth error: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token;
}

async function fetchGoogleLive(conn: Connection, window: DateWindow): Promise<AdDayRow[]> {
  const devToken = conn.secrets.developerToken;
  if (!devToken) throw new Error("Google Ads developer token is missing");
  const ids = (conn.config.customerIds ?? "").split(/[\s,]+/).map((s) => s.replace(/-/g, "")).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one Google Ads customer ID");
  const version = conn.config.apiVersion || GOOGLE_ADS_API_VERSION_DEFAULT;
  const token = await googleAccessToken(conn);
  const loginCustomerId = (conn.config.loginCustomerId ?? "").replace(/-/g, "");
  const out: AdDayRow[] = [];
  for (const cid of ids) {
    const res = await fetch(`https://googleads.googleapis.com/${version}/customers/${cid}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": devToken,
        "Content-Type": "application/json",
        ...(loginCustomerId ? { "login-customer-id": loginCustomerId } : {}),
      },
      body: JSON.stringify({ query: googleAdsQuery(window) }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = Array.isArray(body) ? body[0]?.error?.message : body?.error?.message;
      throw new Error(`Google Ads API error (${res.status}): ${msg ?? "unknown error"}`);
    }
    out.push(...parseGoogleAdsStream(Array.isArray(body) ? body : [body], cid));
  }
  return out;
}

/** Mock Google Ads: demo world served in searchStream format (costMicros as strings). */
export function mockGoogleStream(window: DateWindow, currency: string): { customerId: string; batches: { results: GoogleAdsResult[] }[] } {
  const ads = demoAdsFor("google");
  const results: GoogleAdsResult[] = [];
  for (const date of dateRange(window.since, window.until)) {
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      const claim = platformClaim(ad, date, currency);
      results.push({
        customer: { id: ad.account.externalId, currencyCode: currency, descriptiveName: ad.account.name, timeZone: ad.account.timezone },
        campaign: { id: ad.campaign.externalId, name: ad.campaign.name, status: "ENABLED", advertisingChannelType: ad.campaign.objective },
        adGroup: { id: ad.group.externalId, name: ad.group.name, status: "ENABLED" },
        adGroupAd: { ad: { id: ad.ad.externalId, name: ad.ad.name }, status: "ENABLED" },
        segments: { date },
        metrics: {
          costMicros: String(Math.round(m.spend * 1_000_000)),
          impressions: String(m.impressions),
          clicks: String(m.clicks),
          conversions: Math.round((claim.leads + claim.purchases) * 100) / 100,
          conversionsValue: claim.value,
        },
      });
    }
  }
  return { customerId: ads[0].account.externalId, batches: [{ results }] };
}

// ---------------------------------------------------------------- connectors

export const metaConnector: AdsConnector = {
  platform: "meta",
  meta: {
    provider: "meta",
    name: "Meta Ads",
    category: "ads",
    description: "Facebook and Instagram spend, impressions and clicks per campaign, ad set and ad.",
    status: "stable",
    color: "#0866ff",
    docsUrl: "https://developers.facebook.com/docs/marketing-api/get-started",
    oauth: { label: "Meta", env: ["META_APP_ID", "META_APP_SECRET"], optionalEnv: ["META_LOGIN_CONFIG_ID"], scopes: ["ads_read"] },
    fields: [
      { name: "adAccountIds", label: "Ad account IDs", placeholder: "act_1234567890, act_987…", hint: "Comma-separated. Ads Manager → account dropdown." },
      { name: "accessToken", label: "Access token", secret: true, placeholder: "EAAB…", hint: "A System User token with ads_read permission (never expires)." },
      { name: "apiVersion", label: "API version", placeholder: META_API_VERSION_DEFAULT, optional: true },
      { name: "capiEnabled", label: "Send leads & purchases to Meta (Conversions API)", type: "toggle", optional: true, hint: "Server-side events with hashed email/phone and click IDs improve Meta's optimization." },
      { name: "pixelId", label: "Pixel (dataset) ID", placeholder: "1234567890", optional: true, hint: "Events Manager → Data sources → your pixel." },
      { name: "capiAccessToken", label: "Conversions API token", secret: true, optional: true, hint: "Events Manager → Settings → Generate access token. Defaults to the access token above." },
      { name: "testEventCode", label: "Test event code", placeholder: "TEST12345", optional: true, hint: "Events Manager → Test events. Clear it once events show up." },
    ],
    steps: [
      "Business Settings → Users → System users → Add a system user (Admin).",
      "Add assets → Ad accounts → give it View performance access.",
      "Generate new token → pick any app → tick `ads_read` → paste the token here.",
      "Optional: switch on the Conversions API and add your pixel ID to send leads and purchases back to Meta. If the browser pixel already sends the same Lead/Purchase events, use another dataset or Meta counts them twice.",
    ],
  },
  fetchLive: (conn, window) => fetchMetaLive(conn, window),
  mock: (window, currency) => mockMetaInsights(window, currency).flatMap((a) => parseMetaInsights(a.rows, a.account)),
};

export const googleConnector: AdsConnector = {
  platform: "google",
  meta: {
    provider: "google_ads",
    name: "Google Ads",
    category: "ads",
    description: "Search, Performance Max, YouTube and Display cost per campaign, ad group and ad.",
    status: "stable",
    color: "#ea4335",
    docsUrl: "https://developers.google.com/google-ads/api/docs/first-call/overview",
    oauth: {
      label: "Google",
      env: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_ADS_DEVELOPER_TOKEN"],
      // adwords: reporting. datamanager: conversion uploads (Data Manager API, replaces uploadClickConversions).
      scopes: ["https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/datamanager"],
    },
    fields: [
      { name: "customerIds", label: "Customer IDs", placeholder: "123-456-7890", hint: "Comma-separated account IDs to import." },
      { name: "loginCustomerId", label: "Manager (MCC) ID", placeholder: "111-222-3333", optional: true, hint: "Only if you access the accounts through a manager account." },
      { name: "developerToken", label: "Developer token", secret: true, hint: "Google Ads → Tools → API Center." },
      { name: "clientId", label: "OAuth client ID", placeholder: "…apps.googleusercontent.com" },
      { name: "clientSecret", label: "OAuth client secret", secret: true },
      { name: "refreshToken", label: "OAuth refresh token", secret: true, hint: "From the OAuth Playground with the scopes https://www.googleapis.com/auth/adwords and https://www.googleapis.com/auth/datamanager." },
      { name: "apiVersion", label: "API version", placeholder: GOOGLE_ADS_API_VERSION_DEFAULT, optional: true },
      { name: "conversionUploads", label: "Upload conversions to Google Ads", type: "toggle", optional: true, hint: "Offline click conversions (gclid/gbraid/wbraid) and enhanced conversions for leads, sent through the Google Data Manager API with consent signals." },
      { name: "leadConversionActionId", label: "Lead conversion action ID", placeholder: "987654321", optional: true, hint: "Goals → Conversions → an Import (clicks) action → its ctId." },
      { name: "purchaseConversionActionId", label: "Purchase conversion action ID", placeholder: "987654322", optional: true },
      { name: "uploadCustomerId", label: "Conversion account ID", placeholder: "123-456-7890", optional: true, hint: "Account that owns the conversion actions. Defaults to the first customer ID." },
    ],
    steps: [
      "Apply for a developer token in Google Ads → Tools → API Center (a test account token works immediately).",
      "Google Cloud Console → enable the Google Ads API (and the Data Manager API for conversion uploads) → create an OAuth client (Web, redirect https://developers.google.com/oauthplayground).",
      "OAuth Playground → use your own credentials → authorize the adwords and datamanager scopes → exchange for a refresh token.",
      "Optional: create Import → Clicks conversion actions for leads and purchases, switch on uploads and paste their IDs to send conversions back to Google Ads.",
    ],
  },
  fetchLive: (conn, window) => fetchGoogleLive(conn, window),
  mock: (window, currency) => {
    const s = mockGoogleStream(window, currency);
    return parseGoogleAdsStream(s.batches, s.customerId);
  },
};
