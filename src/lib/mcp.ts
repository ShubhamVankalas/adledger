import { desc, eq, sql } from "drizzle-orm";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { buildFacts } from "./ai/facts";
import { getIntegration } from "./connectors/registry";
import { AD_PLATFORMS } from "./connectors/types";
import { templateReport } from "./ai/report";
import { getDb, rows, schema } from "./db";
import { formatMoney } from "./money";
import {
  compare,
  dataBounds,
  journey,
  listContacts,
  maskEmail,
  overview,
  performance,
  platforms,
  syncStatus,
  timeseries,
  wastedSpend,
  type ReportParams,
} from "./reports";
import { storedStages } from "./pipeline";
import { stageFunnel } from "./reports-pipeline";
import { contactReceipt, paymentReceipt, type ContactReceipt, type EarnedLine } from "./reports-profit";
import type { Workspace } from "./settings";
import { MCP_TOOL_NAMES } from "./mcp-tools";

// Read-only MCP server. Every tool only reads through lib/reports (no writes).
// v0.2+ write tools must create things paused/draft and require confirmation.

const period = {
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (workspace timezone). Defaults to 30 days before `end`."),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD, inclusive. Defaults to the latest day with data."),
  model: z.enum(["first_touch", "last_touch", "linear"]).optional().describe("Attribution model (default linear)."),
};
const platform = z.enum(AD_PLATFORMS).optional().describe("Limit to one ad platform.");

async function resolvePeriod(ws: Workspace, a: { start?: string; end?: string; model?: ReportParams["model"]; platform?: ReportParams["platform"] }): Promise<ReportParams> {
  const db = await getDb();
  const end = a.end ?? (await dataBounds(db, ws)).max ?? new Date().toISOString().slice(0, 10);
  const start = a.start ?? new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return { start, end, model: a.model ?? "linear", platform: a.platform };
}

const header = (ws: Workspace, p: ReportParams) =>
  `Period ${p.start} → ${p.end} (${ws.timezone}) · currency ${ws.reportingCurrency} · attribution model ${p.model}${p.platform ? ` · platform ${p.platform}` : ""}`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export { MCP_TOOL_NAMES };

const DAY_MS = 86_400_000;
const MAX_SERIES_DAYS = 400;
const STALE_AFTER_MS = 48 * 3_600_000;

// Strips Latin accents (é → e) but keeps letters of every script, so names like
// "दिवाली सेल" or "Распродажа" stay searchable.
const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, " ")
    .trim();

