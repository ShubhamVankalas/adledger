import { inflateRawSync } from "node:zlib";
import { adDayMetrics, dateRange, demoAdsFor } from "../../demo/world";
import { currencyExponent, fromDecimalString } from "../../money";
import type { AdDayRow, AdsConnector, ConnectionLike, DateWindow } from "../types";

// Microsoft Advertising Reporting API v13 (REST/JSON): SubmitGenerateReport (AdPerformanceReportRequest,
// Daily) → PollGenerateReport → download a zipped CSV.
// Docs: https://learn.microsoft.com/en-us/advertising/guides/request-download-report

export const MICROSOFT_COLUMNS = [
  "TimePeriod", "AccountId", "AccountName", "CurrencyCode",
  "CampaignId", "CampaignName", "CampaignStatus", "CampaignType",
  "AdGroupId", "AdGroupName", "AdGroupStatus",
  "AdId", "AdTitle", "AdStatus",
  "Impressions", "Clicks", "Spend", "ConversionsQualified",
] as const;

const HOSTS = {
  production: {
    reporting: "https://reporting.api.bingads.microsoft.com/Reporting/v13",
    token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scope: "https://ads.microsoft.com/msads.manage offline_access",
  },
  sandbox: {
    reporting: "https://reporting.api.sandbox.bingads.microsoft.com/Reporting/v13",
    token: "https://login.live-int.com/oauth20_token.srf",
    scope: "bingads.manage",
  },
};

// ---------------------------------------------------------------- ZIP (deflate) reader

/** Minimal ZIP reader (stored + deflate entries) using the central directory. No CRC check. */
export function readZip(buf: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Microsoft Ads report is not a valid ZIP file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Corrupt ZIP central directory");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Corrupt ZIP local header");
    const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(start, start + compressedSize);
    if (name.endsWith("/")) continue;
    if (method === 0) out.push({ name, data: Buffer.from(raw) });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`Unsupported ZIP compression method ${method}`);
  }
  return out;
}

// ---------------------------------------------------------------- CSV

/** RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

const clean = (v: string | undefined) => {
  const t = (v ?? "").trim();
  return t === "--" ? "" : t;
};
const numeric = (v: string | undefined) => clean(v).replace(/,/g, "") || "0";

/** "2026-09-20" or "9/20/2026" → "2026-09-20". */
function isoDate(v: string): string {
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
  return us ? `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}` : v.slice(0, 10);
}

/** AdPerformanceReport CSV (column headers on, report header/footer off) → rows. */
export function parseMicrosoftAdPerformanceCsv(csv: string, fallbackCurrency = "USD"): AdDayRow[] {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return [];
  const idx = new Map(header.map((h, i) => [h.trim(), i]));
  const col = (r: string[], name: (typeof MICROSOFT_COLUMNS)[number]) => clean(r[idx.get(name) ?? -1]);
  return rows
    .filter((r) => col(r, "AdId") && col(r, "TimePeriod"))
    .map((r) => {
      const currency = (col(r, "CurrencyCode") || fallbackCurrency).toUpperCase();
      const adId = col(r, "AdId");
      return {
        platform: "microsoft" as const,
        account: { externalId: col(r, "AccountId"), name: col(r, "AccountName") || `Microsoft Ads ${col(r, "AccountId")}`, currency, timezone: null },
        campaign: { externalId: col(r, "CampaignId"), name: col(r, "CampaignName"), status: col(r, "CampaignStatus") || null, objective: col(r, "CampaignType") || null },
        adGroup: { externalId: col(r, "AdGroupId"), name: col(r, "AdGroupName"), status: col(r, "AdGroupStatus") || null },
        ad: { externalId: adId, name: col(r, "AdTitle") || `Ad ${adId}`, status: col(r, "AdStatus") || null },
        date: isoDate(col(r, "TimePeriod")),
        spendMinor: fromDecimalString(numeric(col(r, "Spend")), currency),
        impressions: Number(numeric(col(r, "Impressions"))),
        clicks: Number(numeric(col(r, "Clicks"))),
        conversions: Number(numeric(col(r, "ConversionsQualified"))).toFixed(2),
      };
    });
}

