import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { MODEL_LABELS } from "../format";
import { HBarChart } from "../pdf/charts";
import { Callout, Section, Stat, Table, type Column } from "../pdf/components";
import { credit, longDate, pct, ratioX, safeText } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { MIN_DAYS_LIVE, MOVE_ASSUMPTIONS, wasteReport, type BudgetMove, type WasteReport, type WasteRow } from "../reports-waste";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

export type WastedSpendData = { waste: WasteReport };

export async function loadWastedSpend(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<WastedSpendData>> {
  const waste = await wasteReport(db, ws, { start: req.start, end: req.end, model: req.model });
  return { waste, methodology: await loadMethodology(db, ws, req) };
}

function MoveCard({ move, currency, index }: { move: BudgetMove; currency: string; index: number }) {
  const m = money(currency);
  return (
    <View wrap={false} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderColor: C.border }}>
      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.fill, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: TYPE.caption, fontWeight: 600, color: C.fgMuted }}>{index + 1}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: TYPE.body, color: C.fg, lineHeight: 1.4 }}>
          Move <Text style={{ fontWeight: 600 }}>{`${m.whole(move.lowMinor)}–${m.whole(move.highMinor)}`}</Text> from {safeText(move.fromName, 60)} to <Text style={{ fontWeight: 600 }}>{safeText(move.toName, 60)}</Text>
        </Text>
        <Text style={{ fontSize: TYPE.caption, color: C.fgMuted, marginTop: 2, lineHeight: 1.4 }}>
          {`${safeText(move.toName, 48)} returned ${ratioX(move.toRoas)} this period. At ${pct(MOVE_ASSUMPTIONS.efficiencyLow, 0)}–${pct(MOVE_ASSUMPTIONS.efficiencyHigh, 0)} of that, the moved budget could bring in `}
          <Text style={{ color: C.positive, fontWeight: 500 }}>{`${m.whole(move.revenueLowMinor)}–${m.whole(move.revenueHighMinor)}`}</Text>
          {" instead of almost nothing."}
        </Text>
      </View>
    </View>
  );
}

function Body({ data }: { data: ReportData<WastedSpendData> }) {
  const W = CONTENT_WIDTH.portrait;
  const w = data.waste;
  const cur = data.methodology.currency;
  const m = money(cur);
  const share = w.totalSpendMinor > 0 ? w.wasteMinor / w.totalSpendMinor : null;

  const cols: Column<WasteRow>[] = [
    { header: "Campaign", flex: 2.8, cell: (r) => r.name, sub: (r) => [labelPlatform(r.platform), r.status ? r.status.toLowerCase() : null].filter(Boolean).join(" · ") },
    { header: "Spend", flex: 1, align: "right", cell: (r) => m.whole(r.spendMinor) },
    { header: "Revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "ROAS", flex: 0.7, align: "right", cell: (r) => ratioX(r.roas) },
    { header: "Leads", flex: 0.7, align: "right", cell: (r) => credit(r.leads) },
    { header: "Days with spend", flex: 1, align: "right", cell: (r) => String(r.activeDays) },
  ];
  const earlyCols: Column<WasteRow>[] = [
    { header: "Campaign", flex: 2.8, cell: (r) => r.name, sub: (r) => labelPlatform(r.platform) },
    { header: "First spend", flex: 1.1, align: "right", cell: (r) => (r.firstSpendDate ? longDate(r.firstSpendDate) : "—") },
    { header: "Spend", flex: 1, align: "right", cell: (r) => m.whole(r.spendMinor) },
    { header: "Revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "ROAS", flex: 0.7, align: "right", cell: (r) => ratioX(r.roas) },
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.6, borderColor: C.border, borderRadius: 6 }}>
        <Stat label="Wasted spend" value={m.whole(w.wasteMinor)} tone={w.wasteMinor > 0 ? C.negative : undefined} />
        <Stat label="Share of ad spend" value={share === null ? "—" : pct(share, 0)} />
        <Stat label="Campaigns flagged" value={String(w.waste.length)} />
        <Stat label="Too early to judge" value={String(w.tooEarly.length)} />
        <Stat label="Total ad spend" value={m.whole(w.totalSpendMinor)} />
      </View>

      <Section title="Suggested budget moves">
        {w.moves.length ? (
          <View>
            {w.moves.map((mv, i) => (
              <MoveCard key={`${mv.fromId}-${mv.toId}`} move={mv} currency={cur} index={i} />
            ))}
          </View>
        ) : (
          <Callout tone={w.waste.length ? "warning" : "positive"} title={w.waste.length ? "No campaign is strong enough to take more budget" : "Nothing to move"}>
            {w.waste.length
              ? `No campaign reached ${MOVE_ASSUMPTIONS.minDestinationRoas}× ROAS with at least 2% of spend. Consider pausing the flagged campaigns instead of moving their budget.`
              : "Every campaign with at least 2% of spend returned 0.5× or better."}
          </Callout>
        )}
      </Section>

      {w.waste.length ? (
        <Section title="Wasted spend by campaign" aside="ROAS under 0.5×, at least 2% of spend">
          <HBarChart width={W} rows={w.waste.slice(0, 10).map((r) => ({ label: r.name, value: r.spendMinor, color: C.negative }))} format={(v) => m.whole(v)} labelWidth={200} />
        </Section>
      ) : null}

      <Section title="Flagged campaigns">
        <Table columns={cols} rows={w.waste} limit={25} moreNoun="campaigns" emptyText="No campaign met the waste criteria in this period." />
      </Section>

      <Section title="Too early to judge" aside={`Fewer than ${MIN_DAYS_LIVE} days live by the end of the period`}>
        <Table columns={earlyCols} rows={w.tooEarly} limit={25} moreNoun="campaigns" dense emptyText="Every flagged campaign has been live long enough to judge." />
      </Section>

      <View style={{ marginTop: 16 }} wrap={false}>
        <Callout tone="neutral" title="Assumptions">
          <Text style={{ fontSize: TYPE.caption, color: C.fg, lineHeight: 1.5 }}>
            {`Wasted means at least ${m.whole(w.minSpendMinor)} (2% of spend) with ROAS under 0.5× on ${(MODEL_LABELS[data.methodology.model] ?? data.methodology.model).toLowerCase()} attribution. Campaigns that started spending in the last ${MIN_DAYS_LIVE} days are listed separately, not counted. Moves suggest ${pct(MOVE_ASSUMPTIONS.shareLow, 0)}–${pct(MOVE_ASSUMPTIONS.shareHigh, 0)} of a flagged campaign's spend for the next period of the same length, into campaigns at ${MOVE_ASSUMPTIONS.minDestinationRoas}× ROAS or better. Extra budget usually earns less than current budget, so we assume ${pct(MOVE_ASSUMPTIONS.efficiencyLow, 0)}–${pct(MOVE_ASSUMPTIONS.efficiencyHigh, 0)} of today's ROAS. Brand search and retargeting are capped by demand: check impression share before scaling them. These are ranges to test, not forecasts.`}
          </Text>
        </Callout>
      </View>
    </View>
  );
}

export const wastedSpendReport = defineReportKind<WastedSpendData>({
  meta: REPORT_CATALOG["wasted-spend"],
  load: loadWastedSpend,
  Body,
});
