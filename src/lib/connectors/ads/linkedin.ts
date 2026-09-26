import { adDayMetrics, dateRange, demoAdsFor } from "../../demo/world";
import { currencyExponent, fromDecimalString } from "../../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "../types";

// LinkedIn Marketing API (versioned REST): adAnalytics q=analytics, pivot=CREATIVE, DAILY.
// Docs: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting
// Mapping: campaign group → campaign, campaign → ad group, creative → ad.

export const LINKEDIN_VERSION_DEFAULT = "202609";
const API = "https://api.linkedin.com/rest";
const FIELDS = "pivotValues,dateRange,costInLocalCurrency,impressions,clicks,externalWebsiteConversions,oneClickLeads";
const MAX_DAYS = 90; // keeps each response well under the 15,000-element cap

export type LinkedInDate = { year: number; month: number; day: number };
export type LinkedInAnalyticsElement = {
  pivotValues: string[]; // ["urn:li:sponsoredCreative:123"]
  dateRange: { start: LinkedInDate; end: LinkedInDate };
  costInLocalCurrency?: string; // decimal string, e.g. "19.91833"
  impressions?: number;
  clicks?: number;
  externalWebsiteConversions?: number;
  oneClickLeads?: number;
};

type Paged<T> = { elements: T[]; metadata?: { nextPageToken?: string } };
export type LinkedInAdAccount = { id: number; name: string; currency: string };
export type LinkedInCampaignGroup = { id: number; name: string; status?: string };
export type LinkedInCampaign = { id: number; name: string; campaignGroup: string; status?: string; objectiveType?: string };
export type LinkedInCreative = { id: string; campaign: string; name?: string; intendedStatus?: string };

/** The entity list responses needed to name each creative-day. */
export type LinkedInEntities = {
  adAccount: LinkedInAdAccount;
  adCampaignGroups: Paged<LinkedInCampaignGroup>[];
  adCampaigns: Paged<LinkedInCampaign>[];
  creatives: Paged<LinkedInCreative>[];
};

const urnId = (urn: string) => urn.slice(urn.lastIndexOf(":") + 1);
const pad = (n: number) => String(n).padStart(2, "0");
const isoDate = (d: LinkedInDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

export function parseLinkedInAnalytics(elements: LinkedInAnalyticsElement[], entities: LinkedInEntities): AdDayRow[] {
  const acc = entities.adAccount;
  const currency = acc.currency.toUpperCase();
  const groups = new Map(entities.adCampaignGroups.flatMap((p) => p.elements).map((g) => [String(g.id), g]));
  const campaigns = new Map(entities.adCampaigns.flatMap((p) => p.elements).map((c) => [String(c.id), c]));
  const creatives = new Map(entities.creatives.flatMap((p) => p.elements).map((c) => [urnId(c.id), c]));
  return elements.map((e) => {
    const creativeId = urnId(e.pivotValues[0] ?? "");
    const creative = creatives.get(creativeId);
    const campaign = creative ? campaigns.get(urnId(creative.campaign)) : undefined;
    const group = campaign ? groups.get(urnId(campaign.campaignGroup)) : undefined;
    const groupId = campaign ? urnId(campaign.campaignGroup) : "";
    return {
      platform: "linkedin",
      account: { externalId: String(acc.id), name: acc.name, currency, timezone: null },
      campaign: { externalId: groupId, name: group?.name ?? (groupId ? `Campaign group ${groupId}` : "Unknown campaign group"), status: group?.status ?? null, objective: campaign?.objectiveType ?? null },
      adGroup: { externalId: campaign ? String(campaign.id) : "", name: campaign?.name ?? "Unknown campaign", status: campaign?.status ?? null },
      ad: { externalId: creativeId, name: creative?.name || `Creative ${creativeId}`, status: creative?.intendedStatus ?? null },
      date: isoDate(e.dateRange.start),
      spendMinor: fromDecimalString(e.costInLocalCurrency ?? "0", currency),
      impressions: Number(e.impressions ?? 0),
      clicks: Number(e.clicks ?? 0),
      conversions: (Number(e.externalWebsiteConversions ?? 0) + Number(e.oneClickLeads ?? 0)).toFixed(2),
    };
  });
}

function chunks(window: DateWindow, size: number): DateWindow[] {
  const days = dateRange(window.since, window.until);
  const out: DateWindow[] = [];
  for (let i = 0; i < days.length; i += size) out.push({ since: days[i], until: days[Math.min(i + size, days.length) - 1] });
  return out;
}

/** Rest.li 2.0 date range, e.g. (start:(year:2026,month:9,day:1),end:(year:2026,month:9,day:3)). */
export function linkedinDateRange(w: DateWindow): string {
  const part = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return `(year:${y},month:${m},day:${d})`;
  };
  return `(start:${part(w.since)},end:${part(w.until)})`;
}

