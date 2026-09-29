import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ingestRevenue } from "./connectors/revenue/ingest";
import { AD_PLATFORMS, type AdDayRow, type Platform, type RevenueEventInput } from "./connectors/types";
import { schema, type DB } from "./db";
import { requestAttribution } from "./jobs";
import { matchTouchpoints } from "./matching";
import { currencyExponent, fromDecimalString } from "./money";
import { upsertAdRows } from "./sync";
import { linkVisitor, recordLead, upsertContact } from "./tracking/identity";
import type { Workspace } from "./settings";

// Generic imports for platforms without a native connector: the Spend API, the Conversions
// API and CSV uploads all go through these two functions.

const money = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(/[,\s]/g, "").replace(/^[^\d.-]+/, ""));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");

export const spendRowSchema = z.object({
  platform: z.string().trim().toLowerCase().optional(),
  account_id: z.string().trim().min(1).max(120).optional(),
  account_name: z.string().trim().max(200).optional(),
  campaign_id: z.string().trim().max(120).optional(),
  campaign_name: z.string().trim().min(1).max(300),
  ad_group_id: z.string().trim().max(120).optional(),
  ad_group_name: z.string().trim().max(300).optional(),
  ad_id: z.string().trim().max(120).optional(),
  ad_name: z.string().trim().max(300).optional(),
  date,
  spend: money,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
  impressions: z.coerce.number().int().min(0).optional(),
  clicks: z.coerce.number().int().min(0).optional(),
  conversions: z.coerce.number().min(0).optional(),
});
export type SpendRowInput = z.input<typeof spendRowSchema>;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "x";

export async function importSpend(db: DB, ws: Workspace, input: SpendRowInput[]): Promise<{ rows: number; errors: string[] }> {
  const errors: string[] = [];
  const rows: AdDayRow[] = [];
  input.slice(0, 20_000).forEach((raw, i) => {
    const r = spendRowSchema.safeParse(raw);
    if (!r.success) {
      errors.push(`Row ${i + 1}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
      return;
    }
    const v = r.data;
    const platform: Platform = (AD_PLATFORMS as readonly string[]).includes(v.platform ?? "") ? (v.platform as Platform) : "other";
    const currency = (v.currency ?? ws.reportingCurrency).toUpperCase();
    let spendMinor: number;
    try {
      spendMinor = fromDecimalString(v.spend || "0", currency);
    } catch {
      errors.push(`Row ${i + 1}: spend "${v.spend}" is not a number`);
      return;
    }
    const campaignId = v.campaign_id || `name:${slug(v.campaign_name)}`;
    const groupName = v.ad_group_name || v.campaign_name;
    const groupId = v.ad_group_id || `name:${slug(v.campaign_name)}:${slug(groupName)}`;
    const adName = v.ad_name || groupName;
    rows.push({
      platform,
      account: { externalId: v.account_id || `${platform}-import`, name: v.account_name || `${platform === "other" ? "Imported" : platform} account`, currency, timezone: null },
      campaign: { externalId: campaignId, name: v.campaign_name, status: null, objective: null },
      adGroup: { externalId: groupId, name: groupName, status: null },
      ad: { externalId: v.ad_id || `${groupId}:${slug(adName)}`, name: adName, status: null },
      date: v.date,
      spendMinor,
      impressions: v.impressions ?? 0,
      clicks: v.clicks ?? 0,
      conversions: (v.conversions ?? 0).toFixed(2),
    });
  });
  const n = rows.length ? await upsertAdRows(db, ws.id, rows) : 0;
  if (n) {
    await matchTouchpoints(db, ws.id);
    await requestAttribution(ws.id);
  }
  return { rows: n, errors: errors.slice(0, 50) };
}

export const conversionSchema = z.object({
  type: z.enum(["payment", "refund", "lead"]),
  external_id: z.string().trim().min(1).max(200),
  related_external_id: z.string().trim().max(200).optional(),
  amount: money.optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
  occurred_at: z.string().datetime({ offset: true }).optional(),
  email: z.string().trim().max(320).optional(),
  phone: z.string().trim().max(40).optional(),
  name: z.string().trim().max(200).optional(),
  visitor_id: z.string().trim().max(64).optional(),
  source: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/).optional(),
  form_name: z.string().trim().max(200).optional(),
});
export type ConversionInput = z.input<typeof conversionSchema>;

export async function importConversions(db: DB, ws: Workspace, input: ConversionInput[], defaultSource = "api") {
  const errors: string[] = [];
  const bySource = new Map<string, RevenueEventInput[]>();
  let leads = 0;
  for (const [i, raw] of input.slice(0, 5_000).entries()) {
    const r = conversionSchema.safeParse(raw);
    if (!r.success) {
      errors.push(`Event ${i + 1}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
      continue;
    }
    const v = r.data;
    const at = v.occurred_at ? new Date(v.occurred_at) : new Date();
    if (v.type === "lead") {
      await db.transaction(async (tx) => {
        const contact = await upsertContact(tx, ws.id, { email: v.email, phone: v.phone, name: v.name }, at);
        if (!contact) {
          errors.push(`Event ${i + 1}: a lead needs an email or phone`);
          return;
        }
        if (v.visitor_id) {
          const [vis] = await tx.select().from(schema.visitors).where(and(eq(schema.visitors.workspaceId, ws.id), eq(schema.visitors.anonymousId, v.visitor_id)));
          if (vis) await linkVisitor(tx, vis.id, contact.id);
        }
        await recordLead(tx, { workspaceId: ws.id, contactId: contact.id, source: "api", formName: v.form_name ?? v.source ?? null, occurredAt: at, raw: { external_id: v.external_id }, phone: v.phone });
        leads++;
      });
      continue;
    }
    const currency = (v.currency ?? ws.reportingCurrency).toUpperCase();
    let amountMinor: number;
    try {
      amountMinor = Math.abs(fromDecimalString(v.amount ?? "0", currency));
    } catch {
      errors.push(`Event ${i + 1}: amount "${v.amount}" is not a number`);
      continue;
    }
    const source = v.source ?? defaultSource;
    const list = bySource.get(source) ?? [];
    list.push({
      type: v.type,
      externalId: v.external_id,
      relatedExternalId: v.related_external_id ?? null,
      amountMinor,
      currency,
      occurredAt: at,
      customer: { email: v.email, phone: v.phone, name: v.name, visitorId: v.visitor_id },
    });
    bySource.set(source, list);
  }
  let revenue = 0;
  for (const [source, events] of bySource) revenue += await ingestRevenue(db, ws.id, source, events);
  if (revenue || leads) await requestAttribution(ws.id);
  return { revenue, leads, errors: errors.slice(0, 50) };
}

// ---- CSV

/** Upper bounds for one CSV upload (the file itself is capped at 10 MB). */
export const CSV_LIMITS = { rows: 100_000, columns: 100, fieldChars: 10_000 };

export class CsvLimitError extends Error {}

/** Minimal RFC 4180 CSV parser (quotes, escaped quotes, CRLF). Throws CsvLimitError past CSV_LIMITS. */
export function parseCsv(text: string, limits = CSV_LIMITS): Record<string, string>[] {
  const rows = parseCsvTable(text, limits);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => normalizeHeader(h));
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

/** The raw cells of a CSV file, header row included (blank lines skipped). Throws CsvLimitError past CSV_LIMITS. */
export function parseCsvTable(text: string, limits = CSV_LIMITS): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const pushField = () => {
    if (field.length > limits.fieldChars) throw new CsvLimitError(`A value is longer than ${limits.fieldChars.toLocaleString()} characters. Check the file is a real CSV.`);
    if (row.length >= limits.columns) throw new CsvLimitError(`Rows have more than ${limits.columns} columns.`);
    row.push(field);
  };
  const pushRow = () => {
    if (row.some((f) => f.trim() !== "")) {
      if (rows.length > limits.rows) throw new CsvLimitError(`The file has more than ${limits.rows.toLocaleString()} rows. Split it into smaller files.`);
      rows.push(row);
    }
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === "," || c === ";" || c === "\t") {
      pushField();
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      pushField();
      field = "";
      pushRow();
      row = [];
    } else field += c;
  }
  pushField();
  pushRow();
  return rows;
}

