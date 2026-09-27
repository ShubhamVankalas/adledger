import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { generateText, stepCountIs, tool, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { AD_PLATFORMS, type Platform } from "../connectors/types";
import { schema, type DB } from "../db";
import type { AskTable, AskTableColumn, AttributionModel } from "../db/schema";
import { dateRange, MODEL_LABELS, platformLabel } from "../format";
import { fuzzyScore } from "../mcp";
import { resolvePeriodParams } from "../period";
import { compare, overview, performance, platforms, timeseries, wastedSpend, type PerfLevel, type PerfRow, type ReportParams } from "../reports";
import type { Workspace } from "../settings";
import { formatCell } from "./ask-format";
import { unverifiedNumbers } from "./numbers";
import { getLlmConfig, languageModel } from "./report";

// Ask (Insights → Ask): questions about the workspace's numbers, answered by calling read-only,
// SQL-backed tools. They run the same lib/reports functions as the dashboard, REST API and MCP
// server, so a table in an answer matches the page it links to exactly. The model only picks
// tools and writes a sentence or two around the results; any number it writes that no tool
// returned is flagged. Without a model (or when the model fails) a small rule-based router
// answers the common questions directly.
//
// Contacts, notes and anything person-level are deliberately not available as tools.

export type AskAnswer = { content: string; tables: AskTable[]; unverifiedNumbers: string[]; modelName: string; error?: string };

const RANGES = ["7d", "14d", "30d", "90d", "180d"] as const;
type Range = (typeof RANGES)[number];
const MODELS = ["linear", "first_touch", "last_touch"] as const;
const SORTS = ["spend", "revenue", "roas", "leads", "customers", "cac", "cpl"] as const;
type SortKey = (typeof SORTS)[number];
const MAX_SERIES_DAYS = 92;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------- tool inputs

const periodInput = {
  range: z.enum(RANGES).optional().describe("Rolling period ending on the latest day with data. Default 30d."),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fixed start date YYYY-MM-DD (use with end instead of range)."),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Fixed end date YYYY-MM-DD, inclusive."),
  model: z.enum(MODELS).optional().describe("Attribution model. Default linear."),
};
const platformInput = z.enum(AD_PLATFORMS).optional().describe("Only this ad platform.");

type PeriodArgs = { range?: Range; start?: string; end?: string; model?: AttributionModel; platform?: Platform };

async function resolve(db: DB, ws: Workspace, a: PeriodArgs): Promise<ReportParams> {
  const p = await resolvePeriodParams(db, ws, {
    range: a.range,
    from: a.start && a.end ? a.start : undefined,
    to: a.start && a.end ? a.end : undefined,
    model: a.model,
    platform: a.platform,
  });
  return { start: p.start, end: p.end, model: p.model, platform: p.platform };
}

const caption = (p: ReportParams) =>
  [dateRange(p.start, p.end, { year: true }), `${MODEL_LABELS[p.model] ?? p.model} attribution`, ...(p.platform ? [platformLabel(p.platform)] : [])].join(" · ");

/** Dashboard link with the same filters (from/to/model/platform + extras). */
function href(path: string, p: ReportParams, extra: Record<string, string> = {}) {
  const q = new URLSearchParams({ from: p.start, to: p.end, model: p.model, ...(p.platform ? { platform: p.platform } : {}), ...extra });
  return `${path}?${q.toString()}`;
}

const PERF_COLUMNS: AskTableColumn[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "platform", label: "Platform", kind: "platform" },
  { key: "spend", label: "Spend", kind: "money" },
  { key: "revenue", label: "Revenue", kind: "money" },
  { key: "roas", label: "ROAS", kind: "ratio" },
  { key: "leads", label: "Leads", kind: "credit" },
  { key: "customers", label: "Customers", kind: "credit" },
  { key: "cac", label: "CAC", kind: "money" },
];
const perfRow = (r: PerfRow) => ({
  id: r.id,
  name: r.name,
  platform: r.platform,
  spend: r.spendMinor,
  revenue: r.revenueMinor,
  roas: r.roas,
  leads: r.leads,
  customers: r.customers,
  cac: r.cacMinor,
});

const SORT_VALUE: Record<SortKey, (r: PerfRow) => number | null> = {
  spend: (r) => r.spendMinor,
  revenue: (r) => r.revenueMinor,
  roas: (r) => r.roas,
  leads: (r) => r.leads,
  customers: (r) => r.customers,
  cac: (r) => r.cacMinor,
  cpl: (r) => r.cplMinor,
};

