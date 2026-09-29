import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { HBarChart } from "../pdf/charts";
import { Section, Stat, Table, type Column } from "../pdf/components";
import { credit, num, pct, ratioX } from "../pdf/format";
import { PDF_COLORS as C, TYPE } from "../pdf/theme";
import { performance, pickWastedSpend, type PerfRow } from "../reports";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

// Creative and ad leaderboard: the ad level of performance() ranked four ways. Efficiency lists
// only count ads with a meaningful share of spend (or impressions for CTR), so a lucky ad with
// $3 of spend doesn't top the board.

export type AdLeaderboardData = {
  totals: { ads: number; spendMinor: number; revenueMinor: number; top5RevenueShare: number | null };
  byRevenue: PerfRow[];
  byRoas: PerfRow[];
  byCtr: PerfRow[];
  wasted: PerfRow[];
  minSpendMinor: number;
  minImpressions: number;
};

export const MIN_IMPRESSIONS_FOR_CTR = 1000;

export function rankAds(ads: PerfRow[]): AdLeaderboardData {
  const spendMinor = ads.reduce((s, a) => s + a.spendMinor, 0);
  const revenueMinor = ads.reduce((s, a) => s + a.revenueMinor, 0);
  const minSpendMinor = Math.max(1, Math.round(spendMinor * 0.02));
  const byRevenue = ads.filter((a) => a.revenueMinor > 0).sort((a, b) => b.revenueMinor - a.revenueMinor || a.name.localeCompare(b.name));
  const top5 = byRevenue.slice(0, 5).reduce((s, a) => s + a.revenueMinor, 0);
  return {
    totals: { ads: ads.filter((a) => a.spendMinor > 0).length, spendMinor, revenueMinor, top5RevenueShare: revenueMinor > 0 ? top5 / revenueMinor : null },
    byRevenue: byRevenue.slice(0, 15),
    byRoas: ads.filter((a) => a.spendMinor >= minSpendMinor && a.roas !== null && a.roas > 0).sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0) || b.spendMinor - a.spendMinor).slice(0, 10),
    byCtr: ads.filter((a) => a.impressions >= MIN_IMPRESSIONS_FOR_CTR && a.ctr !== null).sort((a, b) => (b.ctr ?? 0) - (a.ctr ?? 0) || b.impressions - a.impressions).slice(0, 10),
    wasted: pickWastedSpend(ads, minSpendMinor).slice(0, 15),
    minSpendMinor,
    minImpressions: MIN_IMPRESSIONS_FOR_CTR,
  };
}

export async function loadAdLeaderboard(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<AdLeaderboardData>> {
  const ads = await performance(db, ws, { start: req.start, end: req.end, model: req.model, level: "ad" });
  return { ...rankAds(ads), methodology: await loadMethodology(db, ws, req) };
}

const where = (r: PerfRow) => [r.parentName, labelPlatform(r.platform)].filter(Boolean).join(" · ");

function Body({ data }: { data: ReportData<AdLeaderboardData> }) {
  const W = CONTENT_WIDTH.portrait;
  const m = money(data.methodology.currency);
  const t = data.totals;
  const rank: Column<PerfRow> = { header: "#", width: 18, cell: (_r, i) => String(i + 1) };
  const name: Column<PerfRow> = { header: "Ad", flex: 2.6, cell: (r) => r.name, sub: where };
  const cols = (extra: Column<PerfRow>[]): Column<PerfRow>[] => [rank, name, ...extra];
  const spend: Column<PerfRow> = { header: "Spend", flex: 0.9, align: "right", cell: (r) => m.whole(r.spendMinor) };
  const revenue: Column<PerfRow> = { header: "Revenue", flex: 0.9, align: "right", cell: (r) => m.whole(r.revenueMinor) };
  const roas: Column<PerfRow> = { header: "ROAS", flex: 0.65, align: "right", cell: (r) => ratioX(r.roas) };
  const ctr: Column<PerfRow> = { header: "CTR", flex: 0.65, align: "right", cell: (r) => pct(r.ctr, 2) };
  const customers: Column<PerfRow> = { header: "Customers", flex: 0.8, align: "right", cell: (r) => credit(r.customers) };
  const leads: Column<PerfRow> = { header: "Leads", flex: 0.6, align: "right", cell: (r) => credit(r.leads) };
  const clicks: Column<PerfRow> = { header: "Clicks", flex: 0.7, align: "right", cell: (r) => num(r.clicks) };

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.6, borderColor: C.border, borderRadius: 6 }}>
        <Stat label="Ads with spend" value={String(t.ads)} />
        <Stat label="Ad spend" value={m.whole(t.spendMinor)} />
        <Stat label="Revenue credited to ads" value={m.whole(t.revenueMinor)} tone={C.positive} />
        <Stat label="Top 5 ads' share of it" value={pct(t.top5RevenueShare, 0)} />
      </View>

      <Section title="Top ads by revenue">
        {data.byRevenue.length ? (
          <View style={{ marginBottom: 10 }}>
            <HBarChart width={W} rows={data.byRevenue.slice(0, 8).map((r) => ({ label: r.name, value: r.revenueMinor, color: C.revenue }))} format={(v) => m.whole(v)} labelWidth={200} />
          </View>
        ) : null}
        <Table columns={cols([spend, revenue, roas, ctr, customers])} rows={data.byRevenue} limit={15} moreNoun="ads" emptyText="No ad was credited with revenue in this period." />
      </Section>

      <Section title="Most efficient" aside={`ROAS, ads with at least ${m.whole(data.minSpendMinor)} (2% of spend)`} breakBefore>
        <Table columns={cols([spend, revenue, roas, customers])} rows={data.byRoas} limit={10} moreNoun="ads" dense emptyText="No ad with a meaningful share of spend returned revenue." />
      </Section>

      <Section title="Click-through leaders" aside={`Ads with at least ${data.minImpressions.toLocaleString("en-US")} impressions`}>
        <Table columns={cols([ctr, clicks, leads, spend, roas])} rows={data.byCtr} limit={10} moreNoun="ads" dense emptyText="No ad reached enough impressions to compare click-through rates." />
      </Section>

      <Section title="Spending without return" aside="ROAS under 0.5×, at least 2% of spend">
        <Table columns={cols([spend, revenue, roas, leads])} rows={data.wasted} limit={15} moreNoun="ads" dense emptyText="Every ad with a meaningful share of spend returned 0.5× or better." />
        {data.wasted.length ? (
          <Text style={{ fontSize: TYPE.caption, color: C.fgMuted, marginTop: 6, lineHeight: 1.45 }}>
            Check how long each ad has run before pausing it: new creatives often need a week or two before the revenue they start arrives.
          </Text>
        ) : null}
      </Section>
    </View>
  );
}

export const adLeaderboard = defineReportKind<AdLeaderboardData>({
  meta: REPORT_CATALOG["ad-leaderboard"],
  load: loadAdLeaderboard,
  Body,
});
