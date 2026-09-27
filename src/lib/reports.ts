import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { rows, type DB } from "./db";
import type { AttributionModel, Platform } from "./db/schema";
import { AD_PLATFORMS } from "./connectors/types";
import { hashEmail } from "./crypto";
import type { Workspace } from "./settings";

// All numbers are computed in SQL here. The UI, REST API, MCP server and AI facts
// pack all read from these functions, so they always agree.

export const reportParams = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  model: z.enum(["first_touch", "last_touch", "linear"]).default("last_touch"),
  platform: z.enum(AD_PLATFORMS).optional(),
});
export type ReportParams = z.infer<typeof reportParams>;

const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

/** Local-midnight bounds of [start, end] in the workspace timezone (end inclusive). */
function tsRange(col: SQL, ws: Workspace, p: ReportParams) {
  return sql`${col} >= (${p.start}::date)::timestamp at time zone ${ws.timezone}
    and ${col} < ((${p.end}::date + 1))::timestamp at time zone ${ws.timezone}`;
}
const platformFilter = (col: string, p: ReportParams) => (p.platform ? sql`and ${sql.raw(col)} = ${p.platform}` : sql``);

export function previousPeriod(p: ReportParams): ReportParams {
  const s = Date.parse(`${p.start}T00:00:00Z`);
  const e = Date.parse(`${p.end}T00:00:00Z`);
  const len = Math.round((e - s) / 86_400_000) + 1;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { ...p, start: iso(s - len * 86_400_000), end: iso(s - 86_400_000) };
}

export type Overview = {
  currency: string;
  model: AttributionModel;
  start: string;
  end: string;
  spendMinor: number;
  impressions: number;
  clicks: number;
  leads: number;
  paidLeads: number;
  customers: number;
  paidCustomers: number;
  revenueMinor: number;
  attributedRevenueMinor: number;
  unattributedRevenueMinor: number;
  roas: number | null;
  blendedRoas: number | null;
  cplMinor: number | null;
  cacMinor: number | null;
  unattributedShare: number | null;
  warnings: string[];
};

export async function overview(db: DB, ws: Workspace, p: ReportParams): Promise<Overview> {
  const rc = ws.reportingCurrency;
  const [spend] = rows<{ spend: string; imp: string; clicks: string }>(
    await db.execute(sql`
      select coalesce(sum(spend_minor),0) spend, coalesce(sum(impressions),0) imp, coalesce(sum(clicks),0) clicks
      from ad_insights_daily
      where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date
        and currency = ${rc} ${platformFilter("platform", p)}`),
  );
  const [conv] = rows<Record<string, string>>(
    await db.execute(sql`
      select
        count(distinct conversion_id) filter (where conversion_type = 'lead') leads,
        coalesce(sum(credit) filter (where conversion_type = 'lead' and campaign_id is not null ${platformFilter("platform", p)}), 0) paid_leads,
        count(distinct conversion_id) filter (where conversion_type = 'customer') customers,
        coalesce(sum(credit) filter (where conversion_type = 'customer' and campaign_id is not null ${platformFilter("platform", p)}), 0) paid_customers,
        coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc}), 0) revenue,
        coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc} and campaign_id is not null ${platformFilter("platform", p)}), 0) attributed,
        coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc} and touchpoint_id is null), 0) unattributed
      from attribution_credits
      where workspace_id = ${ws.id} and model = ${p.model} and ${tsRange(sql`conversion_at`, ws, p)}`),
  );
  const warnings = await currencyWarnings(db, ws, p);

  const spendMinor = n(spend.spend);
  const revenueMinor = n(conv.revenue);
  const attributed = n(conv.attributed);
  const leads = n(conv.leads);
  const customers = n(conv.customers);
  const paidLeads = n(conv.paid_leads);
  const paidCustomers = n(conv.paid_customers);
  const unattributed = n(conv.unattributed);
  return {
    currency: rc,
    model: p.model,
    start: p.start,
    end: p.end,
    spendMinor,
    impressions: n(spend.imp),
    clicks: n(spend.clicks),
    leads,
    paidLeads: Math.round(paidLeads * 100) / 100,
    customers,
    paidCustomers: Math.round(paidCustomers * 100) / 100,
    revenueMinor,
    attributedRevenueMinor: attributed,
    unattributedRevenueMinor: unattributed,
    roas: ratio(attributed, spendMinor),
    blendedRoas: ratio(revenueMinor, spendMinor),
    cplMinor: paidLeads > 0 ? Math.round(spendMinor / paidLeads) : null,
    cacMinor: paidCustomers > 0 ? Math.round(spendMinor / paidCustomers) : null,
    unattributedShare: ratio(unattributed, revenueMinor),
    warnings,
  };
}