/** Sort report rows (no arithmetic); rows without a value (e.g. ROAS with no spend) go last. */
export function sortRows(rows: PerfRow[], by: SortKey, order: "desc" | "asc") {
  const get = SORT_VALUE[by];
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === null && y === null) return a.name.localeCompare(b.name);
    if (x === null) return 1;
    if (y === null) return -1;
    return (order === "desc" ? y - x : x - y) || b.spendMinor - a.spendMinor || a.name.localeCompare(b.name);
  });
}

const LEVEL_LABEL: Record<PerfLevel, string> = { campaign: "Campaigns", ad_group: "Ad sets", ad: "Ads" };
const SORT_LABEL: Record<SortKey, string> = { spend: "spend", revenue: "revenue", roas: "ROAS", leads: "leads", customers: "customers", cac: "CAC", cpl: "CPL" };

// ---------------------------------------------------------------- tools (shared by the model and the router)

export type AskToolName =
  | "get_overview"
  | "get_performance"
  | "get_platform_breakdown"
  | "compare_periods"
  | "find_wasted_spend"
  | "get_timeseries"
  | "search_campaigns";

type ToolArgs = PeriodArgs & {
  level?: PerfLevel;
  sort_by?: SortKey;
  order?: "desc" | "asc";
  limit?: number;
  query?: string;
};