async function linkedinAccessToken(conn: ConnectionLike): Promise<string> {
  const { accessToken, clientSecret, refreshToken } = conn.secrets;
  const clientId = conn.config.clientId;
  if (refreshToken && clientId && clientSecret) {
    const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) throw new Error(`LinkedIn OAuth error: ${body.error_description ?? body.error ?? res.status}`);
    return body.access_token;
  }
  if (!accessToken) throw new Error("LinkedIn access token is missing");
  return accessToken;
}

async function fetchLinkedInLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]> {
  const ids = (conn.config.adAccountIds ?? "").split(/[\s,]+/).map((s) => urnId(s)).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one LinkedIn ad account ID");
  const token = await linkedinAccessToken(conn);
  const headers = {
    Authorization: `Bearer ${token}`,
    "LinkedIn-Version": conn.config.apiVersion || LINKEDIN_VERSION_DEFAULT,
    "X-Restli-Protocol-Version": "2.0.0",
    Accept: "application/json",
  };
  const get = async <T>(url: string, extra: Record<string, string> = {}): Promise<T> => {
    const res = await fetch(url, { headers: { ...headers, ...extra } });
    const body = (await res.json().catch(() => null)) as (T & { message?: string; code?: string }) | null;
    if (!res.ok || !body) throw new Error(`LinkedIn API error (${res.status}): ${body?.message ?? body?.code ?? "unknown error"}`);
    return body;
  };
  const all = async <T>(url: string, pageSize: number, extra: Record<string, string> = {}): Promise<Paged<T>[]> => {
    const pages: Paged<T>[] = [];
    let pageToken: string | undefined;
    do {
      const page: Paged<T> = await get(`${url}&pageSize=${pageSize}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`, extra);
      pages.push(page);
      pageToken = page.metadata?.nextPageToken || undefined;
    } while (pageToken);
    return pages;
  };

  const out: AdDayRow[] = [];
  for (const id of ids) {
    const entities: LinkedInEntities = {
      adAccount: await get<LinkedInAdAccount>(`${API}/adAccounts/${id}`),
      adCampaignGroups: await all<LinkedInCampaignGroup>(`${API}/adAccounts/${id}/adCampaignGroups?q=search`, 1000),
      adCampaigns: await all<LinkedInCampaign>(`${API}/adAccounts/${id}/adCampaigns?q=search`, 1000),
      creatives: await all<LinkedInCreative>(`${API}/adAccounts/${id}/creatives?q=criteria`, 100, { "X-RestLi-Method": "FINDER" }),
    };
    const accountUrn = encodeURIComponent(`urn:li:sponsoredAccount:${id}`);
    for (const w of chunks(window, MAX_DAYS)) {
      // Built by hand: Rest.li needs the literal parentheses/commas that URLSearchParams would escape.
      const url = `${API}/adAnalytics?q=analytics&pivot=CREATIVE&timeGranularity=DAILY&dateRange=${linkedinDateRange(w)}&accounts=List(${accountUrn})&fields=${FIELDS}`;
      const page = await get<{ elements?: LinkedInAnalyticsElement[] }>(url);
      out.push(...parseLinkedInAnalytics(page.elements ?? [], entities));
    }
  }
  return out;
}