async function currencyWarnings(db: DB, ws: Workspace, p: ReportParams): Promise<string[]> {
  const out: string[] = [];
  const spendOther = rows<{ currency: string }>(
    await db.execute(sql`select distinct currency from ad_insights_daily
      where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency <> ${ws.reportingCurrency}`),
  );
  const revOther = rows<{ currency: string }>(
    await db.execute(sql`select distinct currency from revenue_events
      where workspace_id = ${ws.id} and currency <> ${ws.reportingCurrency} and ${tsRange(sql`occurred_at`, ws, p)}`),
  );
  if (spendOther.length) out.push(`Ad spend in ${spendOther.map((r) => r.currency).join(", ")} is excluded from totals (reporting currency is ${ws.reportingCurrency}).`);
  if (revOther.length) out.push(`Revenue in ${revOther.map((r) => r.currency).join(", ")} is excluded from totals (reporting currency is ${ws.reportingCurrency}).`);
  return out;
}

export type PerfLevel = "campaign" | "ad_group" | "ad";
export type PerfRow = {
  id: string;
  name: string;
  platform: Platform;
  status: string | null;
  parentId: string | null;
  parentName: string | null;
  spendMinor: number;
  impressions: number;
  clicks: number;
  leads: number;
  customers: number;
  revenueMinor: number;
  roas: number | null;
  cplMinor: number | null;
  cacMinor: number | null;
  ctr: number | null;
};

