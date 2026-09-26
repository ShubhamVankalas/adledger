import { desc, eq } from "drizzle-orm";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { buildFacts } from "./ai/facts";
import { templateReport } from "./ai/report";
import { getDb, schema } from "./db";
import { formatMoney } from "./money";
import {
  compare,
  dataBounds,
  journey,
  listContacts,
  maskEmail,
  overview,
  performance,
  syncStatus,
  wastedSpend,
  type ReportParams,
} from "./reports";
import type { Workspace } from "./settings";

// Read-only MCP server. Every tool only reads through lib/reports (no writes).
// v0.2+ write tools must create things paused/draft and require confirmation.

const period = {
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Start date YYYY-MM-DD (workspace timezone). Defaults to 30 days before `end`."),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("End date YYYY-MM-DD, inclusive. Defaults to the latest day with data."),
  model: z.enum(["first_touch", "last_touch", "linear"]).optional().describe("Attribution model (default linear)."),
};
const platform = z.enum(["meta", "google"]).optional().describe("Limit to one ad platform.");

async function resolvePeriod(ws: Workspace, a: { start?: string; end?: string; model?: ReportParams["model"]; platform?: "meta" | "google" }): Promise<ReportParams> {
  const db = await getDb();
  const end = a.end ?? (await dataBounds(db, ws)).max ?? new Date().toISOString().slice(0, 10);
  const start = a.start ?? new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  return { start, end, model: a.model ?? "linear", platform: a.platform };
}

const header = (ws: Workspace, p: ReportParams) =>
  `Period ${p.start} → ${p.end} (${ws.timezone}) · currency ${ws.reportingCurrency} · attribution model ${p.model}${p.platform ? ` · platform ${p.platform}` : ""}`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const ro = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const MCP_TOOL_NAMES = [
  "get_overview",
  "get_performance",
  "find_wasted_spend",
  "compare_periods",
  "list_contacts",
  "get_contact_journey",
  "get_latest_insights",
  "get_sync_status",
] as const;

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
          return text(JSON.stringify(s, null, 2));
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
