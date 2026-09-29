import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { BarChart, Funnel } from "../pdf/charts";
import { Callout, KpiTile, Section, Stat, Table, type Column } from "../pdf/components";
import { credit, num, pct } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { funnel, LAG_BUCKETS, MIN_FOR_RECOMMENDATION, timeToConvert, TOUCH_BUCKETS, type CampaignLagRow, type FunnelReport, type LagStats, type TimeToConvert } from "../reports-analysis";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { compareRange, loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

// Funnel and time to convert: visitors → leads → customers for the period, then how long and
// how many touches a sale takes (reports-analysis.ts), and whether the attribution window fits.

export type ConversionFunnelData = { funnel: FunnelReport; timing: TimeToConvert };

export async function loadConversionFunnel(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<ConversionFunnelData>> {
  const p = { start: req.start, end: req.end, model: req.model };
  const [f, timing] = await Promise.all([funnel(db, ws, p, { compare: compareRange(req) !== null }), timeToConvert(db, ws, p)]);
  return { funnel: f, timing, methodology: await loadMethodology(db, ws, req) };
}

const days = (v: number | null) => (v === null ? "—" : `${num(v, v < 10 ? 1 : 0)} ${v === 1 ? "day" : "days"}`);

function LagCard({ title, s, width }: { title: string; s: LagStats; width: number }) {
  return (
    <View style={{ width, borderWidth: 0.6, borderColor: C.border, borderRadius: 5, paddingVertical: 8, paddingHorizontal: 9 }} wrap={false}>
      <Text style={{ fontSize: TYPE.caption, fontWeight: 500, color: C.fgMuted }}>{title}</Text>
      <Text style={{ fontSize: TYPE.kpi, fontWeight: 600, color: C.fg, letterSpacing: -0.3, marginTop: 2 }}>{days(s.medianDays)}</Text>
      <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted, marginTop: 1.5 }}>median · 80% within {days(s.p80Days)}</Text>
      <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgFaint, marginTop: 1 }}>{num(s.conversions)} conversions</Text>
    </View>
  );
}