/** Mock LinkedIn: demo world served as adAnalytics elements plus the entity finder responses. */
export function mockLinkedIn(window: DateWindow, currency: string): { elements: LinkedInAnalyticsElement[]; entities: LinkedInEntities } {
  const ads = demoAdsFor("linkedin");
  const acc = ads[0].account;
  const uniq = <T>(xs: T[], key: (x: T) => string) => [...new Map(xs.map((x) => [key(x), x])).values()];
  const entities: LinkedInEntities = {
    adAccount: { id: Number(acc.externalId), name: acc.name, currency },
    adCampaignGroups: [{ elements: uniq(ads, (a) => a.campaign.externalId).map((a) => ({ id: Number(a.campaign.externalId), name: a.campaign.name, status: "ACTIVE" })), metadata: {} }],
    adCampaigns: [{
      elements: uniq(ads, (a) => a.group.externalId).map((a) => ({
        id: Number(a.group.externalId),
        name: a.group.name,
        campaignGroup: `urn:li:sponsoredCampaignGroup:${a.campaign.externalId}`,
        status: "ACTIVE",
        objectiveType: a.campaign.objective,
      })),
      metadata: {},
    }],
    creatives: [{ elements: ads.map((a) => ({ id: `urn:li:sponsoredCreative:${a.ad.externalId}`, campaign: `urn:li:sponsoredCampaign:${a.group.externalId}`, name: a.ad.name, intendedStatus: "ACTIVE" })), metadata: {} }],
  };
  const elements: LinkedInAnalyticsElement[] = [];
  for (const date of dateRange(window.since, window.until)) {
    const [year, month, day] = date.split("-").map(Number);
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      elements.push({
        pivotValues: [`urn:li:sponsoredCreative:${ad.ad.externalId}`],
        dateRange: { start: { year, month, day }, end: { year, month, day } },
        costInLocalCurrency: m.spend.toFixed(currencyExponent(currency)),
        impressions: m.impressions,
        clicks: m.clicks,
        externalWebsiteConversions: 0,
        oneClickLeads: Math.round(m.conversions),
      });
    }
  }
  return { elements, entities };
}

export const linkedinConnector: AdsConnector = {
  platform: "linkedin",
  meta: {
    provider: "linkedin_ads",
    name: "LinkedIn Ads",
    category: "ads",
    description: "Sponsored content and lead gen spend per campaign group, campaign and creative.",
    status: "beta",
    color: "#0a66c2",
    docsUrl: "https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting",
    fields: [
      { name: "adAccountIds", label: "Ad account IDs", placeholder: "508000001", hint: "Comma-separated. Campaign Manager → the number in the account URL." },
      { name: "accessToken", label: "Access token", secret: true, hint: "OAuth token with r_ads and r_ads_reporting scopes (valid 60 days)." },
      { name: "clientId", label: "Client ID", optional: true, hint: "Optional: with the secret and refresh token below, tokens renew automatically." },
      { name: "clientSecret", label: "Client secret", secret: true, optional: true },
      { name: "refreshToken", label: "Refresh token", secret: true, optional: true },
      { name: "apiVersion", label: "LinkedIn-Version", placeholder: LINKEDIN_VERSION_DEFAULT, optional: true, hint: "YYYYMM. Versions are supported for about a year." },
    ],
    steps: [
      "Create an app at linkedin.com/developers (it needs a LinkedIn Page) and request the Advertising API product — the Development tier is approved quickly.",
      "In Campaign Manager make sure your LinkedIn user has at least Viewer access to the ad account. You can also create a free test ad account there to try it out.",
      "In the app's Auth tab → OAuth 2.0 tools → Create token with the `r_ads` and `r_ads_reporting` scopes, then paste the access token here.",
      "Tokens last 60 days; add the client ID, secret and refresh token if your app has refresh tokens enabled so syncs keep working.",
    ],
  },
  fetchLive: (conn, window) => fetchLinkedInLive(conn, window),
  mock: (window, currency) => {
    const m = mockLinkedIn(window, currency);
    return parseLinkedInAnalytics(m.elements, m.entities);
  },
};
