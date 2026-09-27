import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { ComboChart, Donut } from "../pdf/charts";
import { Bullets, Callout, Dot, KpiTile, Legend, Section, Table, type Column } from "../pdf/components";
import { credit, dateRange, moneyDelta, pct, ratioX, safeText, shortDate } from "../pdf/format";
import { CATEGORICAL, PDF_COLORS as C, TYPE } from "../pdf/theme";
import { channels, compare, overview, performance, platforms, timeseries, wastedSpend, type ChannelRow, type Overview, type PerfRow, type PlatformRow, type SeriesPoint } from "../reports";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { compareRange, loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelChannel, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

type Mover = Awaited<ReturnType<typeof compare>>["movers"][number];

export type WeeklyPerformanceData = {
  current: Overview;
  previous: Overview | null;
  series: SeriesPoint[];
  previousSeries: SeriesPoint[] | null;
  channels: ChannelRow[];
  platforms: PlatformRow[];
  campaigns: PerfRow[];
  /** Biggest revenue changes vs the comparison period (top 5). */
  movers: Mover[];
  waste: PerfRow[];
};

export async function loadWeeklyPerformance(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<WeeklyPerformanceData>> {
  const p = { start: req.start, end: req.end, model: req.model };
  const cmp = compareRange(req);
  const [current, series, chans, plats, campaigns, waste, cmpData, previousSeries] = await Promise.all([
    overview(db, ws, p),
    timeseries(db, ws, p),
    channels(db, ws, p),
    platforms(db, ws, p),
    performance(db, ws, { ...p, level: "campaign" }),
    wastedSpend(db, ws, { ...p, level: "campaign" }),
    cmp ? compare(db, ws, p) : Promise.resolve(null),
    cmp ? timeseries(db, ws, { ...p, ...cmp }) : Promise.resolve(null),
  ]);
  return {
    current,
    previous: cmpData?.previous ?? null,
    series,
    previousSeries,
    channels: chans,
    platforms: plats,
    campaigns,
    movers: (cmpData?.movers ?? []).filter((m) => m.revenueMinor !== m.prevRevenueMinor).slice(0, 5),
    waste,
    methodology: await loadMethodology(db, ws, req, current),
  };
}

function Body({ data }: { data: ReportData<WeeklyPerformanceData> }) {
  const W = CONTENT_WIDTH.portrait;
  const cur = data.current;
  const prev = data.previous;
  const m = money(cur.currency);
  const tileW = (W - 24) / 4;
  const rev = data.series.map((d) => d.revenueMinor);
  const spend = data.series.map((d) => d.spendMinor);
  const pRev = data.previousSeries?.map((d) => d.revenueMinor);

  const kpis: { label: string; value: string; cur: number | null; prev: number | null | undefined; prevLabel?: string; polarity: "up" | "down" | "neutral" }[] = [
    { label: "Ad spend", value: m.whole(cur.spendMinor), cur: cur.spendMinor, prev: prev?.spendMinor, prevLabel: prev ? m.short(prev.spendMinor) : undefined, polarity: "neutral" },
    { label: "Revenue", value: m.whole(cur.revenueMinor), cur: cur.revenueMinor, prev: prev?.revenueMinor, prevLabel: prev ? m.short(prev.revenueMinor) : undefined, polarity: "up" },
    { label: "ROAS", value: ratioX(cur.roas), cur: cur.roas, prev: prev?.roas, prevLabel: prev ? ratioX(prev.roas) : undefined, polarity: "up" },
    { label: "Blended ROAS", value: ratioX(cur.blendedRoas), cur: cur.blendedRoas, prev: prev?.blendedRoas, prevLabel: prev ? ratioX(prev.blendedRoas) : undefined, polarity: "up" },
    { label: "Leads", value: credit(cur.leads), cur: cur.leads, prev: prev?.leads, prevLabel: prev ? credit(prev.leads) : undefined, polarity: "up" },
    { label: "Customers", value: credit(cur.customers), cur: cur.customers, prev: prev?.customers, prevLabel: prev ? credit(prev.customers) : undefined, polarity: "up" },
    { label: "Cost per lead", value: m.whole(cur.cplMinor), cur: cur.cplMinor, prev: prev?.cplMinor, prevLabel: prev ? m.short(prev.cplMinor) : undefined, polarity: "down" },
    { label: "Cost per customer", value: m.whole(cur.cacMinor), cur: cur.cacMinor, prev: prev?.cacMinor, prevLabel: prev ? m.short(prev.cacMinor) : undefined, polarity: "down" },
  ];

  const moverLines = data.movers.map((mv) => {
    const d = mv.revenueMinor - mv.prevRevenueMinor;
    return `${safeText(mv.name, 60)} (${labelPlatform(mv.platform)}): revenue ${moneyDelta(d, cur.currency)} to ${m.whole(mv.revenueMinor)}, spend ${m.whole(mv.spendMinor)}${mv.prevSpendMinor ? ` (was ${m.short(mv.prevSpendMinor)})` : ""}, ROAS ${ratioX(mv.roas)}.`;
  });
  const wasted = data.waste.reduce((s, r) => s + r.spendMinor, 0);

  const chanTotal = data.channels.reduce((s, c) => s + Math.max(0, c.revenueMinor), 0);
  const chanRows = data.channels.filter((c) => c.revenueMinor > 0).slice(0, 7);

  const platformCols: Column<PlatformRow>[] = [
    { header: "Platform", flex: 1.6, cell: (r) => labelPlatform(r.platform) },
    { header: "Spend", flex: 1, align: "right", cell: (r) => m.whole(r.spendMinor) },
    { header: "Revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "ROAS", flex: 0.8, align: "right", cell: (r) => ratioX(r.roas) },
    { header: "Leads", flex: 0.8, align: "right", cell: (r) => credit(r.leads) },
    { header: "Customers", flex: 0.9, align: "right", cell: (r) => credit(r.customers) },
  ];
  const campaignCols: Column<PerfRow>[] = [
    { header: "Campaign", flex: 3, cell: (r) => r.name, sub: (r) => [labelPlatform(r.platform), r.status ? r.status.toLowerCase() : null].filter(Boolean).join(" · ") },
    { header: "Spend", flex: 1, align: "right", cell: (r) => m.whole(r.spendMinor) },
    { header: "Revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "ROAS", flex: 0.75, align: "right", cell: (r) => ratioX(r.roas) },
    { header: "Leads", flex: 0.7, align: "right", cell: (r) => credit(r.leads) },
    { header: "Customers", flex: 0.85, align: "right", cell: (r) => credit(r.customers) },
    { header: "Cost per customer", flex: 1.1, align: "right", cell: (r) => m.whole(r.cacMinor) },
  ];

  return (
    <View>
      <Section title={prev ? "At a glance, vs previous period" : "At a glance"}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {kpis.map((k) => (
            <KpiTile key={k.label} width={tileW} label={k.label} value={k.value} cur={k.cur} prev={prev ? (k.prev ?? null) : undefined} prevLabel={k.prevLabel} polarity={k.polarity} />
          ))}
        </View>
      </Section>

      <Section title="Spend and revenue by day" aside={dateRange(cur.start, cur.end)}>
        <View style={{ marginBottom: 6 }}>
          <Legend items={[{ label: "Ad spend", color: C.spend, box: true }, { label: "Revenue", color: C.revenue }, ...(pRev ? [{ label: "Revenue, previous period", color: C.fgFaint, dashed: true }] : [])]} />
        </View>
        <ComboChart
          width={W}
          height={150}
          labels={data.series.map((d) => shortDate(d.date))}
          bars={{ values: spend, color: C.spend }}
          line={{ values: rev, color: C.revenue }}
          compare={pRev ? { values: pRev.slice(0, rev.length), color: C.fgMuted } : undefined}
          yFormat={(v) => m.short(v)}
        />
      </Section>

      <View style={{ flexDirection: "row", gap: 16 }}>
        <View style={{ flex: 1.25 }}>
          <Section title="What changed">
            {moverLines.length ? <Bullets items={moverLines} size={TYPE.ui} /> : <Text style={{ fontSize: TYPE.ui, color: C.fgMuted }}>No campaign’s revenue moved against the comparison period.</Text>}
            <View style={{ marginTop: 10 }}>
              {data.waste.length ? (
                <Callout tone="warning" title={`${m.whole(wasted)} went to campaigns returning under 0.5×`}>
                  <Text style={{ fontSize: TYPE.caption, color: C.fg, lineHeight: 1.45 }}>
                    {data.waste
                      .slice(0, 4)
                      .map((w) => `${safeText(w.name, 48)} ${m.whole(w.spendMinor)}`)
                      .join(" · ")}
                    {data.waste.length > 4 ? ` · and ${data.waste.length - 4} more` : ""}
                  </Text>
                </Callout>
              ) : (
                <Callout tone="positive" title="No wasted spend flagged">
                  Every campaign with at least 2% of spend returned 0.5× or better.
                </Callout>
              )}
            </View>
          </Section>
        </View>
        <View style={{ flex: 1 }}>
          <Section title="Revenue by channel">
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Donut size={92} slices={chanRows.map((c, i) => ({ value: c.revenueMinor, color: c.channel === "unattributed" ? C.borderStrong : CATEGORICAL[i % CATEGORICAL.length] }))} centerValue={m.short(chanTotal)} centerLabel="revenue" />
              <View style={{ flex: 1, gap: 4 }}>
                {chanRows.map((c, i) => (
                  <View key={c.channel} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Dot color={c.channel === "unattributed" ? C.borderStrong : CATEGORICAL[i % CATEGORICAL.length]} />
                    <Text style={{ fontSize: TYPE.caption, color: C.fg, flex: 1 }}>{labelChannel(c.channel)}</Text>
                    <Text style={{ fontSize: TYPE.caption, color: C.fgMuted }}>{chanTotal > 0 ? pct(Math.max(0, c.revenueMinor) / chanTotal, 0) : "—"}</Text>
                  </View>
                ))}
              </View>
            </View>
          </Section>
        </View>
      </View>

      <Section title="Platforms" breakBefore style={{ marginTop: 0 }}>
        <Table columns={platformCols} rows={data.platforms} limit={12} moreNoun="platforms" dense emptyText="No ad platform had spend or attributed results." />
      </Section>

      <Section title="Campaigns" aside="Sorted by spend">
        <Table columns={campaignCols} rows={data.campaigns} limit={25} moreNoun="campaigns" />
      </Section>
    </View>
  );
}

export const weeklyPerformance = defineReportKind<WeeklyPerformanceData>({
  meta: REPORT_CATALOG["weekly-performance"],
  load: loadWeeklyPerformance,
  Body,
});