/** Error text safe to show an agent: credentials in URLs/headers and emails are masked. */
function scrubError(message: string): string {
  const masked = message
    .replace(/\b(access_token|refresh_token|token|api_?key|key|secret|client_secret|password|signature|sig)=([^&\s"']+)/gi, "$1=***")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, "$1 ***")
    .replace(/[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[a-z]{2,}/gi, "[email]");
  return masked.replace(/\s+/g, " ").slice(0, 160);
}

/** Levenshtein distance, giving up (returns max + 1) once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How well `name` matches `query` (0 = no match, 100 = identical). Case, accents and
 * punctuation are ignored; every query word must match a name word exactly, by prefix,
 * as a substring or with a small typo, so "retarget sumer" finds "Retargeting – Summer Sale".
 */
export function fuzzyScore(query: string, name: string): number {
  const q = normalize(query);
  const n = normalize(name);
  if (!q || !n) return 0;
  if (q === n) return 100;
  // Whole-phrase hit: at a word start, or mid-word only for 4+ characters (so "a" or "me"
  // don't match every name containing those letters).
  if (n.startsWith(q)) return 90;
  if (` ${n}`.includes(` ${q}`) || (q.length >= 4 && n.includes(q))) return 80;
  const words = n.split(" ");
  const tokens = q.split(" ");
  let points = 0;
  for (const t of tokens) {
    if (words.includes(t)) points += 3;
    else if (words.some((w) => w.startsWith(t) || (t.length >= 4 && w.includes(t)))) points += 2;
    else if (t.length >= 4 && words.some((w) => editDistance(t, w.slice(0, t.length + 1), 2) <= (t.length >= 7 ? 2 : 1))) points += 1;
    else return 0;
  }
  return 20 + Math.round((points / (3 * tokens.length)) * 50);
}

type Health = "ok" | "error" | "stale" | "never_synced" | "disabled" | "active";

/** Health of one connection; `syncs` is false for push-only integrations (notifications, LLM). */
function connectionHealth(c: { enabled: boolean; lastSyncedAt: Date | null; lastError: string | null }, syncs: boolean, now: number): Health {
  if (!c.enabled) return "disabled";
  if (c.lastError) return "error";
  if (!syncs) return "active";
  if (!c.lastSyncedAt) return "never_synced";
  return now - c.lastSyncedAt.getTime() > STALE_AFTER_MS ? "stale" : "ok";
}

export function buildMcpHandler(ws: Workspace) {
  const money = (v: number | null) => (v === null ? "n/a" : formatMoney(v, ws.reportingCurrency));
  const x = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(2)}x`);

  return createMcpHandler(
    (server) => {
      server.registerTool(
        "get_overview",
        {
          title: "Overview KPIs",
          description: "Total ad spend, revenue, ROAS, leads, customers, CPL, CAC and unattributed share for a period.",
          inputSchema: z.object({ ...period, platform }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const p = await resolvePeriod(ws, args);
          const o = await overview(db, ws, p);
          return text(
            [
              header(ws, p),
              `Spend ${money(o.spendMinor)} · Revenue ${money(o.revenueMinor)} (attributed to ads ${money(o.attributedRevenueMinor)}, unattributed ${money(o.unattributedRevenueMinor)})`,
              `ROAS ${x(o.roas)} (blended ${x(o.blendedRoas)}) · Leads ${o.leads} (from ads ${o.paidLeads}) · Customers ${o.customers} (from ads ${o.paidCustomers})`,
              `CPL ${money(o.cplMinor)} · CAC ${money(o.cacMinor)} · Clicks ${o.clicks} · Impressions ${o.impressions}`,
              ...o.warnings.map((w) => `Warning: ${w}`),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "get_performance",
        {
          title: "Performance by campaign / ad group / ad",
          description: "Spend, attributed leads, customers, revenue and ROAS per campaign, ad group (ad set) or ad, sorted by spend.",
          inputSchema: z.object({
            ...period,
            platform,
            level: z.enum(["campaign", "ad_group", "ad"]).optional().describe("Default campaign."),
            limit: z.number().int().min(1).max(200).optional(),
          }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const p = await resolvePeriod(ws, args);
          const rowsOut = (await performance(db, ws, { ...p, level: args.level ?? "campaign" })).slice(0, args.limit ?? 50);
          const lines = rowsOut.map(
            (r) =>
              `| ${r.name}${r.parentName ? ` (in ${r.parentName})` : ""} | ${r.platform} | ${money(r.spendMinor)} | ${r.leads} | ${r.customers} | ${money(r.revenueMinor)} | ${x(r.roas)} | ${money(r.cplMinor)} | ${money(r.cacMinor)} |`,
          );
          return text(
            [header(ws, p), "", "| Name | Platform | Spend | Leads | Customers | Revenue | ROAS | CPL | CAC |", "|---|---|---|---|---|---|---|---|---|", ...lines].join("\n"),
          );
        },
      );

      server.registerTool(
        "find_wasted_spend",
        {
          title: "Wasted spend",
          description: "Campaigns or ads with meaningful spend but little or no attributed revenue (ROAS < 0.5).",
          inputSchema: z.object({ ...period, platform, level: z.enum(["campaign", "ad_group", "ad"]).optional() }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const p = await resolvePeriod(ws, args);
          const rowsOut = await wastedSpend(db, ws, { ...p, level: args.level ?? "campaign" });
          const total = rowsOut.reduce((s, r) => s + r.spendMinor, 0);
          return text(
            [
              header(ws, p),
              `Wasted spend total: ${money(total)} across ${rowsOut.length} ${args.level ?? "campaign"}(s)`,
              ...rowsOut.map((r) => `- ${r.name} (${r.platform}): spend ${money(r.spendMinor)}, revenue ${money(r.revenueMinor)}, ROAS ${x(r.roas)}, leads ${r.leads}`),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "compare_periods",
        {
          title: "Compare with previous period",
          description: "Compare KPIs with the immediately preceding period of equal length and list the campaigns that moved most.",
          inputSchema: z.object({ ...period }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const p = await resolvePeriod(ws, args);
          const c = await compare(db, ws, p);
          const kpi = (label: string, cur: string, prev: string) => `- ${label}: ${cur} (previous ${prev})`;
          return text(
            [
              header(ws, p),
              `Previous period: ${c.previous.start} → ${c.previous.end}`,
              kpi("Spend", money(c.current.spendMinor), money(c.previous.spendMinor)),
              kpi("Revenue", money(c.current.revenueMinor), money(c.previous.revenueMinor)),
              kpi("ROAS", x(c.current.roas), x(c.previous.roas)),
              kpi("Leads", String(c.current.leads), String(c.previous.leads)),
              kpi("Customers", String(c.current.customers), String(c.previous.customers)),
              "",
              "Biggest movers (revenue):",
              ...c.movers.slice(0, 8).map((m) => `- ${m.name}: revenue ${money(m.revenueMinor)} (was ${money(m.prevRevenueMinor)}), spend ${money(m.spendMinor)} (was ${money(m.prevSpendMinor)}), ROAS ${x(m.roas)} (was ${x(m.prevRoas)})`),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "list_contacts",
        {
          title: "List contacts",
          description: "Search leads/customers (emails are masked). Use the id with get_contact_journey.",
          inputSchema: z.object({
            search: z.string().optional(),
            lifecycle: z.enum(["lead", "customer"]).optional(),
            limit: z.number().int().min(1).max(100).optional(),
          }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const r = await listContacts(db, ws, { search: args.search, lifecycle: args.lifecycle, limit: args.limit ?? 20 });
          return text(
            [
              `${r.total} matching contacts (showing ${r.rows.length}) · currency ${ws.reportingCurrency}`,
              ...r.rows.map((c) => `- ${c.id} · ${maskEmail(c.email) ?? "(no email)"} · ${c.lifecycle} · revenue ${money(c.revenueMinor)} · first touch ${c.firstChannel ?? "none"}${c.firstCampaign ? ` / ${c.firstCampaign}` : ""}`),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "get_contact_journey",
        {
          title: "Contact journey",
          description: "Ordered touchpoints, leads and payments for one contact, plus how each model credits their revenue. Email is masked.",
          inputSchema: z.object({ contactId: z.string().uuid() }),
          annotations: ro,
        },
        async ({ contactId }) => {
          const db = await getDb();
          const j = await journey(db, ws, contactId, { maskEmail: true });
          if (!j) return text("Contact not found.");
          const lines = j.items.map((i) =>
            i.kind === "touchpoint"
              ? `- ${i.at} touch · ${i.channel}${i.campaign ? ` · ${i.campaign}` : ""}${i.ad ? ` / ${i.ad}` : ""} (device ${i.device})`
              : i.kind === "lead"
                ? `- ${i.at} lead · ${i.source}${i.formName ? ` · ${i.formName}` : ""}`
                : `- ${i.at} ${i.kind} · ${formatMoney(i.amountMinor, i.currency)}`,
          );
          return text(
            [
              `Contact ${j.contact.email ?? "(no email)"} · ${j.contact.lifecycle} · ${j.contact.devices} device(s) · times in UTC`,
              ...lines,
              "",
              "Revenue credit by model:",
              ...j.credits.map((c) => `- ${c.model}: ${c.label} ${money(c.revenueMinor)}`),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "get_latest_insights",
        {
          title: "Latest AI insights",
          description: "The most recent weekly insights report. If none exists yet, a fresh rule-based summary is computed (nothing is stored).",
          inputSchema: z.object({}),
          annotations: ro,
        },
        async () => {
          const db = await getDb();
          const [r] = await db
            .select()
            .from(schema.aiReports)
            .where(eq(schema.aiReports.workspaceId, ws.id))
            .orderBy(desc(schema.aiReports.createdAt))
            .limit(1);
          if (r) {
            return text(`Report for ${r.periodStart} → ${r.periodEnd} · generated by ${r.modelName} · currency ${ws.reportingCurrency}\n\n${r.contentMd}`);
          }
          const { facts } = await buildFacts(db, ws);
          return text(`Computed summary for ${facts.period.start} → ${facts.period.end} · currency ${ws.reportingCurrency} · model ${facts.attributionModel}\n\n${templateReport(facts)}`);
        },
      );

      server.registerTool(
        "get_sync_status",
        {
          title: "Data freshness",
          description: "Connection status for Meta, Google Ads and Stripe, recent sync runs and pixel activity.",
          inputSchema: z.object({}),
          annotations: ro,
        },
        async () => {
          const db = await getDb();
          const s = await syncStatus(db, ws);
          const scrub = (v: unknown) => (typeof v === "string" && v ? scrubError(v) : v);
          return text(
            JSON.stringify(
              {
                ...s,
                connections: s.connections.map((c) => ({ ...c, last_error: scrub(c.last_error) })),
                recentRuns: s.recentRuns.map((r) => ({ ...r, error: scrub(r.error) })),
              },
              null,
              2,
            ),
          );
        },
      );

      server.registerTool(
        "get_platform_breakdown",
        {
          title: "Spend and revenue per ad platform",
          description: "Ad spend, ad-attributed revenue, ROAS, leads and customers per ad platform (Meta, Google, TikTok, …) for a period.",
          inputSchema: z.object({ ...period }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const p = await resolvePeriod(ws, args);
          const list = await platforms(db, ws, p);
          const spend = list.reduce((s, r) => s + r.spendMinor, 0);
          const revenue = list.reduce((s, r) => s + r.revenueMinor, 0);
          return text(
            [
              header(ws, p),
              "",
              "| Platform | Spend | Revenue | ROAS | Leads | Customers |",
              "|---|---|---|---|---|---|",
              ...list.map((r) => `| ${r.platform} | ${money(r.spendMinor)} | ${money(r.revenueMinor)} | ${x(r.roas)} | ${r.leads} | ${r.customers} |`),
              `| Total | ${money(spend)} | ${money(revenue)} | ${x(spend > 0 ? revenue / spend : null)} | | |`,
              ...(list.length ? [] : ["No ad spend or ad-attributed conversions in this period."]),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "list_integrations",
        {
          title: "Connected integrations",
          description:
            "Every connected integration (ad platforms, revenue sources, notification channels) with mode, sync health, last sync run and last error, plus pixel activity. Never returns credentials.",
          inputSchema: z.object({}),
          annotations: ro,
        },
        async () => {
          const db = await getDb();
          // Non-secret columns only: secrets_enc and config are never read here.
          const conns = await db
            .select({
              provider: schema.connections.provider,
              mode: schema.connections.mode,
              enabled: schema.connections.enabled,
              lastSyncedAt: schema.connections.lastSyncedAt,
              lastError: schema.connections.lastError,
            })
            .from(schema.connections)
            .where(eq(schema.connections.workspaceId, ws.id))
            .orderBy(schema.connections.provider);
          const lastRuns = rows<{ provider: string; status: string; started_at: string; rows_upserted: number | string | null }>(
            await db.execute(sql`select distinct on (provider) provider, status, started_at, rows_upserted from sync_runs
              where workspace_id = ${ws.id} order by provider, started_at desc`),
          );
          const runOf = new Map(lastRuns.map((r) => [r.provider, r]));
          const [pixel] = rows<{ sites: string; events_24h: string; last_event_at: string | null }>(
            await db.execute(sql`select
              (select count(*) from pixel_sites where workspace_id = ${ws.id}) sites,
              (select count(*) from events where workspace_id = ${ws.id} and occurred_at > now() - interval '24 hours') events_24h,
              (select max(occurred_at) from events where workspace_id = ${ws.id}) last_event_at`),
          );
          const now = Date.now();
          const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : "never");
          const lines = conns.map((c) => {
            const meta = getIntegration(c.provider);
            const syncs = meta?.category === "ads" || meta?.category === "revenue";
            const run = runOf.get(c.provider);
            return [
              `- ${meta?.name ?? c.provider} (${c.provider}, ${meta?.category ?? "other"})`,
              c.mode,
              `health ${connectionHealth(c, syncs, now)}`,
              ...(syncs ? [`last synced ${iso(c.lastSyncedAt)}`] : []),
              ...(run ? [`last run ${run.status} at ${iso(run.started_at)} (${Number(run.rows_upserted ?? 0)} rows)`] : []),
              ...(c.lastError ? [`last error: ${scrubError(c.lastError)}`] : []),
            ].join(" · ");
          });
          return text(
            [
              `${conns.length} connected integration(s) · times in UTC · credentials are never shown`,
              ...lines,
              `- Website pixel · ${Number(pixel?.sites ?? 0)} site(s) · ${Number(pixel?.events_24h ?? 0)} events in the last 24h · last event ${iso(pixel?.last_event_at)}`,
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "get_timeseries",
        {
          title: "Daily spend vs revenue",
          description: `Day-by-day ad spend, total revenue, ad-attributed revenue and leads for a period (at most ${MAX_SERIES_DAYS} days).`,
          inputSchema: z.object({ ...period, platform }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const p = await resolvePeriod(ws, args);
          const days = Math.round((Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / DAY_MS) + 1;
          if (!(days >= 1 && days <= MAX_SERIES_DAYS)) {
            return { ...text(`Invalid period ${p.start} → ${p.end}: choose 1–${MAX_SERIES_DAYS} days with start on or before end.`), isError: true };
          }
          const series = await timeseries(db, ws, p);
          const sum = (k: "spendMinor" | "revenueMinor" | "attributedRevenueMinor" | "leads") => series.reduce((s, r) => s + r[k], 0);
          const spend = sum("spendMinor");
          const attributed = sum("attributedRevenueMinor");
          return text(
            [
              header(ws, p),
              ...(p.platform ? [`Spend and Attributed are for ${p.platform} only; Revenue and Leads are for all sources.`] : []),
              `Totals: spend ${money(spend)} · revenue ${money(sum("revenueMinor"))} · attributed to ads ${money(attributed)} · ROAS ${x(spend > 0 ? attributed / spend : null)} · leads ${sum("leads")}`,
              "",
              "| Date | Spend | Revenue | Attributed | Leads |",
              "|---|---|---|---|---|",
              ...series.map((r) => `| ${r.date} | ${money(r.spendMinor)} | ${money(r.revenueMinor)} | ${money(r.attributedRevenueMinor)} | ${r.leads} |`),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "search_campaigns",
        {
          title: "Find campaigns by name",
          description:
            "Fuzzy search of campaign names (partial words and small typos are fine). Returns campaign ids with spend, revenue, ROAS, leads and customers for the period. Use the id with other tools or the REST API.",
          inputSchema: z.object({
            query: z.string().trim().min(1).max(200).describe("Part of a campaign name, e.g. 'retargeting summer'."),
            ...period,
            platform,
            limit: z.number().int().min(1).max(50).optional().describe("Default 10."),
          }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          const p = await resolvePeriod(ws, args);
          const all = await db
            .select({ id: schema.campaigns.id, name: schema.campaigns.name, platform: schema.campaigns.platform, status: schema.campaigns.status })
            .from(schema.campaigns)
            .where(eq(schema.campaigns.workspaceId, ws.id));
          const matches = all
            .filter((c) => !p.platform || c.platform === p.platform)
            .map((c) => ({ ...c, score: fuzzyScore(args.query, c.name) }))
            .filter((c) => c.score > 0)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
            .slice(0, args.limit ?? 10);
          const perf = new Map((matches.length ? await performance(db, ws, { ...p, level: "campaign" }) : []).map((r) => [r.id, r]));
          return text(
            [
              header(ws, p),
              `${matches.length} campaign(s) matching "${args.query}"`,
              ...matches.map((c) => {
                const r = perf.get(c.id);
                return `- ${c.id} · ${c.name} (${c.platform}${c.status ? `, ${c.status}` : ""}) · spend ${money(r?.spendMinor ?? 0)} · revenue ${money(r?.revenueMinor ?? 0)} · ROAS ${x(r?.roas ?? null)} · leads ${r?.leads ?? 0} · customers ${r?.customers ?? 0}`;
              }),
            ].join("\n"),
          );
        },
      );
      server.registerTool(
        "get_ad_receipt",
        {
          title: "Ad receipt",
          description:
            "The receipt of one payment (paymentId) or one customer (contactId): which ads earned the money (credit shares that sum to the amount), what acquiring the customer cost in ad spend, and when they paid it back. Email is masked.",
          inputSchema: z.object({
            paymentId: z.string().uuid().optional().describe("A payment or refund id (revenue event)."),
            contactId: z.string().uuid().optional().describe("A contact id, e.g. from list_contacts."),
            model: period.model,
            cost: z
              .enum(["share", "clicks"])
              .optional()
              .describe("share (default): each ad's monthly spend shared by the customers it brought. clicks: only the customer's own clicks."),
          }),
          annotations: ro,
        },
        async (args) => {
          if (!args.paymentId && !args.contactId) return text("Pass a paymentId or a contactId.");
          const db = await getDb();
          const model = args.model ?? "linear";
          const basis = args.cost ?? "share";
          const earned = (l: EarnedLine) =>
            `- ${l.adName ?? l.campaignName ?? (l.touchpointId ? (l.channel ?? "unknown channel") : "no tracked touch")}${l.platform ? ` (${l.platform})` : ""}${l.adName && l.campaignName ? ` in ${l.campaignName}` : ""}: ${(l.credit * 100).toFixed(1)}% · ${money(l.revenueMinor)}`;
          const customer = (c: ContactReceipt) => [
            `Customer ${c.contact.name ?? "(no name)"} · ${c.contact.email ?? "(no email)"} · ${c.lifetime.payments} payment(s), lifetime net ${money(c.lifetime.netMinor)}`,
            `Acquisition cost (${basis === "share" ? "share of each ad's monthly spend" : "own clicks only"}): ${money(c.costMinor)}`,
            ...c.costLines.map(
              (l) => `- ${l.adName ?? "unknown ad"}${l.platform ? ` (${l.platform})` : ""}, clicked ${l.day}, credit ${l.credit}: ${money(l.costMinor)}`,
            ),
            c.payback.status === "paid_back"
              ? `Payback: paid back on ${c.payback.at?.slice(0, 10)} (${c.payback.days} days after the first paid click)`
              : c.payback.status === "not_yet"
                ? `Payback: not yet, ${money(c.payback.remainingMinor)} still to earn back`
                : "Payback: no ad cost to earn back",
            ...(c.profit ? [`Contribution to date ${money(c.profit.contributionMinor)} · profit after ad cost ${money(c.profit.profitMinor)}`] : []),
          ];
          if (args.paymentId) {
            const r = await paymentReceipt(db, ws, args.paymentId, model, { basis });
            if (!r) return text("Payment not found.");
            return text(
              [
                `Receipt · ${r.payment.type} ${formatMoney(r.payment.amountMinor, r.payment.currency)} on ${r.payment.at} (UTC) via ${r.payment.source} · attribution model ${model}`,
                "Earned by:",
                ...(r.earnedBy.length ? r.earnedBy.map(earned) : ["- no credit recorded yet"]),
                "",
                ...(r.contact ? customer(r.contact) : ["No contact matched this payment."]),
              ].join("\n"),
            );
          }
          const c = await contactReceipt(db, ws, args.contactId!, model, { basis });
          if (!c) return text("Contact not found.");
          return text(
            [
              `Receipt · currency ${ws.reportingCurrency} · attribution model ${model}`,
              ...customer(c),
              "",
              "Lifetime revenue earned by:",
              ...(c.earnedBy.length ? c.earnedBy.map(earned) : ["- no payments yet"]),
            ].join("\n"),
          );
        },
      );

      server.registerTool(
        "contact_stage_funnel",
        {
          title: "Pipeline stage funnel",
          description:
            "How many contacts reached each pipeline stage (New lead, Qualified, Call booked, Proposal, Won, Lost by default), the step conversion, and the ad cost per contact reaching each stage. Optionally only contacts first seen in a date range. Counts only, no personal data.",
          inputSchema: z.object({
            start: period.start.describe("Only contacts first seen on or after this date (YYYY-MM-DD, workspace timezone). Omit for all contacts."),
            end: period.end.describe("Only contacts first seen on or before this date (YYYY-MM-DD, inclusive). Omit for all contacts."),
          }),
          annotations: ro,
        },
        async (args) => {
          const db = await getDb();
          if (args.start && args.end && args.start > args.end) return { ...text(`Invalid period ${args.start} → ${args.end}: start must be on or before end.`), isError: true };
          if ((await storedStages(db, ws.id)).length === 0) return text("This workspace has no pipeline yet: nobody has opened the Pipeline page or received a payment.");
          const f = await stageFunnel(db, ws, { start: args.start, end: args.end });
          const pctOf = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
          return text(
            [
              `${f.start || f.end ? `Contacts first seen ${f.start ?? "any time"} → ${f.end ?? "today"} (${ws.timezone})` : "All contacts"} · ${f.total} contacts · ad spend in the period ${money(f.spendMinor)} · currency ${ws.reportingCurrency}`,
              "Reached = the contact is in this stage now or got at least this far (lost stages count the contacts currently in them). Cost = ad spend ÷ contacts from paid ads that reached the stage.",
              "",
              "| Stage | Kind | Reached | Step conversion | Of all contacts | From ads | Cost per contact |",
              "|---|---|---|---|---|---|---|",
              ...f.steps.map((s) => `| ${s.name} | ${s.kind} | ${s.reached} | ${pctOf(s.conversion)} | ${pctOf(s.ofTotal)} | ${s.paidReached} | ${money(s.costMinor)} |`),
            ].join("\n"),
          );
        },
      );
    },
    {
      serverInfo: { name: "adledger", version: "0.1.0" },
      instructions:
        "AdLedger answers 'which ads actually made money'. Numbers are computed from first-party data (pixel + Stripe + ad spend). Always mention the date range, currency and attribution model when reporting numbers.",
    },
  );
}
