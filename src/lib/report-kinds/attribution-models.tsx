import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { SlopeChart } from "../pdf/charts";
import { Callout, Legend, Section, Stat, Table, type Column } from "../pdf/components";
import { moneyDelta, pct, ratioX, safeText } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { modelComparison, ROLE_THRESHOLD, type ModelComparison, type ModelComparisonRow } from "../reports-advanced";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

export type AttributionModelsData = { comparison: ModelComparison };

export async function loadAttributionModels(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<AttributionModelsData>> {
  const comparison = await modelComparison(db, ws, { start: req.start, end: req.end });
  return { comparison, methodology: await loadMethodology(db, ws, req) };
}

const ROLE_COLOR = { starter: C.revenue, closer: C.customers, balanced: C.fgFaint } as const;
const ROLE_LABEL = { starter: "Starter", closer: "Closer", balanced: "Balanced" } as const;
const TOTAL = "__total";

function Body({ data }: { data: ReportData<AttributionModelsData> }) {
  const W = CONTENT_WIDTH.portrait;
  const r = data.comparison;
  const m = money(r.currency);
  const starters = r.rows.filter((x) => x.role === "starter");
  const closers = r.rows.filter((x) => x.role === "closer");
  const slope = [...r.rows]
    .filter((x) => x.firstTouch.revenueMinor > 0 || x.lastTouch.revenueMinor > 0)
    .sort((a, b) => Math.max(b.firstTouch.revenueMinor, b.lastTouch.revenueMinor) - Math.max(a.firstTouch.revenueMinor, a.lastTouch.revenueMinor))
    .slice(0, 9);
  const gain = (rows: ModelComparisonRow[], sign: 1 | -1) => rows.reduce((s, x) => s + sign * x.deltaMinor, 0);

  const cols: Column<ModelComparisonRow>[] = [
    { header: "Campaign", flex: 2.8, cell: (x) => x.name, sub: (x) => (x.id === TOTAL ? null : labelPlatform(x.platform)) },
    { header: "Spend", flex: 1, align: "right", cell: (x) => m.whole(x.spendMinor) },
    { header: "First touch", flex: 1, align: "right", cell: (x) => m.whole(x.firstTouch.revenueMinor), sub: (x) => ratioX(x.firstTouch.roas) },
    { header: "Last touch", flex: 1, align: "right", cell: (x) => m.whole(x.lastTouch.revenueMinor), sub: (x) => ratioX(x.lastTouch.roas) },
    { header: "Linear", flex: 1, align: "right", cell: (x) => m.whole(x.linear.revenueMinor), sub: (x) => ratioX(x.linear.roas) },
    {
      header: "Role",
      flex: 0.95,
      align: "right",
      cell: (x) => (x.id === TOTAL ? "" : <Text style={{ fontSize: TYPE.ui, color: x.role === "balanced" ? C.fgMuted : ROLE_COLOR[x.role], fontWeight: 500 }}>{ROLE_LABEL[x.role]}</Text>),
      sub: (x) => (x.deltaShare === null ? null : `${x.deltaMinor >= 0 ? "+" : "−"}${pct(Math.abs(x.deltaShare), 0)} first`),
    },
  ];

  const list = (rows: ModelComparisonRow[]) =>
    rows
      .slice(0, 4)
      .map((x) => `${safeText(x.name, 44)} (${m.short(x.firstTouch.revenueMinor)} first vs ${m.short(x.lastTouch.revenueMinor)} last)`)
      .join(" · ") + (rows.length > 4 ? ` · and ${rows.length - 4} more` : "");

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.6, borderColor: C.border, borderRadius: 6 }}>
        <Stat label="Campaign spend" value={m.whole(r.totals.spendMinor)} />
        <Stat label="First touch ROAS" value={ratioX(r.totals.firstTouch.roas)} />
        <Stat label="Last touch ROAS" value={ratioX(r.totals.lastTouch.roas)} />
        <Stat label="Linear ROAS" value={ratioX(r.totals.linear.roas)} />
        <Stat label="Starters" value={String(starters.length)} tone={starters.length ? C.revenue : undefined} />
        <Stat label="Closers" value={String(closers.length)} tone={closers.length ? C.customers : undefined} />
      </View>

      <Section title="First touch vs last touch revenue" aside="Top campaigns by revenue">
        <View style={{ marginBottom: 6 }}>
          <Legend
            items={[
              { label: "Starter: earns more on first touch", color: C.revenue },
              { label: "Closer: earns more on last touch", color: C.customers },
              { label: `Balanced: within ${pct(ROLE_THRESHOLD, 0)}`, color: C.fgFaint },
            ]}
          />
        </View>
        {slope.length ? (
          <SlopeChart
            width={W}
            height={Math.max(150, 24 + slope.length * 22)}
            items={slope.map((x) => ({ label: x.name, a: x.firstTouch.revenueMinor, b: x.lastTouch.revenueMinor, color: ROLE_COLOR[x.role] }))}
            leftTitle="First touch"
            rightTitle="Last touch"
            format={(v) => m.short(v)}
          />
        ) : (
          <Text style={{ fontSize: TYPE.ui, color: C.fgMuted }}>No campaign earned attributed revenue in this period.</Text>
        )}
      </Section>

      <View style={{ flexDirection: "row", gap: 12, marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <Callout tone="positive" title={starters.length ? `${starters.length} journey ${starters.length === 1 ? "starter" : "starters"}, ${moneyDelta(gain(starters, 1), r.currency)} on first touch` : "No clear journey starters"}>
            <Text style={{ fontSize: TYPE.caption, color: C.fg, lineHeight: 1.45 }}>
              {starters.length ? `They introduce people who later buy through something else. Last-touch reports undervalue them. ${list(starters)}` : "No campaign earns clearly more under first touch than last touch."}
            </Text>
          </Callout>
        </View>
        <View style={{ flex: 1 }}>
          <Callout tone="neutral" title={closers.length ? `${closers.length} journey ${closers.length === 1 ? "closer" : "closers"}, ${moneyDelta(gain(closers, -1), r.currency)} on last touch` : "No clear journey closers"}>
            <Text style={{ fontSize: TYPE.caption, color: C.fg, lineHeight: 1.45 }}>
              {closers.length ? `They catch people who were already on their way, like brand search and retargeting. ${list(closers)}` : "No campaign earns clearly more under last touch than first touch."}
            </Text>
          </Callout>
        </View>
      </View>

      <Section title="Revenue and ROAS under every model" aside="Sorted by spend" breakBefore style={{ marginTop: 0 }}>
        <Table
          columns={cols}
          rows={r.rows}
          limit={25}
          moreNoun="campaigns"
          total={{
            id: TOTAL,
            name: "All campaigns",
            platform: "other",
            status: null,
            spendMinor: r.totals.spendMinor,
            firstTouch: r.totals.firstTouch,
            lastTouch: r.totals.lastTouch,
            linear: r.totals.linear,
            deltaMinor: r.totals.firstTouch.revenueMinor - r.totals.lastTouch.revenueMinor,
            deltaShare: null,
            role: "balanced",
          }}
        />
        <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted, marginTop: 6, lineHeight: 1.45 }}>
          A campaign starts or closes journeys when first-touch and last-touch revenue differ by at least {pct(ROLE_THRESHOLD, 0)} of the larger value. Totals move between models only when some touches in a journey are not
          from campaigns (organic, email, direct).
        </Text>
      </Section>
    </View>
  );
}

export const attributionModels = defineReportKind<AttributionModelsData>({
  meta: REPORT_CATALOG["attribution-models"],
  load: loadAttributionModels,
  Body,
});