const ALIASES: Record<string, string> = {
  day: "date",
  reporting_starts: "date",
  cost: "spend",
  amount_spent: "spend",
  "amount_spent_(usd)": "spend",
  spend_amount: "spend",
  campaign: "campaign_name",
  campaign_id: "campaign_id",
  ad_set: "ad_group_name",
  ad_set_name: "ad_group_name",
  adset: "ad_group_name",
  ad_group: "ad_group_name",
  ad: "ad_name",
  impr: "impressions",
  "impr.": "impressions",
  link_clicks: "clicks",
  network: "platform",
  channel: "platform",
  order_id: "external_id",
  transaction_id: "external_id",
  id: "external_id",
  total: "amount",
  revenue: "amount",
  date_paid: "occurred_at",
  created_at: "occurred_at",
  customer_email: "email",
};

function normalizeHeader(h: string) {
  const k = h.replace(/^﻿/, "").trim().toLowerCase().replace(/\s+/g, "_");
  return ALIASES[k] ?? k;
}

/** Normalize a CSV date cell (YYYY-MM-DD, MM/DD/YYYY, DD.MM.YYYY) to YYYY-MM-DD. */
export function normalizeDate(v: string): string {
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const eu = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (eu) return `${eu[3]}-${eu[2].padStart(2, "0")}-${eu[1].padStart(2, "0")}`;
  return s;
}

export const SPEND_TEMPLATE = `date,platform,account_name,campaign_name,ad_group_name,ad_name,spend,currency,impressions,clicks
2026-09-01,other,Taboola,Retargeting – US,Visitors 30d,Native ad A,125.40,USD,48210,312
2026-09-01,other,Taboola,Retargeting – US,Visitors 30d,Native ad B,98.10,USD,39011,244
`;

export const REVENUE_TEMPLATE = `type,external_id,amount,currency,occurred_at,email,name,source
payment,order-1001,249.00,USD,2026-09-01T14:32:00Z,jane@example.com,Jane Doe,shop
refund,refund-1001,49.00,USD,2026-09-04T09:10:00Z,jane@example.com,Jane Doe,shop
lead,lead-5001,,,2026-09-02T10:00:00Z,sam@example.com,Sam Lee,webinar
`;

export function exampleDecimals(currency: string) {
  return currencyExponent(currency);
}