// ---------------------------------------------------------------- live

type Env = (typeof HOSTS)["production"];

async function microsoftAccessToken(conn: ConnectionLike, env: Env): Promise<string> {
  const clientId = conn.config.clientId;
  const { clientSecret, refreshToken } = conn.secrets;
  if (!clientId || !refreshToken) throw new Error("Microsoft Ads client ID and refresh token are required");
  const res = await fetch(env.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      scope: env.scope,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Microsoft Ads OAuth error: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token;
}

type MsError = { Message?: string; Code?: number | string; OperationErrors?: { Code?: number; Message?: string }[]; BatchErrors?: { Message?: string }[] };

function msErrorMessage(body: MsError | null): string {
  const e = body?.OperationErrors?.[0] ?? body?.BatchErrors?.[0] ?? body;
  return e?.Message ?? "unknown error";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function microsoftReportRequest(accountId: string, window: DateWindow, timeZone?: string) {
  const d = (s: string) => {
    const [Year, Month, Day] = s.split("-").map(Number);
    return { Day, Month, Year };
  };
  return {
    ReportRequest: {
      Type: "AdPerformanceReportRequest",
      ReportName: `AdLedger ${accountId} ${window.since}..${window.until}`,
      Format: "Csv",
      FormatVersion: "2.0",
      ExcludeColumnHeaders: false,
      ExcludeReportHeader: true,
      ExcludeReportFooter: true,
      ReturnOnlyCompleteData: false,
      Aggregation: "Daily",
      Columns: [...MICROSOFT_COLUMNS],
      Scope: { AccountIds: [Number(accountId)] },
      Time: { CustomDateRangeStart: d(window.since), CustomDateRangeEnd: d(window.until), ...(timeZone ? { ReportTimeZone: timeZone } : {}) },
    },
  };
}

async function fetchMicrosoftLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]> {
  const devToken = conn.secrets.developerToken;
  if (!devToken) throw new Error("Microsoft Ads developer token is missing");
  const customerId = (conn.config.customerId ?? "").trim();
  if (!customerId) throw new Error("Microsoft Ads customer ID is missing");
  const ids = (conn.config.accountIds ?? "").split(/[\s,]+/).filter(Boolean);
  if (ids.length === 0) throw new Error("Add at least one Microsoft Ads account ID");
  const env = conn.config.environment === "sandbox" ? HOSTS.sandbox : HOSTS.production;
  const token = await microsoftAccessToken(conn, env);

  const call = async <T>(path: string, accountId: string, body: unknown): Promise<T> => {
    const res = await fetch(`${env.reporting}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        DeveloperToken: devToken,
        CustomerId: customerId,
        CustomerAccountId: accountId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as (T & MsError) | null;
    if (!res.ok || !json) throw new Error(`Microsoft Ads API error (${res.status}): ${msErrorMessage(json)}`);
    return json;
  };

  const out: AdDayRow[] = [];
  for (const accountId of ids) {
    const { ReportRequestId } = await call<{ ReportRequestId?: string }>(
      "/GenerateReport/Submit",
      accountId,
      microsoftReportRequest(accountId, window, conn.config.reportTimeZone || undefined),
    );
    if (!ReportRequestId) throw new Error("Microsoft Ads API error: no report request id returned");

    let url: string | null | undefined;
    for (let attempt = 0; ; attempt++) {
      const { ReportRequestStatus: s } = await call<{ ReportRequestStatus?: { Status?: string; ReportDownloadUrl?: string | null } }>(
        "/GenerateReport/Poll",
        accountId,
        { ReportRequestId },
      );
      if (s?.Status === "Success") {
        url = s.ReportDownloadUrl;
        break;
      }
      if (s?.Status === "Error") throw new Error(`Microsoft Ads report for account ${accountId} failed`);
      if (attempt >= 60) throw new Error(`Microsoft Ads report for account ${accountId} timed out`);
      await sleep(Math.min(2000 + attempt * 1000, 10_000));
    }
    if (!url) continue; // Success with no URL = no data in the window

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Microsoft Ads report download failed (${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const files = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50 ? readZip(buf) : [{ name: "report.csv", data: buf }];
    for (const f of files) out.push(...parseMicrosoftAdPerformanceCsv(f.data.toString("utf8")));
  }
  return out;
}

// ---------------------------------------------------------------- mock

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Mock Microsoft Ads: demo world rendered as the AdPerformanceReport CSV (the file inside the ZIP). */
export function mockMicrosoftCsv(window: DateWindow, currency: string): string {
  const ads = demoAdsFor("microsoft");
  const lines = [MICROSOFT_COLUMNS.map(csvCell).join(",")];
  for (const date of dateRange(window.since, window.until)) {
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      const row: Record<(typeof MICROSOFT_COLUMNS)[number], string | number> = {
        TimePeriod: date,
        AccountId: ad.account.externalId,
        AccountName: ad.account.name,
        CurrencyCode: currency,
        CampaignId: ad.campaign.externalId,
        CampaignName: ad.campaign.name,
        CampaignStatus: "Active",
        CampaignType: "Search & content",
        AdGroupId: ad.group.externalId,
        AdGroupName: ad.group.name,
        AdGroupStatus: "Active",
        AdId: ad.ad.externalId,
        AdTitle: ad.ad.name,
        AdStatus: "Active",
        Impressions: m.impressions,
        Clicks: m.clicks,
        Spend: m.spend.toFixed(currencyExponent(currency)),
        ConversionsQualified: m.conversions.toFixed(2),
      };
      lines.push(MICROSOFT_COLUMNS.map((c) => csvCell(row[c])).join(","));
    }
  }
  return lines.join("\r\n") + "\r\n";
}

export const microsoftConnector: AdsConnector = {
  platform: "microsoft",
  meta: {
    provider: "microsoft_ads",
    name: "Microsoft Ads",
    category: "ads",
    description: "Bing, Yahoo and Microsoft Audience Network cost per campaign, ad group and ad.",
    status: "beta",
    color: "#00a4ef",
    docsUrl: "https://learn.microsoft.com/en-us/advertising/guides/get-started",
    fields: [
      { name: "customerId", label: "Customer ID", placeholder: "123456789", hint: "Microsoft Advertising → Settings → Accounts & billing (the manager account / CID)." },
      { name: "accountIds", label: "Account IDs", placeholder: "180000001", hint: "Comma-separated account IDs (not account numbers)." },
      { name: "developerToken", label: "Developer token", secret: true, hint: "developers.ads.microsoft.com → Account → Developer token." },
      { name: "clientId", label: "OAuth client (application) ID", placeholder: "00000000-0000-…" },
      { name: "clientSecret", label: "OAuth client secret", secret: true, optional: true, hint: "Only for Web app registrations." },
      { name: "refreshToken", label: "OAuth refresh token", secret: true, hint: "Scope https://ads.microsoft.com/msads.manage offline_access." },
      { name: "reportTimeZone", label: "Report time zone", placeholder: "EasternTimeUSCanada", optional: true, hint: "Microsoft time zone name; leave empty for the API default." },
      { name: "environment", label: "Environment", placeholder: "production", optional: true, hint: "Type `sandbox` to use the Microsoft Ads sandbox." },
    ],
    steps: [
      "Sign in at developers.ads.microsoft.com with your Microsoft Advertising user and request a developer token (the shared sandbox token `BBD37VB98` works for sandbox accounts).",
      "In the Azure portal → App registrations, register an app (Web, redirect http://localhost) and create a client secret.",
      "Open the consent URL for your app with scope `https://ads.microsoft.com/msads.manage offline_access`, sign in, and exchange the returned code for a refresh token.",
      "Copy the Customer ID and Account IDs from the Microsoft Advertising URL (cid= and aid=) and paste everything here.",
    ],
  },
  fetchLive: (conn, window) => fetchMicrosoftLive(conn, window),
  mock: (window, currency) => parseMicrosoftAdPerformanceCsv(mockMicrosoftCsv(window, currency), currency),
};
