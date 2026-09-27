import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { Heatmap, HBarChart, LineChart } from "../pdf/charts";
import { Legend, Section, Stat, Table, type Column } from "../pdf/components";
import { credit, monthLabel, monthShort, pct, ratioX } from "../pdf/format";
import { CATEGORICAL, PDF_COLORS as C, TYPE } from "../pdf/theme";
import { overview, type Overview } from "../reports";
import { ltv, type LtvChannelRow, type LtvCohort, type LtvReport } from "../reports-advanced";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelChannel, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

export type LtvCohortsData = { ltv: LtvReport; overview: Overview };

export async function loadLtvCohorts(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<LtvCohortsData>> {
  const p = { start: req.start, end: req.end, model: req.model };
  const [report, ov] = await Promise.all([ltv(db, ws, p), overview(db, ws, p)]);
  return { ltv: report, overview: ov, methodology: await loadMethodology(db, ws, req, ov) };
}

/** Months until a cohort's cumulative LTV per customer covers `cacMinor` (null = not yet). */
export function paybackMonth(cumulativeLtvMinor: number[], cacMinor: number | null): number | null {
  if (cacMinor === null || cacMinor <= 0) return null;
  const i = cumulativeLtvMinor.findIndex((v) => v >= cacMinor);
  return i === -1 ? null : i;
}

const MAX_COLS = 12;
const MAX_ROWS = 12;
const HEAT_LABEL_W = 52;
const HEAT_CELL_W = 64;
const HEAT_EXTRA_W = 56;

const channelName = (r: LtvChannelRow) => (r.platform ? labelPlatform(r.platform) : labelChannel(r.channel ?? r.key));

function Body({ data }: { data: ReportData<LtvCohortsData> }) {
  const W = CONTENT_WIDTH.landscape;
  const r = data.ltv;
  const m = money(r.currency);
  const cac = data.overview.cacMinor;
  const cohorts = r.cohorts.slice(-MAX_ROWS);
  const cols = Math.min(MAX_COLS, Math.max(1, ...cohorts.map((c) => c.cumulativeLtvMinor.length)));
  const recent = r.cohorts.slice(-6);
  const curveLen = Math.min(MAX_COLS, Math.max(1, ...recent.map((c) => c.cumulativeLtvMinor.length)));
  const channels = r.channels.filter((c) => c.customers > 0 || c.spendMinor > 0);
  const withRatio = channels.filter((c) => c.ltvCac !== null).slice(0, 8);
  // A few months of history make a narrow heatmap: the payback table then sits beside it on page 1.
  const HEAT_MAX_W = W * 0.44;
  const sideBySide = cohorts.length > 0 && HEAT_LABEL_W + cols * HEAT_CELL_W + HEAT_EXTRA_W <= HEAT_MAX_W;
  const heatW = sideBySide ? HEAT_MAX_W : W;

  const chanCols: Column<LtvChannelRow>[] = [
    { header: "Acquired through", flex: 1.6, cell: (x) => channelName(x) },
    { header: "Customers", flex: 0.9, align: "right", cell: (x) => credit(x.customers) },
    { header: "Revenue to date", flex: 1.1, align: "right", cell: (x) => m.whole(x.revenueMinor) },
    { header: "Ad spend", flex: 1, align: "right", cell: (x) => (x.spendMinor ? m.whole(x.spendMinor) : "—") },
    { header: "LTV", flex: 0.9, align: "right", cell: (x) => m.whole(x.ltvMinor) },
    { header: "Cost per customer", flex: 1.1, align: "right", cell: (x) => m.whole(x.cacMinor) },
    { header: "LTV:CAC", flex: 0.8, align: "right", cell: (x) => ratioX(x.ltvCac) },
  ];
  const paybackCols: Column<LtvCohort>[] = [
    { header: "Cohort", flex: 1.1, cell: (c) => monthLabel(c.cohort) },
    { header: "Customers", flex: 0.8, align: "right", cell: (c) => credit(c.customers) },
    { header: "LTV to date", flex: 1, align: "right", cell: (c) => m.whole(c.ltvMinor) },
    {
      header: "Payback",
      flex: 1.3,
      align: "right",
      cell: (c) => {
        const pm = paybackMonth(c.cumulativeLtvMinor, cac);
        if (cac === null) return "—";
        if (pm !== null) return pm === 0 ? "First month" : `${pm + 1} months`;
        const last = c.cumulativeLtvMinor[c.cumulativeLtvMinor.length - 1] ?? 0;
        return <Text style={{ fontSize: TYPE.ui, color: C.warningText }}>{`Not yet (${pct(last / cac, 0)})`}</Text>;
      },
    },
  ];

  const heatmap = (
    <Section title="Cumulative revenue per customer" aside={sideBySide ? `By month since first payment · ${r.currency}` : `By month since first payment · ${cohorts.length} cohorts · ${r.currency}`}>
      {cohorts.length ? (
        <Heatmap
          width={heatW}
          rowLabels={cohorts.map((c) => monthShort(c.cohort))}
          colLabels={Array.from({ length: cols }, (_, j) => (j === 0 ? "Month 1" : `${j + 1}`))}
          values={cohorts.map((c) => Array.from({ length: cols }, (_, j) => (j < c.cumulativeLtvMinor.length ? c.cumulativeLtvMinor[j] : null)))}
          format={(v) => m.short(v)}
          rowLabelWidth={HEAT_LABEL_W}
          cellHeight={cohorts.length > 8 ? 14 : 16}
          extra={{ label: "Customers", values: cohorts.map((c) => credit(c.customers)), width: HEAT_EXTRA_W }}
        />
      ) : (
        <Text style={{ fontSize: TYPE.ui, color: C.fgMuted }}>No customer made a first payment in this period.</Text>
      )}
    </Section>
  );
  const payback = (
    <Section title="Payback" aside={cac !== null ? `Against the period's blended cost per customer, ${m.whole(cac)}` : "No ad-attributed customers to compare against"}>
      <Table columns={paybackCols} rows={[...r.cohorts].reverse()} limit={25} moreNoun="cohorts" dense />
      <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted, marginTop: 6, lineHeight: 1.45 }}>
        A cohort is everyone whose first payment fell in that month. Revenue is payments minus refunds up to the end of the period, in {r.currency}. Payback is the first month in which cumulative revenue per customer covers the
        blended cost per customer.
      </Text>
    </Section>
  );

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 10, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.6, borderColor: C.border, borderRadius: 6 }}>
        <Stat label="New customers" value={credit(r.customers)} />
        <Stat label="Their revenue to date" value={m.whole(r.revenueMinor)} tone={C.revenue} />
        <Stat label="LTV per customer" value={m.whole(r.ltvMinor)} />
        <Stat label="Blended cost per customer" value={m.whole(cac)} />
        <Stat label="LTV:CAC" value={r.ltvMinor !== null && cac ? ratioX(r.ltvMinor / cac) : "—"} />
      </View>

      {sideBySide ? (
        <View style={{ flexDirection: "row", gap: 24 }} wrap={false}>
          <View style={{ width: HEAT_MAX_W }}>{heatmap}</View>
          <View style={{ flex: 1 }}>{payback}</View>
        </View>
      ) : (
        heatmap
      )}

      <View style={{ flexDirection: "row", gap: 20 }} wrap={false}>
        <View style={{ flex: 1 }}>
          <Section title="LTV curves" aside="Most recent cohorts">
            <View style={{ marginBottom: 6 }}>
              <Legend items={recent.map((c, i) => ({ label: monthLabel(c.cohort), color: CATEGORICAL[i % CATEGORICAL.length] }))} />
            </View>
            <LineChart
              width={(W - 20) / 2}
              height={150}
              labels={Array.from({ length: curveLen }, (_, j) => `M${j + 1}`)}
              series={recent.map((c, i) => ({ values: Array.from({ length: curveLen }, (_, j) => (j < c.cumulativeLtvMinor.length ? c.cumulativeLtvMinor[j] : null)), color: CATEGORICAL[i % CATEGORICAL.length] }))}
              yFormat={(v) => m.short(v)}
              maxLabels={12}
            />
          </Section>
        </View>
        <View style={{ flex: 1 }}>
          <Section title="LTV:CAC by acquiring channel" aside="Break-even at 1.0×">
            {withRatio.length ? (
              <HBarChart
                width={(W - 20) / 2}
                rows={withRatio.map((c) => ({ label: channelName(c), value: c.ltvCac ?? 0, color: (c.ltvCac ?? 0) >= 1 ? C.revenue : C.negative }))}
                format={(v) => ratioX(v)}
                reference={{ value: 1, label: "1.0×" }}
                rowHeight={17}
              />
            ) : (
              <Text style={{ fontSize: TYPE.ui, color: C.fgMuted }}>No channel has both customers and ad spend in this period.</Text>
            )}
          </Section>
        </View>
      </View>

      <Section title="By acquiring channel" breakBefore style={{ marginTop: 0 }}>
        <Table columns={chanCols} rows={channels} limit={25} moreNoun="channels" dense />
      </Section>

      {sideBySide ? null : payback}
    </View>
  );
}

export const ltvCohorts = defineReportKind<LtvCohortsData>({
  meta: REPORT_CATALOG["ltv-cohorts"],
  load: loadLtvCohorts,
  Body,
});
