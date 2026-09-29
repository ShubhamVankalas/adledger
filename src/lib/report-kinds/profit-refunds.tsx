import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { HBarChart, Waterfall, type WaterfallStep } from "../pdf/charts";
import { Callout, KpiTile, Section, Table, type Column } from "../pdf/components";
import { credit, pct, ratioX } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { getUnitEconomics, profitLedger, profitRows, type ProfitLedger, type ProfitRow } from "../reports-profit";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { compareRange, loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

// Profit and refunds: the whole-business P&L (every payment and refund, all ad spend) from
// reports-profit.ts, then per campaign what its customers were worth after costs and refunds.

export type ProfitRefundsData = {
  ledger: ProfitLedger;
  previous: ProfitLedger | null;
  /** Campaigns by profit after ads (spend or credited revenue in the period). */
  campaigns: ProfitRow[];
  /** Campaigns whose credited customers refunded, largest refunds first. */
  refunds: ProfitRow[];
};

export async function loadProfitRefunds(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<ProfitRefundsData>> {
  const ue = await getUnitEconomics(db, ws.id);
  const cmp = compareRange(req);
  const range = { start: req.start, end: req.end };
  const [ledger, previous, rows] = await Promise.all([
    profitLedger(db, ws, range, ue),
    cmp ? profitLedger(db, ws, cmp, ue) : Promise.resolve(null),
    profitRows(db, ws, { ...range, model: req.model }, "campaign", ue),
  ]);
  return {
    ledger,
    previous,
    campaigns: [...rows].sort((a, b) => b.profitAfterAdsMinor - a.profitAfterAdsMinor || a.name.localeCompare(b.name)),
    refunds: rows.filter((r) => r.refundsMinor < 0).sort((a, b) => a.refundsMinor - b.refundsMinor),
    methodology: await loadMethodology(db, ws, req),
  };
}

/** Gross sales → refunds → costs → ad spend → profit after ads. Cost steps are left out when zero. */
export function profitSteps(l: ProfitLedger): WaterfallStep[] {
  const steps: WaterfallStep[] = [
    { label: "Gross sales", value: l.grossSalesMinor, kind: "total" },
    { label: "Refunds", value: l.refundsMinor, kind: "delta" },
  ];
  if (l.cogsMinor) steps.push({ label: "Cost of goods", value: -l.cogsMinor, kind: "delta" });
  if (l.feesMinor) steps.push({ label: "Payment fees", value: -l.feesMinor, kind: "delta" });
  if (l.shippingMinor) steps.push({ label: "Shipping", value: -l.shippingMinor, kind: "delta" });
  steps.push({ label: "Ad spend", value: -l.spendMinor, kind: "delta" });
  steps.push({ label: "Profit after ads", value: l.profitAfterAdsMinor, kind: "total" });
  return steps;
}

function Body({ data }: { data: ReportData<ProfitRefundsData> }) {
  const W = CONTENT_WIDTH.portrait;
  const l = data.ledger;
  const p = data.previous;
  const m = money(l.currency);
  const tileW = (W - 16) / 3;
  const configured = l.unitEconomics.configured;
  const refundShare = l.grossSalesMinor > 0 ? Math.abs(l.refundsMinor) / l.grossSalesMinor : null;
  const prevRefundShare = p && p.grossSalesMinor > 0 ? Math.abs(p.refundsMinor) / p.grossSalesMinor : null;
  const withSpend = data.campaigns.filter((c) => c.spendMinor > 0);
  const chart = [...withSpend.slice(0, 5), ...withSpend.slice(5).slice(-3)];

  const campaignCols: Column<ProfitRow>[] = [
    { header: "Campaign", flex: 2.4, cell: (r) => r.name, sub: (r) => labelPlatform(r.platform) },
    { header: "Spend", flex: 0.9, align: "right", cell: (r) => m.whole(r.spendMinor) },
    { header: "Net revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    ...(configured ? [{ header: "Contribution", flex: 1, align: "right" as const, cell: (r: ProfitRow) => m.whole(r.contributionMinor) }] : []),
    { header: "Profit after ads", flex: 1.05, align: "right", cell: (r) => m.whole(r.profitAfterAdsMinor) },
    { header: configured ? "POAS" : "ROAS", flex: 0.7, align: "right", cell: (r) => ratioX(configured ? r.poas : r.roas) },
  ];
  const refundCols: Column<ProfitRow>[] = [
    { header: "Campaign", flex: 2.4, cell: (r) => r.name, sub: (r) => labelPlatform(r.platform) },
    { header: "Gross", flex: 1, align: "right", cell: (r) => m.whole(r.grossMinor) },
    { header: "Refunds", flex: 1, align: "right", cell: (r) => m.whole(r.refundsMinor) },
    { header: "Refund rate", flex: 0.9, align: "right", cell: (r) => pct(r.refundRate) },
    { header: "Refunding customers", flex: 1.1, align: "right", cell: (r) => pct(r.refunderRate) },
    { header: "Repeat buyers", flex: 0.9, align: "right", cell: (r) => pct(r.repeatRate) },
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <KpiTile width={tileW} label="Net revenue" value={m.whole(l.netRevenueMinor)} cur={l.netRevenueMinor} prev={p ? p.netRevenueMinor : undefined} prevLabel={p ? m.short(p.netRevenueMinor) : undefined} polarity="up" />
        <KpiTile width={tileW} label="Refunds" value={m.whole(l.refundsMinor)} cur={Math.abs(l.refundsMinor)} prev={p ? Math.abs(p.refundsMinor) : undefined} prevLabel={p ? m.short(p.refundsMinor) : undefined} polarity="down" />
        <KpiTile width={tileW} label="Refunded share of sales" value={pct(refundShare)} cur={refundShare} prev={p ? prevRefundShare : undefined} prevLabel={p ? pct(prevRefundShare) : undefined} polarity="down" />
        <KpiTile width={tileW} label={configured ? "Contribution" : "Revenue after refunds"} value={m.whole(l.contributionMinor)} cur={l.contributionMinor} prev={p ? p.contributionMinor : undefined} prevLabel={p ? m.short(p.contributionMinor) : undefined} polarity="up" />
        <KpiTile width={tileW} label="Profit after ads" value={m.whole(l.profitAfterAdsMinor)} cur={l.profitAfterAdsMinor} prev={p ? p.profitAfterAdsMinor : undefined} prevLabel={p ? m.short(p.profitAfterAdsMinor) : undefined} polarity="up" />
        <KpiTile width={tileW} label={configured ? "POAS" : "MER"} value={ratioX(configured ? l.poas : l.mer)} cur={configured ? l.poas : l.mer} prev={p ? (configured ? p.poas : p.mer) : undefined} prevLabel={p ? ratioX(configured ? p.poas : p.mer) : undefined} polarity="up" />
      </View>

      <Section title="Gross sales to profit" aside={`${credit(l.orders)} orders`}>
        <Waterfall width={W} height={150} steps={profitSteps(l)} yFormat={(v) => m.short(v)} />
      </Section>

      <View style={{ marginTop: 12 }}>
        {configured ? (
          <Callout tone={l.profitAfterAdsMinor >= 0 ? "positive" : "negative"} title={l.profitAfterAdsMinor >= 0 ? `Ads paid for themselves: ${ratioX(l.poas)} POAS` : `Ads cost more than they earned after costs: ${ratioX(l.poas)} POAS`}>
            {`POAS is contribution (net revenue minus cost of goods, fees and shipping) divided by ad spend. At your margin, break-even ROAS is ${ratioX(l.breakEvenRoas)}.`}
          </Callout>
        ) : (
          <Callout tone="neutral" title="Costs aren't set up yet">
            Add your gross margin, payment fees and shipping on the Profit page to see contribution and POAS. Until then, profit after ads is net revenue minus ad spend.
          </Callout>
        )}
      </View>

      <Section title="Profit by campaign" aside="Credited net revenue after refunds" breakBefore>
        {chart.length ? (
          <View style={{ marginBottom: 10 }}>
            <HBarChart width={W} rows={chart.map((r) => ({ label: r.name, value: r.profitAfterAdsMinor, color: r.profitAfterAdsMinor >= 0 ? C.positive : C.negative }))} format={(v) => m.whole(v)} labelWidth={200} />
          </View>
        ) : null}
        <Table columns={campaignCols} rows={data.campaigns} limit={20} moreNoun="campaigns" dense emptyText="No campaign had spend or credited revenue in this period." />
      </Section>

      <Section title="Refunds by campaign" aside={`${m.whole(l.refundsMinor)} refunded in total`}>
        <Table columns={refundCols} rows={data.refunds} limit={15} moreNoun="campaigns" dense emptyText="No refunds were credited to a campaign in this period." />
        <Text style={{ fontSize: TYPE.caption, color: C.fgMuted, marginTop: 6, lineHeight: 1.45 }}>
          Refunding customers and repeat buyers are shares of the customers each campaign brought in during the period, counted over their whole history to date.
        </Text>
      </Section>
    </View>
  );
}

export const profitRefunds = defineReportKind<ProfitRefundsData>({
  meta: REPORT_CATALOG["profit-refunds"],
  load: loadProfitRefunds,
  Body,
});