export async function performance(
  db: DB,
  ws: Workspace,
  p: ReportParams & { level: PerfLevel; parentId?: string },
): Promise<PerfRow[]> {
  const rc = ws.reportingCurrency;
  const cfg = {
    campaign: { table: "campaigns", key: "campaign_id", parent: null, parentTable: null },
    ad_group: { table: "ad_groups", key: "ad_group_id", parent: "campaign_id", parentTable: "campaigns" },
    ad: { table: "ads", key: "ad_id", parent: "ad_group_id", parentTable: "ad_groups" },
  }[p.level];
  const key = sql.raw(cfg.key);
  const parentSel = cfg.parent
    ? sql.raw(`e.${cfg.parent} as parent_id, pe.name as parent_name`)
    : sql.raw(`null::uuid as parent_id, null::text as parent_name`);
  const parentJoin = cfg.parentTable ? sql.raw(`left join ${cfg.parentTable} pe on pe.id = e.${cfg.parent}`) : sql``;
  const parentWhere = p.parentId && cfg.parent ? sql`and e.${sql.raw(cfg.parent)} = ${p.parentId}::uuid` : sql``;

  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      with s as (
        select ${key} as id, sum(spend_minor) spend, sum(impressions) imp, sum(clicks) clicks
        from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
        group by 1
      ), c as (
        select ${key} as id,
          sum(credit) filter (where conversion_type = 'lead') leads,
          sum(credit) filter (where conversion_type = 'customer') customers,
          sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc}) revenue
        from attribution_credits
        where workspace_id = ${ws.id} and model = ${p.model} and ${key} is not null
          and ${tsRange(sql`conversion_at`, ws, p)}
        group by 1
      )
      select e.id, e.name, e.platform, e.status, ${parentSel},
        coalesce(s.spend, 0) spend, coalesce(s.imp, 0) imp, coalesce(s.clicks, 0) clicks,
        coalesce(c.leads, 0) leads, coalesce(c.customers, 0) customers, coalesce(c.revenue, 0) revenue
      from ${sql.raw(cfg.table)} e
      left join s on s.id = e.id
      left join c on c.id = e.id
      ${parentJoin}
      where e.workspace_id = ${ws.id} and (s.id is not null or c.id is not null)
        ${platformFilter("e.platform", p)} ${parentWhere}
      order by coalesce(s.spend, 0) desc, e.name`),
  );
  return result.map((r) => {
    const spendMinor = n(r.spend);
    const leads = Math.round(n(r.leads) * 100) / 100;
    const customers = Math.round(n(r.customers) * 100) / 100;
    const revenueMinor = n(r.revenue);
    return {
      id: r.id!,
      name: r.name!,
      platform: r.platform as Platform,
      status: r.status,
      parentId: r.parent_id,
      parentName: r.parent_name,
      spendMinor,
      impressions: n(r.imp),
      clicks: n(r.clicks),
      leads,
      customers,
      revenueMinor,
      roas: ratio(revenueMinor, spendMinor),
      cplMinor: leads > 0 ? Math.round(spendMinor / leads) : null,
      cacMinor: customers > 0 ? Math.round(spendMinor / customers) : null,
      ctr: ratio(n(r.clicks), n(r.imp)),
    };
  });
}

export type SeriesPoint = { date: string; spendMinor: number; revenueMinor: number; attributedRevenueMinor: number; leads: number };

export async function timeseries(db: DB, ws: Workspace, p: ReportParams): Promise<SeriesPoint[]> {
  const rc = ws.reportingCurrency;
  const result = rows<Record<string, string>>(
    await db.execute(sql`
      with days as (
        select d::date as day from generate_series(${p.start}::date, ${p.end}::date, interval '1 day') d
      ), s as (
        select date as day, sum(spend_minor) spend from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
          ${platformFilter("platform", p)}
        group by 1
      ), c as (
        select (conversion_at at time zone ${ws.timezone})::date as day,
          sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc}) revenue,
          sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc} and campaign_id is not null ${platformFilter("platform", p)}) attributed,
          count(distinct conversion_id) filter (where conversion_type = 'lead') leads
        from attribution_credits
        where workspace_id = ${ws.id} and model = ${p.model} and ${tsRange(sql`conversion_at`, ws, p)}
        group by 1
      )
      select to_char(days.day, 'YYYY-MM-DD') as date, coalesce(s.spend,0) spend, coalesce(c.revenue,0) revenue,
        coalesce(c.attributed,0) attributed, coalesce(c.leads,0) leads
      from days left join s on s.day = days.day left join c on c.day = days.day
      order by days.day`),
  );
  return result.map((r) => ({
    date: r.date,
    spendMinor: n(r.spend),
    revenueMinor: n(r.revenue),
    attributedRevenueMinor: n(r.attributed),
    leads: n(r.leads),
  }));
}

export type ChannelRow = { channel: string; leads: number; customers: number; revenueMinor: number };

export async function channels(db: DB, ws: Workspace, p: ReportParams): Promise<ChannelRow[]> {
  const result = rows<Record<string, string>>(
    await db.execute(sql`
      select coalesce(channel, 'unattributed') channel,
        coalesce(sum(credit) filter (where conversion_type = 'lead'), 0) leads,
        coalesce(sum(credit) filter (where conversion_type = 'customer'), 0) customers,
        coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${ws.reportingCurrency}), 0) revenue
      from attribution_credits
      where workspace_id = ${ws.id} and model = ${p.model} and ${tsRange(sql`conversion_at`, ws, p)}
      group by 1 order by 4 desc`),
  );
  return result.map((r) => ({
    channel: r.channel,
    leads: Math.round(n(r.leads) * 100) / 100,
    customers: Math.round(n(r.customers) * 100) / 100,
    revenueMinor: n(r.revenue),
  }));
}

/** Campaigns/ads with meaningful spend and no attributed revenue. */
export async function wastedSpend(db: DB, ws: Workspace, p: ReportParams & { level?: PerfLevel; minSpendMinor?: number }) {
  const all = await performance(db, ws, { ...p, level: p.level ?? "campaign" });
  const total = all.reduce((s, r) => s + r.spendMinor, 0);
  const min = p.minSpendMinor ?? Math.max(1, Math.round(total * 0.02));
  return all
    .filter((r) => r.spendMinor >= min && (r.roas === null || r.roas < 0.5))
    .sort((a, b) => b.spendMinor - a.spendMinor);
}

export async function compare(db: DB, ws: Workspace, p: ReportParams) {
  const prev = previousPeriod(p);
  const [current, previous, curCampaigns, prevCampaigns] = await Promise.all([
    overview(db, ws, p),
    overview(db, ws, prev),
    performance(db, ws, { ...p, level: "campaign" }),
    performance(db, ws, { ...prev, level: "campaign" }),
  ]);
  const prevById = new Map(prevCampaigns.map((r) => [r.id, r]));
  const movers = curCampaigns
    .map((r) => {
      const before = prevById.get(r.id);
      return {
        id: r.id,
        name: r.name,
        platform: r.platform,
        spendMinor: r.spendMinor,
        prevSpendMinor: before?.spendMinor ?? 0,
        revenueMinor: r.revenueMinor,
        prevRevenueMinor: before?.revenueMinor ?? 0,
        roas: r.roas,
        prevRoas: before?.roas ?? null,
      };
    })
    .sort((a, b) => Math.abs(b.revenueMinor - b.prevRevenueMinor) - Math.abs(a.revenueMinor - a.prevRevenueMinor));
  return { current, previous, movers };
}

// ---------------------------------------------------------------- contacts

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

export type ContactRow = {
  id: string;
  email: string | null;
  name: string | null;
  lifecycle: string;
  firstSeenAt: string;
  firstLeadAt: string | null;
  revenueMinor: number;
  firstChannel: string | null;
  firstCampaign: string | null;
  touchpoints: number;
};

export async function listContacts(
  db: DB,
  ws: Workspace,
  q: { search?: string; lifecycle?: "lead" | "customer"; limit?: number; offset?: number; piiSearch?: boolean },
): Promise<{ rows: ContactRow[]; total: number }> {
  const search = q.search?.trim().toLowerCase();
  // Callers who only see masked emails (piiSearch: false) match names and exact emails, so search
  // can't be used to read addresses letter by letter.
  const emailMatch = q.piiSearch === false ? sql`c.email_hash = ${hashEmail(search ?? "")}` : sql`lower(c.email) like ${"%" + search + "%"}`;
  const where = sql`c.workspace_id = ${ws.id}
    ${q.lifecycle ? sql`and c.lifecycle = ${q.lifecycle}` : sql``}
    ${search ? sql`and (${emailMatch} or lower(c.name) like ${"%" + search + "%"})` : sql``}`;
  const [{ total }] = rows<{ total: string }>(await db.execute(sql`select count(*) total from contacts c where ${where}`));
  const result = rows<Record<string, string | null>>(
    await db.execute(sql`
      select c.id, c.email, c.name, c.lifecycle, c.first_seen_at,
        (select min(occurred_at) from leads l where l.contact_id = c.id) first_lead_at,
        (select coalesce(sum(amount_minor),0) from revenue_events r where r.contact_id = c.id and r.currency = ${ws.reportingCurrency}) revenue,
        ft.channel first_channel, ft.campaign_name first_campaign,
        (select count(*) from touchpoints t join visitors v on v.id = t.visitor_id where v.contact_id = c.id) touchpoints
      from contacts c
      left join lateral (
        select t.channel, cp.name campaign_name from touchpoints t
        join visitors v on v.id = t.visitor_id
        left join campaigns cp on cp.id = t.campaign_id
        where v.contact_id = c.id order by t.occurred_at limit 1
      ) ft on true
      where ${where}
      order by c.first_seen_at desc, c.id
      limit ${q.limit ?? 50} offset ${q.offset ?? 0}`),
  );
  return {
    total: n(total),
    rows: result.map((r) => ({
      id: r.id!,
      email: r.email,
      name: r.name,
      lifecycle: r.lifecycle!,
      firstSeenAt: new Date(r.first_seen_at!).toISOString(),
      firstLeadAt: r.first_lead_at ? new Date(r.first_lead_at).toISOString() : null,
      revenueMinor: n(r.revenue),
      firstChannel: r.first_channel,
      firstCampaign: r.first_campaign,
      touchpoints: n(r.touchpoints),
    })),
  };
}

export type JourneyItem =
  | { kind: "touchpoint"; at: string; channel: string; source: string | null; medium: string | null; campaign: string | null; adGroup: string | null; ad: string | null; platform: string | null; landingUrl: string | null; referrer: string | null; device: number }
  | { kind: "lead"; at: string; source: string; formName: string | null }
  | { kind: "payment" | "refund"; at: string; amountMinor: number; currency: string };

export async function journey(db: DB, ws: Workspace, contactId: string, opts: { maskEmail?: boolean } = {}) {
  const [contact] = rows<Record<string, string | null>>(
    await db.execute(sql`select id, email, name, lifecycle, first_seen_at from contacts where workspace_id = ${ws.id} and id = ${contactId}::uuid`),
  );
  if (!contact) return null;
  const visitors = rows<{ id: string }>(await db.execute(sql`select id from visitors where contact_id = ${contactId}::uuid order by first_seen_at`));
  const deviceOf = new Map(visitors.map((v, i) => [v.id, i + 1]));
  const tps = rows<Record<string, string | null>>(
    await db.execute(sql`
      select t.*, c.name campaign_name, g.name group_name, a.name ad_name
      from touchpoints t join visitors v on v.id = t.visitor_id
      left join campaigns c on c.id = t.campaign_id left join ad_groups g on g.id = t.ad_group_id left join ads a on a.id = t.ad_id
      where v.contact_id = ${contactId}::uuid order by t.occurred_at`),
  );
  const leadRows = rows<Record<string, string | null>>(
    await db.execute(sql`select occurred_at, source, form_name from leads where contact_id = ${contactId}::uuid order by occurred_at`),
  );
  const money = rows<Record<string, string | null>>(
    await db.execute(sql`select occurred_at, type, amount_minor, currency from revenue_events where contact_id = ${contactId}::uuid order by occurred_at`),
  );
  const credits = rows<Record<string, string | null>>(
    await db.execute(sql`
      select ac.model, coalesce(c.name, case when ac.touchpoint_id is null then 'Unattributed' else initcap(replace(ac.channel, '_', ' ')) end) label,
        sum(ac.revenue_minor) revenue
      from attribution_credits ac left join campaigns c on c.id = ac.campaign_id
      where ac.contact_id = ${contactId}::uuid and ac.conversion_type = 'revenue'
      group by 1, 2 order by 1, 3 desc`),
  );
  const iso = (v: string | null) => new Date(v!).toISOString();
  const items: JourneyItem[] = [
    ...tps.map((t) => ({
      kind: "touchpoint" as const,
      at: iso(t.occurred_at),
      channel: t.channel!,
      source: t.utm_source,
      medium: t.utm_medium,
      campaign: t.campaign_name ?? t.utm_campaign,
      adGroup: t.group_name ?? t.utm_term,
      ad: t.ad_name ?? t.utm_content,
      platform: t.platform,
      landingUrl: t.landing_url,
      referrer: t.referrer,
      device: deviceOf.get(t.visitor_id!) ?? 1,
    })),
    ...leadRows.map((l) => ({ kind: "lead" as const, at: iso(l.occurred_at), source: l.source!, formName: l.form_name })),
    ...money.map((m) => ({ kind: m.type as "payment" | "refund", at: iso(m.occurred_at), amountMinor: n(m.amount_minor), currency: m.currency! })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    contact: {
      id: contact.id!,
      email: opts.maskEmail ? maskEmail(contact.email) : contact.email,
      name: contact.name,
      lifecycle: contact.lifecycle!,
      firstSeenAt: iso(contact.first_seen_at),
      devices: visitors.length,
    },
    items,
    credits: credits.map((c) => ({ model: c.model as AttributionModel, label: c.label!, revenueMinor: n(c.revenue) })),
  };
}

export async function syncStatus(db: DB, ws: Workspace) {
  const conns = rows<Record<string, string | boolean | null>>(
    await db.execute(sql`select provider, mode, enabled, last_synced_at, last_error from connections where workspace_id = ${ws.id} order by provider`),
  );
  const runs = rows<Record<string, string | number | null>>(
    await db.execute(sql`select provider, status, started_at, finished_at, rows_upserted, error from sync_runs
      where workspace_id = ${ws.id} order by started_at desc limit 20`),
  );
  const [counts] = rows<Record<string, string>>(
    await db.execute(sql`select
      (select count(*) from events where workspace_id = ${ws.id} and occurred_at > now() - interval '24 hours') events_24h,
      (select max(occurred_at) from events where workspace_id = ${ws.id}) last_event_at,
      (select max(occurred_at) from revenue_events where workspace_id = ${ws.id}) last_revenue_at`),
  );
  return { connections: conns, recentRuns: runs, pixel: { events24h: n(counts.events_24h), lastEventAt: counts.last_event_at, lastRevenueAt: counts.last_revenue_at } };
}

/** Earliest/latest dates with any data (so the UI can default to where data is). */
export async function dataBounds(db: DB, ws: Workspace): Promise<{ min: string | null; max: string | null }> {
  const [r] = rows<{ min: string | null; max: string | null }>(
    await db.execute(sql`select to_char(least(
        (select min(date) from ad_insights_daily where workspace_id = ${ws.id}),
        (select min((occurred_at at time zone ${ws.timezone})::date) from events where workspace_id = ${ws.id})), 'YYYY-MM-DD') as min,
      to_char(greatest(
        (select max(date) from ad_insights_daily where workspace_id = ${ws.id}),
        (select max((occurred_at at time zone ${ws.timezone})::date) from events where workspace_id = ${ws.id}),
        (select max((occurred_at at time zone ${ws.timezone})::date) from revenue_events where workspace_id = ${ws.id})), 'YYYY-MM-DD') as max`),
  );
  return r ?? { min: null, max: null };
}

export type PlatformRow = { platform: Platform; spendMinor: number; revenueMinor: number; leads: number; customers: number; roas: number | null };

/** Spend and attributed results per ad platform. */
export async function platforms(db: DB, ws: Workspace, p: ReportParams): Promise<PlatformRow[]> {
  const rc = ws.reportingCurrency;
  const result = rows<Record<string, string>>(
    await db.execute(sql`
      with s as (
        select platform, sum(spend_minor) spend from ad_insights_daily
        where workspace_id = ${ws.id} and date between ${p.start}::date and ${p.end}::date and currency = ${rc}
        group by 1
      ), c as (
        select platform,
          coalesce(sum(revenue_minor) filter (where conversion_type = 'revenue' and currency = ${rc}), 0) revenue,
          coalesce(sum(credit) filter (where conversion_type = 'lead'), 0) leads,
          coalesce(sum(credit) filter (where conversion_type = 'customer'), 0) customers
        from attribution_credits
        where workspace_id = ${ws.id} and model = ${p.model} and platform is not null and campaign_id is not null
          and ${tsRange(sql`conversion_at`, ws, p)}
        group by 1
      )
      select coalesce(s.platform, c.platform) platform, coalesce(s.spend, 0) spend, coalesce(c.revenue, 0) revenue,
        coalesce(c.leads, 0) leads, coalesce(c.customers, 0) customers
      from s full outer join c on c.platform = s.platform
      order by 2 desc`),
  );
  return result.map((r) => ({
    platform: r.platform as Platform,
    spendMinor: n(r.spend),
    revenueMinor: n(r.revenue),
    leads: Math.round(n(r.leads) * 10) / 10,
    customers: Math.round(n(r.customers) * 10) / 10,
    roas: ratio(n(r.revenue), n(r.spend)),
  }));
}
