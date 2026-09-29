import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { HBarChart } from "../pdf/charts";
import { Callout, KpiTile, Section, Stat, Table, type Column } from "../pdf/components";
import { credit, num, pct, safeText } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { channels, overview, performance, type Overview, type PerfRow } from "../reports";
import { timeToConvert, type LagStats } from "../reports-analysis";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelChannel, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

// Lead source quality: cost per lead is only half the story. Next to it we print how many of a
// source's leads became customers (close rate) and how much revenue each lead brought.

export type LeadSourceRow = { key: string; name: string; platform: string | null; spendMinor: number | null; leads: number; customers: number; revenueMinor: number; cplMinor: number | null; closeRate: number | null; revenuePerLeadMinor: number | null };
export type LeadQualityData = {
  overview: Overview;
  closeRate: number | null;
  revenuePerLeadMinor: number | null;
  channels: LeadSourceRow[];
  campaigns: LeadSourceRow[];
  /** Campaigns with below-median cost per lead but under half the overall close rate. */
  cheapButCold: LeadSourceRow[];
  leadToPayment: LagStats;
};

/** Leads with at least this many (credited) leads are ranked; fewer are too noisy to judge. */
export const MIN_LEADS_TO_RANK = 3;

const closeRate = (customers: number, leads: number) => (leads > 0 ? customers / leads : null);
const perLead = (revenue: number, leads: number) => (leads > 0 ? Math.round(revenue / leads) : null);

export function campaignSource(r: PerfRow): LeadSourceRow {
  return { key: r.id, name: r.name, platform: r.platform, spendMinor: r.spendMinor, leads: r.leads, customers: r.customers, revenueMinor: r.revenueMinor, cplMinor: r.cplMinor, closeRate: closeRate(r.customers, r.leads), revenuePerLeadMinor: perLead(r.revenueMinor, r.leads) };
}

/** Below-median CPL and under half the overall close rate: leads that look cheap but rarely buy. */
export function cheapButCold(rows: LeadSourceRow[], overall: number | null): LeadSourceRow[] {
  const ranked = rows.filter((r) => r.leads >= MIN_LEADS_TO_RANK && r.cplMinor !== null);
  if (ranked.length < 3 || overall === null || overall <= 0) return [];
  const cpls = ranked.map((r) => r.cplMinor!).sort((a, b) => a - b);
  const median = cpls[Math.floor((cpls.length - 1) / 2)];
  return ranked.filter((r) => r.cplMinor! <= median && (r.closeRate ?? 0) < overall / 2).sort((a, b) => b.leads - a.leads);
}

