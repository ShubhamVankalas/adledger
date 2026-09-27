import { Text, View } from "@react-pdf/renderer";
import { overview, performance, timeseries, type Overview, type PerfRow, type SeriesPoint } from "../reports";
import { ComboChart } from "../pdf/charts";
import { Bullets, KpiTile, Legend, Section, Table, type Column } from "../pdf/components";
import { credit, dateRange, ratioX, shortDate } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { REPORT_CATALOG } from "./catalog";
import { compareRange, loadMethodology } from "./methodology";
import { CONTENT_WIDTH, dailyRatio, labelPlatform, money, summaryStatements } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";
import type { DB } from "../db";
import type { Workspace } from "../settings";

export type ExecutiveSummaryData = {
  current: Overview;
  previous: Overview | null;
  series: SeriesPoint[];
  previousSeries: SeriesPoint[] | null;
  /** Best three campaigns by attributed revenue. */
  top: PerfRow[];
  /** Worst three by ROAS among campaigns with at least 2% of spend. */
  bottom: PerfRow[];
  statements: string[];
};

export async function loadExecutiveSummary(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<ExecutiveSummaryData>> {
  const p = { start: req.start, end: req.end, model: req.model };
  const cmp = compareRange(req);
  const [current, previous, series, previousSeries, campaigns] = await Promise.all([
    overview(db, ws, p),
    cmp ? overview(db, ws, { ...p, ...cmp }) : Promise.resolve(null),
    timeseries(db, ws, p),
    cmp ? timeseries(db, ws, { ...p, ...cmp }) : Promise.resolve(null),
    performance(db, ws, { ...p, level: "campaign" }),
  ]);
  const total = campaigns.reduce((s, c) => s + c.spendMinor, 0);
  const top = [...campaigns].filter((c) => c.revenueMinor > 0).sort((a, b) => b.revenueMinor - a.revenueMinor || b.spendMinor - a.spendMinor).slice(0, 3);
  const topIds = new Set(top.map((c) => c.id));
  const bottom = campaigns
    .filter((c) => c.spendMinor >= Math.max(1, total * 0.02) && !topIds.has(c.id))
    .sort((a, b) => (a.roas ?? 0) - (b.roas ?? 0) || b.spendMinor - a.spendMinor)
    .slice(0, 3);
  return {
    current,
    previous,
    series,
    previousSeries,
    top,
    bottom,
    statements: summaryStatements(current, previous, campaigns, ws.reportingCurrency),
    methodology: await loadMethodology(db, ws, req, current),
  };
}

function Body({ data }: { data: ReportData<ExecutiveSummaryData> }) {
  const W = CONTENT_WIDTH.portrait;
  const cur = data.current;
  const prev = data.previous;
  const m = money(cur.currency);
  const tileW = (W - 16) / 3;
  const spend = data.series.map((d) => d.spendMinor);
  const rev = data.series.map((d) => d.revenueMinor);
  const pSpend = data.previousSeries?.map((d) => d.spendMinor);
  const pRev = data.previousSeries?.map((d) => d.revenueMinor);
  const attributed = data.series.map((d) => d.attributedRevenueMinor);
  const leads = data.series.map((d) => d.leads);

  const cols = (kind: "top" | "bottom"): Column<PerfRow>[] => [
    { header: kind === "top" ? "Top campaigns" : "Needs attention", flex: 2.4, cell: (r) => r.name, sub: (r) => labelPlatform(r.platform) },
    { header: "Spend", flex: 1, align: "right", cell: (r) => m.whole(r.spendMinor) },
    { header: "Revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "ROAS", flex: 0.8, align: "right", cell: (r) => ratioX(r.roas) },
  ];

  return (
    <View>
      <View style={{ backgroundColor: C.bgSubtle, borderRadius: 6, paddingVertical: 9, paddingHorizontal: 11, marginTop: 10 }}>
        <Bullets items={data.statements} size={TYPE.body - 0.5} />
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <KpiTile width={tileW} label="Ad spend" value={m.whole(cur.spendMinor)} cur={cur.spendMinor} prev={prev ? prev.spendMinor : undefined} prevLabel={prev ? m.short(prev.spendMinor) : undefined} polarity="neutral" spark={spend} sparkCompare={pSpend} color={C.spend} />
        <KpiTile width={tileW} label="Revenue" value={m.whole(cur.revenueMinor)} cur={cur.revenueMinor} prev={prev ? prev.revenueMinor : undefined} prevLabel={prev ? m.short(prev.revenueMinor) : undefined} polarity="up" spark={rev} sparkCompare={pRev} color={C.revenue} />
        <KpiTile width={tileW} label="ROAS" value={ratioX(cur.roas)} cur={cur.roas} prev={prev ? prev.roas : undefined} prevLabel={prev ? ratioX(prev.roas) : undefined} polarity="up" spark={dailyRatio(attributed, spend)} color={C.revenue} />
        <KpiTile width={tileW} label="Customers" value={credit(cur.customers)} cur={cur.customers} prev={prev ? prev.customers : undefined} prevLabel={prev ? credit(prev.customers) : undefined} polarity="up" />
        <KpiTile width={tileW} label="Cost per customer" value={m.whole(cur.cacMinor)} cur={cur.cacMinor} prev={prev ? prev.cacMinor : undefined} prevLabel={prev ? m.short(prev.cacMinor) : undefined} polarity="down" />
        <KpiTile width={tileW} label="Leads" value={credit(cur.leads)} cur={cur.leads} prev={prev ? prev.leads : undefined} prevLabel={prev ? credit(prev.leads) : undefined} polarity="up" spark={leads} color={C.leads} />
      </View>

      <Section title="Spend and revenue by day" aside={dateRange(cur.start, cur.end)} style={{ marginTop: 14 }}>
        <View style={{ marginBottom: 6 }}>
          <Legend
            items={[
              { label: "Ad spend", color: C.spend, box: true },
              { label: "Revenue", color: C.revenue },
              ...(data.previousSeries ? [{ label: "Revenue, previous period", color: C.fgFaint, dashed: true }] : []),
            ]}
          />
        </View>
        <ComboChart
          width={W}
          height={116}
          labels={data.series.map((d) => shortDate(d.date))}
          bars={{ values: spend, color: C.spend }}
          line={{ values: rev, color: C.revenue }}
          compare={pRev ? { values: pRev.slice(0, rev.length), color: C.fgMuted } : undefined}
          yFormat={(v) => m.short(v)}
        />
      </Section>

      <View style={{ flexDirection: "row", gap: 14, marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <Table columns={cols("top")} rows={data.top} limit={3} dense emptyText="No campaign earned attributed revenue." />
        </View>
        <View style={{ flex: 1 }}>
          <Table columns={cols("bottom")} rows={data.bottom} limit={3} dense emptyText="Every campaign with real spend is returning revenue." />
        </View>
      </View>
      {cur.warnings.length ? <Text style={{ fontSize: TYPE.micro, color: C.warningText, marginTop: 6 }}>{cur.warnings.join(" ")}</Text> : null}
    </View>
  );
}

export const executiveSummary = defineReportKind<ExecutiveSummaryData>({
  meta: REPORT_CATALOG["executive-summary"],
  load: loadExecutiveSummary,
  Body,
});
