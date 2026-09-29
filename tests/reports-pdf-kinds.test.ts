import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { oklchToPrintHex, orgPrintAccent } from "@/lib/pdf/brand";
import { pdfTheme } from "@/lib/pdf/theme";
import { REPORT_CATALOG, REPORT_KIND_IDS, type ReportRequest } from "@/lib/report-kinds";
import { rankAds, type AdLeaderboardData } from "@/lib/report-kinds/ad-leaderboard";
import { mixVerdict, type ChannelMixData } from "@/lib/report-kinds/channel-mix";
import type { ConversionFunnelData } from "@/lib/report-kinds/conversion-funnel";
import { cheapButCold, MIN_LEADS_TO_RANK, type LeadQualityData, type LeadSourceRow } from "@/lib/report-kinds/lead-quality";
import type { PipelineActivityData } from "@/lib/report-kinds/pipeline-activity";
import { profitSteps, type ProfitRefundsData } from "@/lib/report-kinds/profit-refunds";
import { generateReportPdf, loadPrintBrand } from "@/lib/report-kinds/render";
import { overview, performance, platforms } from "@/lib/reports";
import { funnel, timeToConvert } from "@/lib/reports-analysis";
import { stageFunnel } from "@/lib/reports-pipeline";
import { profitLedger } from "@/lib/reports-profit";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// The six report kinds added with AI documents: their numbers are exactly reports*.ts output,
// the rule-based parts (shares, rankings, verdicts) behave, and the API spec lists every kind.

