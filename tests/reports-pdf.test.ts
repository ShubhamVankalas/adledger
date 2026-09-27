import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { niceTicks, spread } from "@/lib/pdf/charts";
import { moneyWhole, safeText } from "@/lib/pdf/format";
import { pdfTheme } from "@/lib/pdf/theme";
import { REPORT_KIND_IDS, getReportKind, type ReportData, type ReportRequest } from "@/lib/report-kinds";
import { defaultScheduleName } from "@/lib/report-kinds/catalog";
import type { AttributionModelsData } from "@/lib/report-kinds/attribution-models";
import type { ExecutiveSummaryData } from "@/lib/report-kinds/executive-summary";
import { paybackMonth, type LtvCohortsData } from "@/lib/report-kinds/ltv-cohorts";
import { countPdfPages, generateReportPdf, reportDataHash } from "@/lib/report-kinds/render";
import { lookupFingerprint } from "@/lib/report-kinds/verify";
import type { WastedSpendData } from "@/lib/report-kinds/wasted-spend";
import type { WeeklyPerformanceData } from "@/lib/report-kinds/weekly-performance";
import { overview, performance, previousPeriod, timeseries, wastedSpend } from "@/lib/reports";
import { ltv, modelComparison } from "@/lib/reports-advanced";
import { wasteReport } from "@/lib/reports-waste";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// Every report kind renders a real PDF from the demo ledger, quickly, and the numbers it draws
// are exactly the reports*.ts output (the loaded ReportData is what the PDF prints).

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
const days = { "executive-summary": 30, "weekly-performance": 7, "attribution-models": 30, "ltv-cohorts": 180, "wasted-spend": 30 } as const;

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace({ name: "Acme Analytics" }));
  await seedDemo(db, ws.id, { anchor: END });
});