/** Run one tool and return its table (raw values from reports.ts). */
export async function runAskTool(db: DB, ws: Workspace, name: AskToolName, args: ToolArgs): Promise<AskTable> {
  const p = await resolve(db, ws, args);
  const base = { caption: caption(p), currency: ws.reportingCurrency };
  switch (name) {
    case "get_overview": {
      const o = await overview(db, ws, p);
      return {
        ...base,
        title: p.platform ? `${platformLabel(p.platform)} overview` : "Overview",
        columns: [
          { key: "spend", label: "Spend", kind: "money" },
          { key: "revenue", label: p.platform ? "Revenue from ads" : "Revenue", kind: "money" },
          { key: "attributed", label: "Credited to ads", kind: "money" },
          { key: "roas", label: "ROAS", kind: "ratio" },
          { key: "leads", label: p.platform ? "Leads from ads" : "Leads", kind: p.platform ? "credit" : "count" },
          { key: "customers", label: p.platform ? "Customers from ads" : "Customers", kind: p.platform ? "credit" : "count" },
          { key: "cpl", label: "CPL", kind: "money" },
          { key: "cac", label: "CAC", kind: "money" },
        ],
        rows: [
          {
            spend: o.spendMinor,
            revenue: p.platform ? o.attributedRevenueMinor : o.revenueMinor,
            attributed: o.attributedRevenueMinor,
            roas: o.roas,
            leads: p.platform ? o.paidLeads : o.leads,
            customers: p.platform ? o.paidCustomers : o.customers,
            cpl: o.cplMinor,
            cac: o.cacMinor,
          },
        ],
        source: href("/", p),
      };
    }
    case "get_performance": {
      const level = args.level ?? "campaign";
      const by = args.sort_by ?? "spend";
      const order = args.order ?? (by === "cac" || by === "cpl" ? "asc" : "desc");
      const all = await performance(db, ws, { ...p, level });
      const rows = sortRows(all, by, order).slice(0, Math.min(25, Math.max(1, args.limit ?? 10)));
      return {
        ...base,
        title: `${LEVEL_LABEL[level]} by ${SORT_LABEL[by]}${order === "asc" ? " (lowest first)" : ""}`,
        columns: PERF_COLUMNS,
        rows: rows.map(perfRow),
        source: href("/performance", p, level === "campaign" ? {} : { level }),
      };
    }
    case "get_platform_breakdown": {
      const list = await platforms(db, ws, { ...p, platform: undefined });
      return {
        ...base,
        caption: caption({ ...p, platform: undefined }),
        title: "Ad platforms",
        columns: [
          { key: "platform", label: "Platform", kind: "platform" },
          { key: "spend", label: "Spend", kind: "money" },
          { key: "revenue", label: "Revenue from ads", kind: "money" },
          { key: "roas", label: "ROAS", kind: "ratio" },
          { key: "leads", label: "Leads", kind: "credit" },
          { key: "customers", label: "Customers", kind: "credit" },
        ],
        rows: list.map((r) => ({ platform: r.platform, spend: r.spendMinor, revenue: r.revenueMinor, roas: r.roas, leads: r.leads, customers: r.customers })),
        source: href("/", { ...p, platform: undefined }),
      };
    }
    case "compare_periods": {
      const c = await compare(db, ws, p);
      const change = (cur: number | null, prev: number | null) => (cur === null || prev === null || prev === 0 ? null : (cur - prev) / Math.abs(prev));
      const kpis: [string, "money" | "ratio" | "count", number | null, number | null][] = [
        ["Spend", "money", c.current.spendMinor, c.previous.spendMinor],
        ["Revenue", "money", c.current.revenueMinor, c.previous.revenueMinor],
        ["ROAS", "ratio", c.current.roas, c.previous.roas],
        ["Leads", "count", c.current.leads, c.previous.leads],
        ["Customers", "count", c.current.customers, c.previous.customers],
        ["CAC", "money", c.current.cacMinor, c.previous.cacMinor],
      ];
      return {
        ...base,
        caption: `${caption(p)} vs ${dateRange(c.previous.start, c.previous.end, { year: true })}`,
        title: "This period vs the previous one",
        columns: [
          { key: "kpi", label: "Metric", kind: "text" },
          { key: "current", label: "This period", kind: "text" },
          { key: "previous", label: "Previous", kind: "text" },
          { key: "change", label: "Change", kind: "pct" },
        ],
        rows: kpis.map(([kpi, kind, cur, prev]) => ({
          kpi,
          current: formatCell(kind, cur, ws.reportingCurrency),
          previous: formatCell(kind, prev, ws.reportingCurrency),
          change: change(cur, prev),
        })),
        source: href("/", p),
      };
    }
    case "find_wasted_spend": {
      const level = args.level ?? "campaign";
      const rows = await wastedSpend(db, ws, { ...p, level });
      return {
        ...base,
        title: `${LEVEL_LABEL[level]} with ROAS under 0.5×`,
        columns: PERF_COLUMNS,
        rows: rows.slice(0, 15).map(perfRow),
        source: href("/performance", p, level === "campaign" ? {} : { level }),
      };
    }
    case "get_timeseries": {
      let q = p;
      const days = Math.round((Date.parse(`${p.end}T00:00:00Z`) - Date.parse(`${p.start}T00:00:00Z`)) / DAY_MS) + 1;
      if (days > MAX_SERIES_DAYS) q = { ...p, start: new Date(Date.parse(`${p.end}T00:00:00Z`) - (MAX_SERIES_DAYS - 1) * DAY_MS).toISOString().slice(0, 10) };
      const series = await timeseries(db, ws, q);
      return {
        ...base,
        caption: caption(q),
        title: "Day by day",
        columns: [
          { key: "date", label: "Date", kind: "date" },
          { key: "spend", label: q.platform ? `${platformLabel(q.platform)} spend` : "Spend", kind: "money" },
          { key: "revenue", label: "Revenue", kind: "money" },
          { key: "attributed", label: "Credited to ads", kind: "money" },
          { key: "leads", label: "Leads", kind: "count" },
        ],
        rows: series.map((r) => ({ date: r.date, spend: r.spendMinor, revenue: r.revenueMinor, attributed: r.attributedRevenueMinor, leads: r.leads })),
        source: href("/", q),
      };
    }
    case "search_campaigns": {
      const query = (args.query ?? "").trim();
      const all = await db
        .select({ id: schema.campaigns.id, name: schema.campaigns.name, platform: schema.campaigns.platform })
        .from(schema.campaigns)
        .where(eq(schema.campaigns.workspaceId, ws.id));
      const matches = all
        .filter((c) => !p.platform || c.platform === p.platform)
        .map((c) => ({ ...c, score: fuzzyScore(query, c.name) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, 10);
      const perf = new Map((matches.length ? await performance(db, ws, { ...p, level: "campaign" }) : []).map((r) => [r.id, r]));
      return {
        ...base,
        title: `Campaigns matching “${query}”`,
        columns: PERF_COLUMNS,
        rows: matches.map((c) => {
          const r = perf.get(c.id);
          return r ? perfRow(r) : { id: c.id, name: c.name, platform: c.platform, spend: 0, revenue: 0, roas: null, leads: 0, customers: 0, cac: null };
        }),
        source: href("/performance", p),
      };
    }
  }
}

/** The compact, pre-formatted view of a table the model reads (it never sees raw minor units). */
export function tableForModel(t: AskTable) {
  return {
    title: t.title,
    period: t.caption,
    currency: t.currency,
    rows: t.rows.map((r) => Object.fromEntries(t.columns.map((c) => [c.label, formatCell(c.kind, r[c.key], t.currency)]))),
  };
}

function askTools(db: DB, ws: Workspace, tables: AskTable[]) {
  const wrap = (name: AskToolName) => async (args: ToolArgs) => {
    const t = await runAskTool(db, ws, name, args);
    tables.push(t);
    return tableForModel(t);
  };
  return {
    get_overview: tool({
      description: "Headline KPIs for a period: spend, revenue, revenue credited to ads, ROAS, leads, customers, CPL and CAC.",
      inputSchema: z.object({ ...periodInput, platform: platformInput }),
      execute: wrap("get_overview"),
    }),
    get_performance: tool({
      description: "Campaigns, ad sets or ads with spend, revenue, ROAS, leads, customers and CAC, sorted by a metric. Use for best/worst/top questions.",
      inputSchema: z.object({
        ...periodInput,
        platform: platformInput,
        level: z.enum(["campaign", "ad_group", "ad"]).optional().describe("Default campaign. ad_group = ad set."),
        sort_by: z.enum(SORTS).optional().describe("Default spend."),
        order: z.enum(["desc", "asc"]).optional().describe("desc = highest first (default; CAC/CPL default to lowest first)."),
        limit: z.number().int().min(1).max(25).optional(),
      }),
      execute: wrap("get_performance"),
    }),
    get_platform_breakdown: tool({
      description: "Spend, revenue credited to ads, ROAS, leads and customers per ad platform (Meta, Google, …).",
      inputSchema: z.object({ ...periodInput }),
      execute: wrap("get_platform_breakdown"),
    }),
    compare_periods: tool({
      description: "Compare spend, revenue, ROAS, leads, customers and CAC with the previous period of the same length, with % change.",
      inputSchema: z.object({ ...periodInput, platform: platformInput }),
      execute: wrap("compare_periods"),
    }),
    find_wasted_spend: tool({
      description: "Campaigns (or ad sets / ads) with meaningful spend and ROAS below 0.5x.",
      inputSchema: z.object({ ...periodInput, platform: platformInput, level: z.enum(["campaign", "ad_group", "ad"]).optional() }),
      execute: wrap("find_wasted_spend"),
    }),
    get_timeseries: tool({
      description: `Day-by-day spend, revenue, revenue credited to ads and leads (at most ${MAX_SERIES_DAYS} days).`,
      inputSchema: z.object({ ...periodInput, platform: platformInput }),
      execute: wrap("get_timeseries"),
    }),
    search_campaigns: tool({
      description: "Find campaigns by (part of) their name, with their results for the period.",
      inputSchema: z.object({ query: z.string().min(1).max(200), ...periodInput, platform: platformInput }),
      execute: wrap("search_campaigns"),
    }),
  };
}

const SYSTEM = `You answer questions about a business's advertising results in AdLedger.
Rules (strict):
- Always call a tool to get numbers. Never calculate, estimate, convert or invent a number; quote figures exactly as the tool results show them.
- The tool results are shown to the user as tables under your answer, so keep your text short: one to three sentences naming the answer (for example the campaign) and the key figure.
- If the tools can't answer the question, say so plainly and suggest what you can answer. Don't answer questions unrelated to this business's ads, leads and revenue.
- You cannot see individual people or contacts, and you can't change anything (read-only).
- Mention the period and attribution model when you give numbers.`;

// ---------------------------------------------------------------- rule-based router (no model needed)

type Plan = { tool: AskToolName; args: ToolArgs };

const PLATFORM_WORDS: [RegExp, Platform][] = [
  [/\b(meta|facebook|instagram|fb|ig)\b/, "meta"],
  [/\b(google|adwords|youtube)\b/, "google"],
  [/\b(microsoft|bing)\b/, "microsoft"],
  [/\btik ?tok\b/, "tiktok"],
  [/\blinked ?in\b/, "linkedin"],
  [/\bpinterest\b/, "pinterest"],
  [/\bsnap(chat)?\b/, "snapchat"],
  [/\breddit\b/, "reddit"],
];

/** Map a question onto one tool call (used without a model, and as the fallback when it fails). */
export function planQuestion(question: string): Plan {
  const q = question.toLowerCase();
  const args: ToolArgs = {};
  const n = /\b(\d{1,3})\s*(d|days?)\b/.exec(q);
  if (n) {
    const days = Number(n[1]);
    args.range = RANGES.reduce((best, r) => (Math.abs(parseInt(r) - days) < Math.abs(parseInt(best) - days) ? r : best), "30d" as Range);
  } else if (/\b(week|weekly|7 ?day)/.test(q)) args.range = "7d";
  else if (/\b(quarter|3 months|90)/.test(q)) args.range = "90d";
  else if (/\b(half|6 months)\b/.test(q)) args.range = "180d";
  if (/first[- ]touch/.test(q)) args.model = "first_touch";
  else if (/last[- ]touch/.test(q)) args.model = "last_touch";
  for (const [re, platform] of PLATFORM_WORDS) if (re.test(q)) args.platform = platform;
  if (/\bad ?sets?\b|\bad ?groups?\b/.test(q)) args.level = "ad_group";
  else if (/\bads\b|\bcreatives?\b|\bad\b(?! ?spend)/.test(q) && !/\bad ?spend\b/.test(q)) args.level = "ad";

  if (/wast|burn|losing money|not working|pause/.test(q)) return { tool: "find_wasted_spend", args };
  if (/compar|vs\.?\b|versus|previous|change|trend(ing)? up|grow|drop|declin/.test(q)) return { tool: "compare_periods", args };
  if (/\bplatforms?\b|\bchannels?\b|\bnetworks?\b|meta or google|google or meta/.test(q)) return { tool: "get_platform_breakdown", args };
  if (/daily|per day|by day|day by day|over time|timeline|trend/.test(q)) return { tool: "get_timeseries", args };

  const metric: SortKey | null = /\broas\b|return on ad|efficien|profitab/.test(q)
    ? "roas"
    : /\bcac\b|cost per (customer|acquisition|sale)/.test(q)
      ? "cac"
      : /\bcpl\b|cost per lead/.test(q)
        ? "cpl"
        : /revenue|sales|money|earn|made/.test(q)
          ? "revenue"
          : /customers?|buyers?|purchases?/.test(q)
            ? "customers"
            : /leads?|sign ?ups?/.test(q)
              ? "leads"
              : /spend|spent|cost/.test(q)
                ? "spend"
                : null;
  const ranking = /\b(top|best|worst|highest|lowest|most|least|which|rank|biggest|cheapest)\b/.test(q);
  if (ranking || args.level || /\bcampaigns?\b/.test(q)) {
    const by = metric ?? "revenue";
    const low = /\b(worst|lowest|least)\b/.test(q);
    const cheapest = /\b(cheapest|best|lowest)\b/.test(q);
    // For costs (CAC/CPL) "best" means lowest; for everything else "worst" means lowest.
    const order = by === "cac" || by === "cpl" ? (cheapest || !/\b(worst|highest|most)\b/.test(q) ? "asc" : "desc") : low ? "asc" : "desc";
    return { tool: "get_performance", args: { ...args, sort_by: by, order, limit: 10 } };
  }
  return { tool: "get_overview", args };
}

/** A sentence built only from the table's own (formatted) values. */
export function describeTable(plan: Plan, t: AskTable): string {
  const cell = (row: Record<string, string | number | null>, key: string) => {
    const col = t.columns.find((c) => c.key === key);
    return col ? formatCell(col.kind, row[key], t.currency) : "—";
  };
  const first = t.rows[0];
  if (!first) return `I found no matching data for ${t.caption}.`;
  switch (plan.tool) {
    case "get_performance": {
      const by = plan.args.sort_by ?? "spend";
      const key = by === "cpl" ? "cac" : by;
      const lowest = plan.args.order === "asc";
      const what = by === "cpl" ? "spend" : SORT_LABEL[by];
      return `**${first.name}** (${platformLabel(String(first.platform))}) has the ${lowest ? "lowest" : "highest"} ${what}: ${cell(first, by === "cpl" ? "spend" : key)}, for ${t.caption}.`;
    }
    case "find_wasted_spend":
    {
      const noun = { campaign: ["campaign", "campaigns"], ad_group: ["ad set", "ad sets"], ad: ["ad", "ads"] }[plan.args.level ?? "campaign"];
      return `${t.rows.length === 1 ? `One ${noun[0]}` : `${t.rows.length} ${noun[1]}`} spent a meaningful amount at a ROAS under 0.5×. The largest is **${first.name}**, with ${cell(first, "spend")} spent and ${cell(first, "revenue")} in revenue (${t.caption}).`;
    }
    case "get_platform_breakdown":
      return `**${platformLabel(String(first.platform))}** had the most spend: ${cell(first, "spend")} at ${cell(first, "roas")} ROAS (${t.caption}).`;
    case "compare_periods": {
      const rev = t.rows.find((r) => r.kpi === "Revenue");
      return rev ? `Revenue was ${rev.current} against ${rev.previous} in the previous period (${t.caption}).` : `Here's how ${t.caption} compares.`;
    }
    case "get_timeseries":
      return `Here's each day for ${t.caption}.`;
    case "search_campaigns":
      return `${t.rows.length} campaign${t.rows.length === 1 ? "" : "s"} matched (${t.caption}).`;
    default:
      return `For ${t.caption}: spend ${cell(first, "spend")}, revenue ${cell(first, "revenue")}, ROAS ${cell(first, "roas")}, ${cell(first, "leads")} leads.`;
  }
}

async function ruleBasedAnswer(db: DB, ws: Workspace, question: string): Promise<AskAnswer> {
  const plan = planQuestion(question);
  const table = await runAskTool(db, ws, plan.tool, plan.args);
  return { content: describeTable(plan, table), tables: [table], unverifiedNumbers: [], modelName: "rules" };
}

// ---------------------------------------------------------------- answering

export async function answerQuestion(
  db: DB,
  ws: Workspace,
  question: string,
  opts: { model?: LanguageModel; modelName?: string; history?: { role: "user" | "assistant"; content: string }[] } = {},
): Promise<AskAnswer> {
  const q = question.trim().slice(0, 1000);
  let model = opts.model;
  let modelName = opts.modelName ?? "custom";
  if (!model) {
    const cfg = await getLlmConfig(ws, db);
    if (!cfg) return ruleBasedAnswer(db, ws, q);
    model = languageModel(cfg);
    modelName = `${cfg.provider}/${cfg.model}`;
  }
  const tables: AskTable[] = [];
  try {
    const messages: ModelMessage[] = [
      ...(opts.history ?? []).slice(-6).map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }) as ModelMessage),
      { role: "user", content: q },
    ];
    const { text } = await generateText({
      model,
      system: SYSTEM,
      messages,
      tools: askTools(db, ws, tables),
      stopWhen: stepCountIs(4),
      maxRetries: 1,
      timeout: { totalMs: 90_000 },
    });
    let content = text.trim();
    // Local models sometimes answer without calling a tool: fall back to a direct lookup.
    if (!tables.length) {
      const fallback = await ruleBasedAnswer(db, ws, q);
      const verified = content ? unverifiedNumbers(content, { q }).length === 0 : false;
      return { ...fallback, content: verified ? content : fallback.content, modelName };
    }
    if (!content) content = "Here's what I found.";
    const bad = unverifiedNumbers(content, { tables: tables.map(tableForModel), question: q });
    return { content, tables, unverifiedNumbers: bad, modelName };
  } catch (err) {
    const fallback = await ruleBasedAnswer(db, ws, q);
    return { ...fallback, error: err instanceof Error ? err.message.slice(0, 200) : "The model call failed" };
  }
}