let db: DB;
let ws: Workspace;
const END = "2026-09-01";
const exporter = { via: "api_key" as const, apiKeyId: null, name: "Test export" };
const req = (days: number, over: Partial<ReportRequest> = {}): ReportRequest => ({
  start: new Date(Date.parse(`${END}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10),
  end: END,
  model: "linear",
  compare: "previous",
  ...over,
});

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace({ name: "Kinds Co" }));
  await seedDemo(db, ws.id, { anchor: END });
});

describe("new report kinds", () => {
  it("channel mix: platform shares add up and match platforms()", async () => {
    const r = req(30);
    const out = await generateReportPdf(db, ws, "channel-mix", r, exporter);
    const d = out.data as ChannelMixData;
    const plat = await platforms(db, ws, { start: r.start, end: r.end, model: r.model });
    expect(d.platforms.map((p) => ({ platform: p.platform, spendMinor: p.spendMinor, revenueMinor: p.revenueMinor, leads: p.leads, customers: p.customers, roas: p.roas }))).toEqual(plat);
    const shares = d.platforms.reduce((s, p) => s + (p.spendShare ?? 0), 0);
    if (plat.some((p) => p.spendMinor > 0)) expect(shares).toBeCloseTo(1, 6);
    expect(d.daily.series.length).toBeLessThanOrEqual(4);
    for (const s of d.daily.series) expect(s.values).toHaveLength(d.daily.dates.length);
  });

  it("channel mix verdict names the best and worst platform with real spend", () => {
    const base = { revenueMinor: 0, leads: 0, customers: 0, prevRoas: null };
    const rows = [
      { ...base, platform: "meta" as const, spendMinor: 600, roas: 1.2, spendShare: 0.6, revenueShare: 0.3 },
      { ...base, platform: "google" as const, spendMinor: 400, roas: 4.1, spendShare: 0.4, revenueShare: 0.7 },
    ];
    const v = mixVerdict(rows, 2.2)!;
    expect(v.tone).toBe("warning");
    expect(v.title).toContain("4.10×");
    expect(v.text).toContain("60%");
    expect(mixVerdict(rows.slice(0, 1), 2)).toBeNull();
  });

  it("lead quality: campaign rows come from performance() and close rates are customers ÷ leads", async () => {
    const r = req(30);
    const out = await generateReportPdf(db, ws, "lead-quality", r, exporter);
    const d = out.data as LeadQualityData;
    const p = { start: r.start, end: r.end, model: r.model };
    const o = await overview(db, ws, p);
    expect(d.overview).toEqual(o);
    expect(d.closeRate).toBe(o.leads > 0 ? o.customers / o.leads : null);
    const camps = (await performance(db, ws, { ...p, level: "campaign" })).filter((c) => c.leads > 0);
    expect(d.campaigns.map((c) => c.key).sort()).toEqual(camps.map((c) => c.id).sort());
    for (const c of d.campaigns) expect(c.closeRate).toBe(c.leads > 0 ? c.customers / c.leads : null);
    expect(d.leadToPayment).toEqual((await timeToConvert(db, ws, p)).leadToPayment);
  });

  it("lead quality flags cheap-but-cold sources only with enough leads", () => {
    const row = (key: string, leads: number, cpl: number, close: number): LeadSourceRow => ({ key, name: key, platform: "meta", spendMinor: cpl * leads, leads, customers: leads * close, revenueMinor: 0, cplMinor: cpl, closeRate: close, revenuePerLeadMinor: 0 });
    const rows = [row("cheap-cold", 40, 500, 0.02), row("pricey-warm", 10, 3000, 0.4), row("mid", 20, 1500, 0.2), row("tiny", MIN_LEADS_TO_RANK - 1, 100, 0)];
    expect(cheapButCold(rows, 0.2).map((r) => r.key)).toEqual(["cheap-cold"]);
    expect(cheapButCold(rows, null)).toEqual([]);
  });

  it("ad leaderboard ranks performance() at the ad level", async () => {
    const r = req(30);
    const out = await generateReportPdf(db, ws, "ad-leaderboard", r, exporter);
    const d = out.data as AdLeaderboardData;
    const ads = await performance(db, ws, { start: r.start, end: r.end, model: r.model, level: "ad" });
    const expected = rankAds(ads);
    for (const k of Object.keys(expected) as (keyof AdLeaderboardData)[]) expect(d[k], k).toEqual(expected[k]);
    for (let i = 1; i < d.byRevenue.length; i++) expect(d.byRevenue[i - 1].revenueMinor).toBeGreaterThanOrEqual(d.byRevenue[i].revenueMinor);
    for (const a of d.byRoas) expect(a.spendMinor).toBeGreaterThanOrEqual(d.minSpendMinor);
    for (const a of d.byCtr) expect(a.impressions).toBeGreaterThanOrEqual(d.minImpressions);
  });

  it("funnel and time to convert equal reports-analysis.ts", async () => {
    const r = req(90);
    const out = await generateReportPdf(db, ws, "conversion-funnel", r, exporter);
    const d = out.data as ConversionFunnelData;
    const p = { start: r.start, end: r.end, model: r.model };
    expect(d.funnel).toEqual(await funnel(db, ws, p));
    expect(d.timing).toEqual(await timeToConvert(db, ws, p));
    const none = await generateReportPdf(db, ws, "conversion-funnel", { ...r, compare: "none" }, exporter);
    expect((none.data as ConversionFunnelData).funnel.previous).toBeNull();
  });

  it("pipeline activity equals stageFunnel() and counts won/lost from it", async () => {
    const r = req(30);
    const out = await generateReportPdf(db, ws, "pipeline-activity", r, exporter);
    const d = out.data as PipelineActivityData;
    const f = await stageFunnel(db, ws, { start: r.start, end: r.end });
    expect(d.funnel).toEqual(f);
    expect(d.won).toBe(f.steps.filter((s) => s.kind === "won").reduce((s, x) => s + x.reached, 0));
    expect(d.costs.stages.length).toBeLessThanOrEqual(4);
    for (const row of d.costs.rows) expect(row.spendMinor).toBeGreaterThan(0);
  });

  it("profit and refunds equal profitLedger(); the waterfall ends on profit after ads", async () => {
    const r = req(30);
    const out = await generateReportPdf(db, ws, "profit-refunds", r, exporter);
    const d = out.data as ProfitRefundsData;
    const l = await profitLedger(db, ws, { start: r.start, end: r.end });
    expect(d.ledger).toEqual(l);
    expect(d.previous).not.toBeNull();
    const steps = profitSteps(l);
    expect(steps[0]).toEqual({ label: "Gross sales", value: l.grossSalesMinor, kind: "total" });
    expect(steps.at(-1)).toEqual({ label: "Profit after ads", value: l.profitAfterAdsMinor, kind: "total" });
    // The deltas walk gross sales down to profit exactly (integer minor units).
    expect(steps.slice(0, -1).reduce((s, x) => s + x.value, 0)).toBe(l.profitAfterAdsMinor);
    for (const row of d.refunds) expect(row.refundsMinor).toBeLessThan(0);
  });

  it("every kind has catalog metadata and the OpenAPI spec lists every kind", () => {
    for (const k of REPORT_KIND_IDS) {
      expect(REPORT_CATALOG[k].id).toBe(k);
      expect(REPORT_CATALOG[k].sections.length).toBeGreaterThan(2);
    }
    const spec = JSON.parse(readFileSync(path.join(process.cwd(), "public/openapi.json"), "utf8"));
    const param = spec.paths["/api/v1/reports/{report}/pdf"].get.parameters.find((p: { name: string }) => p.name === "report");
    expect(param.schema.enum).toEqual([...REPORT_KIND_IDS]);
  });
});

describe("organization accent in PDFs", () => {
  it("converts theme colours to print hex that reads on white", () => {
    const hex = oklchToPrintHex("oklch(0.53 0.19 259)")!;
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    // pdfTheme accepts it (it falls back to emerald for anything under 3:1).
    expect(pdfTheme(hex).brand).toBe(hex);
    // A light theme (amber) is darkened until it passes instead of being dropped.
    const amber = oklchToPrintHex("oklch(0.62 0.15 68)")!;
    expect(pdfTheme(amber).brand).toBe(amber);
    expect(oklchToPrintHex("not a colour")).toBeNull();
    expect(orgPrintAccent(null)).toBeNull();
    expect(orgPrintAccent({ kind: "solid", id: "emerald" })).toBeNull();
    expect(orgPrintAccent({ kind: "gradient", id: "sunset" })).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("uses the organization's theme on the PDF", async () => {
    await db.update(schema.organizations).set({ theme: { kind: "solid", id: "indigo" } }).where(eq(schema.organizations.id, ws.organizationId));
    const brand = await loadPrintBrand(db, ws);
    expect(brand.theme.brand).toBe(orgPrintAccent({ kind: "solid", id: "indigo" }));
    await db.update(schema.organizations).set({ theme: null }).where(eq(schema.organizations.id, ws.organizationId));
    expect((await loadPrintBrand(db, ws)).theme.brand).toBe(pdfTheme(null).brand);
  });
});