export async function loadLeadQuality(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<LeadQualityData>> {
  const p = { start: req.start, end: req.end, model: req.model };
  const [o, chan, camps, lag] = await Promise.all([overview(db, ws, p), channels(db, ws, p), performance(db, ws, { ...p, level: "campaign" }), timeToConvert(db, ws, p)]);
  const overall = closeRate(o.customers, o.leads);
  const campaigns = camps
    .filter((r) => r.leads > 0)
    .map(campaignSource)
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  return {
    overview: o,
    closeRate: overall,
    revenuePerLeadMinor: perLead(o.revenueMinor, o.leads),
    channels: chan
      .filter((c) => c.leads > 0 || c.customers > 0)
      .map((c) => ({ key: c.channel, name: labelChannel(c.channel), platform: null, spendMinor: null, leads: c.leads, customers: c.customers, revenueMinor: c.revenueMinor, cplMinor: null, closeRate: closeRate(c.customers, c.leads), revenuePerLeadMinor: perLead(c.revenueMinor, c.leads) }))
      .sort((a, b) => b.leads - a.leads),
    campaigns,
    cheapButCold: cheapButCold(campaigns, overall),
    leadToPayment: lag.leadToPayment,
    methodology: await loadMethodology(db, ws, req, o),
  };
}

const days = (v: number | null) => (v === null ? "—" : `${num(v, v < 10 ? 1 : 0)} ${v === 1 ? "day" : "days"}`);

function Body({ data }: { data: ReportData<LeadQualityData> }) {
  const W = CONTENT_WIDTH.portrait;
  const o = data.overview;
  const m = money(o.currency);
  const tileW = (W - 16) / 3;
  const ranked = data.campaigns.filter((r) => r.leads >= MIN_LEADS_TO_RANK).slice(0, 12);

  const channelCols: Column<LeadSourceRow>[] = [
    { header: "Channel", flex: 1.8, cell: (r) => r.name },
    { header: "Leads", flex: 0.8, align: "right", cell: (r) => credit(r.leads) },
    { header: "Customers", flex: 0.9, align: "right", cell: (r) => credit(r.customers) },
    { header: "Close rate", flex: 0.9, align: "right", cell: (r) => pct(r.closeRate) },
    { header: "Revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "Revenue per lead", flex: 1.1, align: "right", cell: (r) => m.whole(r.revenuePerLeadMinor) },
  ];
  const campaignCols: Column<LeadSourceRow>[] = [
    { header: "Campaign", flex: 2.6, cell: (r) => r.name, sub: (r) => labelPlatform(r.platform) },
    { header: "Leads", flex: 0.7, align: "right", cell: (r) => credit(r.leads) },
    { header: "Cost per lead", flex: 1, align: "right", cell: (r) => m.whole(r.cplMinor) },
    { header: "Customers", flex: 0.85, align: "right", cell: (r) => credit(r.customers) },
    { header: "Close rate", flex: 0.85, align: "right", cell: (r) => pct(r.closeRate) },
    { header: "Revenue per lead", flex: 1.05, align: "right", cell: (r) => m.whole(r.revenuePerLeadMinor) },
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <KpiTile width={tileW} label="Leads" value={credit(o.leads)} cur={o.leads} polarity="up" />
        <KpiTile width={tileW} label="Cost per lead (ads)" value={m.whole(o.cplMinor)} cur={o.cplMinor} polarity="down" />
        <KpiTile width={tileW} label="Lead to customer rate" value={pct(data.closeRate)} cur={data.closeRate} polarity="up" />
        <KpiTile width={tileW} label="Customers" value={credit(o.customers)} cur={o.customers} polarity="up" />
        <KpiTile width={tileW} label="Cost per customer (ads)" value={m.whole(o.cacMinor)} cur={o.cacMinor} polarity="down" />
        <KpiTile width={tileW} label="Revenue per lead" value={m.whole(data.revenuePerLeadMinor)} cur={data.revenuePerLeadMinor} polarity="up" />
      </View>

      <Section title="Quality by channel" aside="Credited leads and customers">
        <Table columns={channelCols} rows={data.channels} limit={12} moreNoun="channels" dense emptyText="No leads were recorded in this period." />
      </Section>

      {ranked.length ? (
        <Section title="Close rate by campaign" aside={`Campaigns with at least ${MIN_LEADS_TO_RANK} leads · overall ${pct(data.closeRate)}`}>
          <HBarChart
            width={W}
            rows={ranked.map((r) => ({ label: r.name, value: r.closeRate ?? 0, color: data.closeRate !== null && (r.closeRate ?? 0) >= data.closeRate ? C.revenue : C.spend }))}
            format={(v) => pct(v)}
            labelWidth={190}
            reference={data.closeRate !== null ? { value: data.closeRate, label: "overall" } : undefined}
          />
        </Section>
      ) : null}

      <View style={{ marginTop: 14 }}>
        {data.cheapButCold.length ? (
          <Callout tone="warning" title={`Cheap leads that rarely buy: ${data.cheapButCold.length === 1 ? "1 campaign" : `${data.cheapButCold.length} campaigns`}`}>
            <Text style={{ fontSize: TYPE.caption, color: C.fg, lineHeight: 1.45 }}>
              {data.cheapButCold
                .slice(0, 4)
                .map((r) => `${safeText(r.name, 48)}: ${m.whole(r.cplMinor)} per lead, ${pct(r.closeRate)} close`)
                .join(" · ")}
              {`. Their cost per lead is at or below the median, but fewer than half as many of their leads buy as overall (${pct(data.closeRate)}). Judge them on cost per customer, not cost per lead.`}
            </Text>
          </Callout>
        ) : (
          <Callout tone="neutral" title="No cheap-but-cold sources">
            No campaign combines a below-median cost per lead with under half the overall close rate.
          </Callout>
        )}
      </View>

      <Section title="Campaigns by lead volume" breakBefore={ranked.length > 8}>
        <Table columns={campaignCols} rows={data.campaigns} limit={25} moreNoun="campaigns" emptyText="No campaign was credited with a lead in this period." />
      </Section>

      <Section title="Lead to payment timing" aside="Contacts whose first payment fell in this period">
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.6, borderColor: C.border, borderRadius: 6 }} wrap={false}>
          <Stat label="Customers who were leads first" value={num(data.leadToPayment.conversions)} />
          <Stat label="Median lead to payment" value={days(data.leadToPayment.medianDays)} />
          <Stat label="80% paid within" value={days(data.leadToPayment.p80Days)} />
          <Stat label="Inside attribution window" value={pct(data.leadToPayment.withinWindowShare, 0)} />
        </View>
      </Section>
    </View>
  );
}

export const leadQuality = defineReportKind<LeadQualityData>({
  meta: REPORT_CATALOG["lead-quality"],
  load: loadLeadQuality,
  Body,
});