// ---------------------------------------------------------------- history

export const ASK_HISTORY_LIMIT = 40;

export async function askHistory(db: DB, workspaceId: string, userId: string, limit = ASK_HISTORY_LIMIT) {
  const latest = await db
    .select()
    .from(schema.askMessages)
    .where(and(eq(schema.askMessages.workspaceId, workspaceId), eq(schema.askMessages.userId, userId)))
    // Newest first; on a tie the answer ("assistant") is newer than its question ("user").
    .orderBy(desc(schema.askMessages.createdAt), asc(schema.askMessages.role))
    .limit(limit);
  return latest.reverse();
}

export async function clearAskHistory(db: DB, workspaceId: string, userId: string) {
  await db.delete(schema.askMessages).where(and(eq(schema.askMessages.workspaceId, workspaceId), eq(schema.askMessages.userId, userId)));
}

/** Keep the newest `keep` messages per user so history can't grow without bound. */
export async function pruneAskHistory(db: DB, workspaceId: string, userId: string, keep = 200) {
  const old = await db
    .select({ id: schema.askMessages.id })
    .from(schema.askMessages)
    .where(and(eq(schema.askMessages.workspaceId, workspaceId), eq(schema.askMessages.userId, userId)))
    .orderBy(desc(schema.askMessages.createdAt))
    .offset(keep);
  if (old.length) await db.delete(schema.askMessages).where(inArray(schema.askMessages.id, old.map((o) => o.id)));
}