function Body({ data }: { data: ReportData<ConversionFunnelData> }) {
  const W = CONTENT_WIDTH.portrait;
  const f = data.funnel;
  const prev = f.previous;
  const t = data.timing;
  const m = money(f.currency);
  const tileW = (W - 24) / 4;
  const cardW = (W - 16) / 3;
  const windowFits = t.recommendedWindowDays === null || t.recommendedWindowDays <= t.windowDays;

  const campaignCols: Column<CampaignLagRow>[] = [
    { header: "Campaign", flex: 2.6, cell: (r) => r.name, sub: (r) => labelPlatform(r.platform) },
    { header: "Customers", flex: 0.85, align: "right", cell: (r) => credit(r.customers) },
    { header: "Median to pay", flex: 1, align: "right", cell: (r) => days(r.medianDays) },
    { header: "80% within", flex: 0.9, align: "right", cell: (r) => days(r.p80Days) },
    { header: "Leads", flex: 0.7, align: "right", cell: (r) => credit(r.leads) },
    { header: "Median to lead", flex: 1, align: "right", cell: (r) => days(r.leadMedianDays) },
  ];

  return (
    <View>
      <Section title="Funnel" aside="Visitors with any tracked event; first leads and first payments in the period">
        <Funnel
          width={W}
          steps={[
            { label: "Visitors", value: f.visitors },
            { label: "Leads", value: f.leads },
            { label: "Customers", value: f.customers },
          ]}
          format={(v) => credit(v)}
          color={C.customers}
          rowHeight={24}
        />
      </Section>

      <Section title={prev ? "Step rates vs previous period" : "Step rates"}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <KpiTile width={tileW} label="Visitor to lead" value={pct(f.leadRate, 2)} cur={f.leadRate} prev={prev ? prev.leadRate : undefined} prevLabel={prev ? pct(prev.leadRate, 2) : undefined} polarity="up" />
          <KpiTile width={tileW} label="Lead to customer" value={pct(f.closeRate)} cur={f.closeRate} prev={prev ? prev.closeRate : undefined} prevLabel={prev ? pct(prev.closeRate) : undefined} polarity="up" />
          <KpiTile width={tileW} label="Visitor to customer" value={pct(f.visitorRate, 2)} cur={f.visitorRate} prev={prev ? prev.visitorRate : undefined} prevLabel={prev ? pct(prev.visitorRate, 2) : undefined} polarity="up" />
          <KpiTile width={tileW} label="Revenue per visitor" value={m.whole(f.revenuePerVisitorMinor)} cur={f.revenuePerVisitorMinor} prev={prev ? prev.revenuePerVisitorMinor : undefined} prevLabel={prev ? m.short(prev.revenuePerVisitorMinor) : undefined} polarity="up" />
        </View>
        <Text style={{ fontSize: TYPE.caption, color: C.fgMuted, marginTop: 6, lineHeight: 1.45 }}>
          {`New customers in the period brought in ${m.whole(f.revenueMinor)}. Rates are period rates: a customer who became a lead in an earlier period still counts here.`}
        </Text>
      </Section>

      <Section title="Days to convert" aside={`Attribution window: ${t.windowDays} days`}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <LagCard title="First touch to lead" s={t.touchToLead} width={cardW} />
          <LagCard title="Lead to payment" s={t.leadToPayment} width={cardW} />
          <LagCard title="First touch to payment" s={t.touchToPayment} width={cardW} />
        </View>
        <View style={{ marginTop: 10 }}>
          <BarChart
            width={W}
            height={104}
            categories={LAG_BUCKETS.map((b) => b.label)}
            series={[{ name: "First touch to payment", values: t.touchToPayment.buckets, color: C.revenue }]}
            yFormat={(v) => num(v)}
          />
          <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted, marginTop: 3 }}>Customers by days from first tracked touch to first payment</Text>
        </View>
      </Section>

      <View style={{ flexDirection: "row", gap: 16 }} break>
        <View style={{ flex: 1 }}>
          <Section title="Touches before buying" style={{ marginTop: 0 }}>
            <BarChart width={(W - 16) / 2} height={96} categories={TOUCH_BUCKETS.map((b) => (b === "1" ? "1 touch" : `${b}`))} series={[{ name: "Customers", values: t.touches.buckets, color: C.customers }]} yFormat={(v) => num(v)} />
            <View style={{ flexDirection: "row", gap: 18, marginTop: 8 }}>
              <Stat label="Average touches" value={t.touches.avg === null ? "—" : num(t.touches.avg, 1)} />
              <Stat label="Tracked customers" value={`${num(t.touches.tracked)} of ${num(t.touches.customers)}`} />
              <Stat label="Across devices" value={pct(t.crossDeviceShare, 0)} />
            </View>
          </Section>
        </View>
        <View style={{ flex: 1 }}>
          <Section title="Attribution window" style={{ marginTop: 0 }}>
            {t.recommendedWindowDays === null ? (
              <Callout tone="neutral" title="Not enough conversions to judge the window">
                {`The window check needs at least ${MIN_FOR_RECOMMENDATION} customers with a tracked first touch. This period had ${num(t.touchToPayment.conversions)}.`}
              </Callout>
            ) : windowFits ? (
              <Callout tone="positive" title={`Your ${t.windowDays}-day window fits`}>
                {`90% of customers paid within ${t.recommendedWindowDays} days of their first touch, inside the current window. ${pct(t.touchToPayment.withinWindowShare, 0)} converted within it.`}
              </Callout>
            ) : (
              <Callout tone="warning" title={`Consider a ${t.recommendedWindowDays}-day window`}>
                {`Only ${pct(t.touchToPayment.withinWindowShare, 0)} of customers paid within the current ${t.windowDays}-day window. Sales that take longer get no ad credit, which understates slower campaigns.`}
              </Callout>
            )}
          </Section>
        </View>
      </View>

      <Section title="Campaign timing" aside="Customers and leads each campaign touched inside the window">
        <Table columns={campaignCols} rows={t.campaigns} limit={20} moreNoun="campaigns" dense emptyText="No campaign touched a customer or lead in this period." />
      </Section>
    </View>
  );
}

export const conversionFunnel = defineReportKind<ConversionFunnelData>({
  meta: REPORT_CATALOG["conversion-funnel"],
  load: loadConversionFunnel,
  Body,
});