describe("PDF reports on the demo ledger", () => {
  it.each(REPORT_KIND_IDS)("%s renders a non-empty PDF in under 3 s and logs the export", async (kind) => {
    const t = performance_now();
    const out = await generateReportPdf(db, ws, kind, req(days[kind]), exporter);
    const ms = performance_now() - t;
    expect(out.pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(out.pdf.byteLength).toBeGreaterThan(10_000);
    expect(out.pages).toBeGreaterThan(0);
    expect(out.pages).toBe(countPdfPages(out.pdf));
    expect(ms).toBeLessThan(3000);
    // Fonts are embedded (no base-14 fallback).
    expect(out.pdf.toString("latin1")).toMatch(/\/FontFile2/);
    expect(out.filename).toMatch(new RegExp(`^adledger-[a-z0-9-]+-${kind}-\\d{4}-\\d{2}-\\d{2}-to-${END}\\.pdf$`));

    const [row] = await db.select().from(schema.exportLog).where(eq(schema.exportLog.id, out.exportId));
    expect(row).toMatchObject({ workspaceId: ws.id, reportKind: kind, fingerprint: out.fingerprint, dataHash: out.dataHash, via: "api_key", status: "ok", pages: out.pages, bytes: out.pdf.byteLength });
    // IDs and parameters only: nothing personal in the log.
    expect(Object.keys(row.params).sort()).toEqual(["compare", "end", "model", "start"]);
    expect(JSON.stringify(row)).not.toMatch(/@/);
  });

  it("executive summary numbers equal reports.ts", async () => {
    const r = req(30);
    const out = await generateReportPdf(db, ws, "executive-summary", r, exporter);
    const data = out.data as ExecutiveSummaryData;
    const p = { start: r.start, end: r.end, model: r.model };
    expect(data.current).toEqual(await overview(db, ws, p));
    expect(data.previous).toEqual(await overview(db, ws, previousPeriod(p)));
    expect(data.series).toEqual(await timeseries(db, ws, p));
    const campaigns = await performance(db, ws, { ...p, level: "campaign" });
    const best = [...campaigns].sort((a, b) => b.revenueMinor - a.revenueMinor)[0];
    expect(data.top[0]).toEqual(best);
    expect(data.statements[0]).toContain(moneyWhole(data.current.revenueMinor, ws.reportingCurrency));
  });

  it("weekly performance numbers equal reports.ts", async () => {
    const r = req(7);
    const out = await generateReportPdf(db, ws, "weekly-performance", r, exporter);
    const data = out.data as ReportData<WeeklyPerformanceData>;
    const p = { start: r.start, end: r.end, model: r.model };
    expect(data.current).toEqual(await overview(db, ws, p));
    expect(data.campaigns).toEqual(await performance(db, ws, { ...p, level: "campaign" }));
    expect(data.waste).toEqual(await wastedSpend(db, ws, { ...p, level: "campaign" }));
    expect(data.methodology.unattributedShare).toBe(data.current.unattributedShare);
    expect(data.methodology.compareStart).toBe(previousPeriod(p).start);
  });

  it("attribution, LTV and waste numbers equal reports-advanced.ts / reports-waste.ts", async () => {
    const a = await generateReportPdf(db, ws, "attribution-models", req(30), exporter);
    expect((a.data as AttributionModelsData).comparison).toEqual(await modelComparison(db, ws, { start: req(30).start, end: END }));
    // Kinds that don't compare periods drop `compare`, so the log and fingerprint describe what was printed.
    expect((a.data as ReportData<AttributionModelsData>).methodology.compareStart).toBeNull();

    const r = req(180, { model: "first_touch" });
    const l = await generateReportPdf(db, ws, "ltv-cohorts", r, exporter);
    const ld = l.data as LtvCohortsData;
    expect(ld.ltv).toEqual(await ltv(db, ws, { start: r.start, end: r.end, model: "first_touch" }));
    expect(ld.overview.cacMinor).toBe((await overview(db, ws, { start: r.start, end: r.end, model: "first_touch" })).cacMinor);

    const w = await generateReportPdf(db, ws, "wasted-spend", req(30), exporter);
    const wd = (w.data as WastedSpendData).waste;
    expect(wd).toEqual(await wasteReport(db, ws, { start: req(30).start, end: END, model: "linear" }));
    const flagged = await wastedSpend(db, ws, { start: req(30).start, end: END, model: "linear" });
    expect([...wd.waste, ...wd.tooEarly].map((x) => x.id).sort()).toEqual(flagged.map((x) => x.id).sort());
    expect(wd.wasteMinor).toBe(wd.waste.reduce((s, x) => s + x.spendMinor, 0));
    for (const m of wd.moves) {
      expect(m.lowMinor).toBeLessThanOrEqual(m.highMinor);
      expect(Number.isInteger(m.lowMinor) && Number.isInteger(m.revenueHighMinor)).toBe(true);
    }
  });

  it("the same numbers hash the same, but every export has its own fingerprint", async () => {
    const kind = getReportKind("executive-summary")!;
    const r = req(30);
    const a = await generateReportPdf(db, ws, kind.meta.id, r, exporter);
    const b = await generateReportPdf(db, ws, kind.meta.id, r, exporter);
    expect(a.dataHash).toBe(b.dataHash);
    expect(a.dataHash).toBe(reportDataHash(kind.meta.id, r, a.data));
    expect(a.fingerprint).not.toBe(b.fingerprint);
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("embeds the organization's PNG logo", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await db.update(schema.organizations).set({ logoPng: new Uint8Array(png) }).where(eq(schema.organizations.id, ws.organizationId));
    const out = await generateReportPdf(db, ws, "executive-summary", req(30), exporter);
    expect(out.pdf.toString("latin1")).toMatch(/\/Subtype\s*\/Image/);
    await db.update(schema.organizations).set({ logoPng: null }).where(eq(schema.organizations.id, ws.organizationId));
  });

  it("/verify confirms a real fingerprint and reveals no numbers or personal data", async () => {
    const out = await generateReportPdf(db, ws, "weekly-performance", req(7), { via: "api_key", apiKeyId: null, name: "Jane Exporter" });
    const printed = out.fingerprint.slice(0, 20).match(/.{4}/g)!.join(" ");
    const found = await lookupFingerprint(db, printed.toUpperCase());
    expect(found.status).toBe("found");
    if (found.status !== "found") return;
    expect(Object.keys(found.report).sort()).toEqual(["end", "issuedAt", "kind", "scheduled", "start", "title", "workspace"]);
    expect(found.report).toMatchObject({ kind: "weekly-performance", title: "Weekly performance", workspace: "Acme Analytics", start: req(7).start, end: END, scheduled: false });
    const json = JSON.stringify(found);
    expect(json).not.toContain("Jane");
    expect(json).not.toMatch(/@/);
    const data = out.data as ReportData<WeeklyPerformanceData>;
    expect(json).not.toContain(String(data.current.revenueMinor));
    expect(json).not.toContain(String(data.current.spendMinor));

    expect((await lookupFingerprint(db, "")).status).toBe("empty");
    expect((await lookupFingerprint(db, "7f3a 9c21")).status).toBe("invalid");
    expect((await lookupFingerprint(db, "not a fingerprint at all zz")).status).toBe("invalid");
    expect((await lookupFingerprint(db, "0000 0000 0000 0000 0000")).status).toBe("not_found");
    // An edited fingerprint (one character changed) is rejected.
    const edited = `${out.fingerprint.slice(0, 19)}${out.fingerprint[19] === "0" ? "1" : "0"}`;
    expect((await lookupFingerprint(db, edited)).status).toBe("not_found");
  });
});

describe("PDF kit helpers", () => {
  it("nice ticks cover the data with round steps", () => {
    expect(niceTicks(0, 13_500, 4)).toMatchObject({ min: 0, max: 15_000, step: 5_000, ticks: [0, 5_000, 10_000, 15_000] });
    expect(niceTicks(-120, 480, 4).ticks).toEqual([-200, 0, 200, 400, 600]);
    expect(niceTicks(0, 0).ticks).toEqual([0]);
    expect(niceTicks(5, 5, 4, { includeZero: false }).ticks[0]).toBeLessThan(5);
    const t = niceTicks(Number.NaN, Number.POSITIVE_INFINITY);
    expect(t.ticks.every(Number.isFinite)).toBe(true);
  });

  it("spreads overlapping labels apart without reordering them", () => {
    const out = spread([50, 51, 52, 90], 10, 0, 100);
    expect(out[1] - out[0]).toBeGreaterThanOrEqual(10);
    expect(out[2] - out[1]).toBeGreaterThanOrEqual(10);
    expect(out[3]).toBe(90);
    expect(Math.max(...spread([95, 96, 97], 10, 0, 100))).toBeLessThanOrEqual(100);
  });

  it("sanitizes user strings before they reach the PDF", () => {
    expect(safeText("Brand‮\u0000 search\n\tcampaign")).toBe("Brand search campaign");
    expect(safeText("x".repeat(200), 10)).toHaveLength(10);
    expect(safeText(null)).toBe("");
  });

  it("prints ISO codes for currency symbols the font lacks", () => {
    expect(moneyWhole(1_234_500, "USD")).toBe("$12,345");
    expect(moneyWhole(1_234_500, "INR")).toContain("₹");
    expect(moneyWhole(12_345, "KRW")).toMatch(/^KRW/);
    expect(moneyWhole(-500, "USD")).toBe("−$5");
    expect(moneyWhole(450, "USD")).toBe("$4.50");
  });

  it("only accepts a safe hex accent colour", () => {
    expect(pdfTheme("#1D4ED8").brand).toBe("#1d4ed8");
    expect(pdfTheme("#fafafa").brand).toBe("#008859"); // too light on white
    expect(pdfTheme('red" onload="x').brand).toBe("#008859");
  });

  it("names schedules without repeating the cadence", () => {
    expect(defaultScheduleName("Weekly performance", "weekly")).toBe("Weekly performance");
    expect(defaultScheduleName("Weekly performance", "monthly")).toBe("Weekly performance, monthly");
    expect(defaultScheduleName("Executive summary", "weekly")).toBe("Executive summary, weekly");
  });

  it("payback is the first month cumulative LTV covers CAC", () => {
    expect(paybackMonth([500, 900, 1200], 1000)).toBe(2);
    expect(paybackMonth([500, 900], 1000)).toBeNull();
    expect(paybackMonth([500], null)).toBeNull();
  });
});

function performance_now() {
  return globalThis.performance.now();
}
