import { Text, View } from "@react-pdf/renderer";
import type { DB } from "../db";
import { BarChart, Donut, HBarChart } from "../pdf/charts";
import { Callout, Dot, Legend, Section, Stat, Table, type Column } from "../pdf/components";
import { change, credit, dateRange, pct, ratioX, safeText, shortDate, signedPct } from "../pdf/format";
import { CATEGORICAL, PDF_COLORS as C, TYPE } from "../pdf/theme";
import { channels, overview, platforms, timeseries, type ChannelRow, type Overview, type PlatformRow } from "../reports";
import type { Workspace } from "../settings";
import { REPORT_CATALOG } from "./catalog";
import { compareRange, loadMethodology } from "./methodology";
import { CONTENT_WIDTH, labelChannel, labelPlatform, money } from "./shared";
import { defineReportKind, type ReportData, type ReportRequest } from "./types";

// Channel mix and efficiency: where the budget goes and what each platform and channel returns.
// Shares are computed here from the platforms() rows (each row's spend ÷ the rows' total), so
// they always add up to what the table prints.

export type MixRow = PlatformRow & { spendShare: number | null; revenueShare: number | null; prevRoas: number | null };
export type ChannelMixRow = ChannelRow & { share: number | null; prevRevenueMinor: number | null };
export type ChannelMixData = {
  current: Overview;
  previous: Overview | null;
  platforms: MixRow[];
  channels: ChannelMixRow[];
  /** Daily spend for the largest platforms (at most four), same order as `platforms`. */
  daily: { dates: string[]; series: { platform: string; values: number[] }[] };
};

const share = (v: number, total: number) => (total > 0 ? v / total : null);

export async function loadChannelMix(db: DB, ws: Workspace, req: ReportRequest): Promise<ReportData<ChannelMixData>> {
  const p = { start: req.start, end: req.end, model: req.model };
  const cmp = compareRange(req);
  const [current, previous, plat, prevPlat, chan, prevChan] = await Promise.all([
    overview(db, ws, p),
    cmp ? overview(db, ws, { ...p, ...cmp }) : Promise.resolve(null),
    platforms(db, ws, p),
    cmp ? platforms(db, ws, { ...p, ...cmp }) : Promise.resolve([] as PlatformRow[]),
    channels(db, ws, p),
    cmp ? channels(db, ws, { ...p, ...cmp }) : Promise.resolve([] as ChannelRow[]),
  ]);
  const spendTotal = plat.reduce((s, r) => s + r.spendMinor, 0);
  const revTotal = plat.reduce((s, r) => s + Math.max(0, r.revenueMinor), 0);
  const prevRoas = new Map(prevPlat.map((r) => [r.platform, r.roas]));
  const rows: MixRow[] = plat.map((r) => ({ ...r, spendShare: share(r.spendMinor, spendTotal), revenueShare: share(Math.max(0, r.revenueMinor), revTotal), prevRoas: cmp ? (prevRoas.get(r.platform) ?? null) : null }));
  const chanTotal = chan.reduce((s, c) => s + Math.max(0, c.revenueMinor), 0);
  const prevChanRev = new Map(prevChan.map((c) => [c.channel, c.revenueMinor]));
  const chanRows: ChannelMixRow[] = chan.map((c) => ({ ...c, share: share(Math.max(0, c.revenueMinor), chanTotal), prevRevenueMinor: cmp ? (prevChanRev.get(c.channel) ?? 0) : null }));

  const top = rows.filter((r) => r.spendMinor > 0).slice(0, 4);
  const perPlatform = await Promise.all(top.map((r) => timeseries(db, ws, { ...p, platform: r.platform })));
  const dates = perPlatform[0]?.map((d) => d.date) ?? [];
  return {
    current,
    previous,
    platforms: rows,
    channels: chanRows,
    daily: { dates, series: top.map((r, i) => ({ platform: r.platform, values: perPlatform[i].map((d) => d.spendMinor) })) },
    methodology: await loadMethodology(db, ws, req, current),
  };
}

function ShareBars({ spend, revenue }: { spend: number | null; revenue: number | null }) {
  const bar = (v: number | null, color: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <View style={{ flex: 1, height: 4.5, backgroundColor: C.fill, borderRadius: 1 }}>
        <View style={{ width: `${Math.round(Math.min(1, Math.max(0, v ?? 0)) * 1000) / 10}%`, height: 4.5, backgroundColor: color, borderRadius: 1 }} />
      </View>
      <Text style={{ width: 30, fontSize: TYPE.micro + 0.5, color: C.fgMuted, textAlign: "right" }}>{pct(v, 0)}</Text>
    </View>
  );
  return (
    <View style={{ gap: 2.5 }}>
      {bar(spend, C.spend)}
      {bar(revenue, C.revenue)}
    </View>
  );
}

/** One plain sentence about the mix (words chosen by rule, every figure printed from the data). */
export function mixVerdict(rows: MixRow[], blended: number | null): { tone: "positive" | "warning" | "neutral"; title: string; text: string } | null {
  const real = rows.filter((r) => (r.spendShare ?? 0) >= 0.1 && r.roas !== null);
  if (real.length < 2 || blended === null) return null;
  const best = [...real].sort((a, b) => (b.roas ?? 0) - (a.roas ?? 0))[0];
  const worst = [...real].sort((a, b) => (a.roas ?? 0) - (b.roas ?? 0))[0];
  if (best.platform === worst.platform) return null;
  const under = (worst.revenueShare ?? 0) < (worst.spendShare ?? 0);
  return {
    tone: under ? "warning" : "neutral",
    title: `${labelPlatform(best.platform)} returns ${ratioX(best.roas)}, ${labelPlatform(worst.platform)} ${ratioX(worst.roas)}`,
    text: `${labelPlatform(worst.platform)} takes ${pct(worst.spendShare, 0)} of spend and brings ${pct(worst.revenueShare, 0)} of ad revenue, against ${pct(best.spendShare, 0)} and ${pct(best.revenueShare, 0)} for ${labelPlatform(best.platform)}. Blended ROAS is ${ratioX(blended)}. Test moving budget in small steps and watch whether the better platform keeps its return as it scales.`,
  };
}

function Body({ data }: { data: ReportData<ChannelMixData> }) {
  const W = CONTENT_WIDTH.portrait;
  const cur = data.current;
  const m = money(cur.currency);
  const active = data.platforms.filter((r) => r.spendMinor > 0);
  const verdict = mixVerdict(data.platforms, cur.roas);
  const chanTotal = data.channels.reduce((s, c) => s + Math.max(0, c.revenueMinor), 0);
  const chanColor = (c: ChannelMixRow, i: number) => (c.channel === "unattributed" ? C.borderStrong : CATEGORICAL[i % CATEGORICAL.length]);

  const platformCols: Column<MixRow>[] = [
    { header: "Platform", flex: 1.4, cell: (r) => labelPlatform(r.platform) },
    { header: "Spend / ad revenue share", flex: 2.2, cell: (r) => <ShareBars spend={r.spendShare} revenue={r.revenueShare} /> },
    { header: "Spend", flex: 1, align: "right", cell: (r) => m.whole(r.spendMinor) },
    { header: "Ad revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "ROAS", flex: 0.7, align: "right", cell: (r) => ratioX(r.roas), sub: (r) => (data.previous ? `was ${ratioX(r.prevRoas)}` : null) },
    { header: "Customers", flex: 0.8, align: "right", cell: (r) => credit(r.customers) },
  ];
  const channelCols: Column<ChannelMixRow>[] = [
    { header: "Channel", flex: 1.6, cell: (r) => labelChannel(r.channel) },
    { header: "Revenue", flex: 1, align: "right", cell: (r) => m.whole(r.revenueMinor) },
    { header: "Share", flex: 0.7, align: "right", cell: (r) => pct(r.share, 0) },
    ...(data.previous ? [{ header: "vs previous", flex: 0.9, align: "right" as const, cell: (r: ChannelMixRow) => signedPct(change(r.revenueMinor, r.prevRevenueMinor)) }] : []),
    { header: "Leads", flex: 0.7, align: "right", cell: (r) => credit(r.leads) },
    { header: "Customers", flex: 0.8, align: "right", cell: (r) => credit(r.customers) },
  ];

  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 10, paddingHorizontal: 12, borderWidth: 0.6, borderColor: C.border, borderRadius: 6 }}>
        <Stat label="Ad spend" value={m.whole(cur.spendMinor)} />
        <Stat label="Revenue credited to ads" value={m.whole(cur.attributedRevenueMinor)} tone={C.positive} />
        <Stat label="Blended ROAS" value={ratioX(cur.roas)} />
        <Stat label="Platforms with spend" value={String(active.length)} />
        <Stat label="Channels with revenue" value={String(data.channels.filter((c) => c.revenueMinor > 0).length)} />
      </View>

      <Section title="Spend share vs revenue share" aside="Ad platforms, sorted by spend">
        <View style={{ marginBottom: 6 }}>
          <Legend items={[{ label: "Share of ad spend", color: C.spend, box: true }, { label: "Share of revenue credited to ads", color: C.revenue, box: true }]} />
        </View>
        <Table columns={platformCols} rows={data.platforms} limit={12} moreNoun="platforms" emptyText="No ad platform had spend or credited revenue in this period." />
      </Section>

      {verdict ? (
        <View style={{ marginTop: 12 }}>
          <Callout tone={verdict.tone} title={verdict.title}>
            {verdict.text}
          </Callout>
        </View>
      ) : null}

      {active.length ? (
        <Section title="ROAS by platform" aside={`Dashed line: blended ${ratioX(cur.roas)}`}>
          <HBarChart
            width={W}
            rows={active.map((r) => ({ label: labelPlatform(r.platform), value: r.roas ?? 0, color: r.roas !== null && cur.roas !== null && r.roas >= cur.roas ? C.revenue : C.spend }))}
            format={(v) => ratioX(v)}
            labelWidth={120}
            reference={cur.roas !== null ? { value: cur.roas, label: "blend" } : undefined}
          />
        </Section>
      ) : null}

      {data.daily.series.length && data.daily.dates.length > 1 ? (
        <Section title="Daily spend by platform" aside={dateRange(cur.start, cur.end)} breakBefore={data.platforms.length > 5}>
          <View style={{ marginBottom: 6 }}>
            <Legend items={data.daily.series.map((s, i) => ({ label: labelPlatform(s.platform), color: CATEGORICAL[i % CATEGORICAL.length], box: true }))} />
          </View>
          <BarChart
            width={W}
            height={130}
            categories={data.daily.dates.map((d) => shortDate(d))}
            series={data.daily.series.map((s, i) => ({ name: labelPlatform(s.platform), values: s.values, color: CATEGORICAL[i % CATEGORICAL.length] }))}
            mode="stacked"
            yFormat={(v) => m.short(v)}
          />
        </Section>
      ) : null}

      <Section title="Revenue by channel" aside="All revenue, including sales with no ad touch">
        {data.channels.length ? (
          <View style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }} wrap={false}>
            <View style={{ width: 120, alignItems: "center", gap: 8 }}>
              <Donut size={104} slices={data.channels.map((c, i) => ({ value: Math.max(0, c.revenueMinor), color: chanColor(c, i) }))} centerValue={m.short(chanTotal)} centerLabel="revenue" />
              <View style={{ gap: 3, alignSelf: "stretch" }}>
                {data.channels.slice(0, 6).map((c, i) => (
                  <View key={c.channel} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Dot color={chanColor(c, i)} />
                    <Text style={{ fontSize: TYPE.micro + 0.5, color: C.fgMuted }}>{safeText(labelChannel(c.channel), 24)}</Text>
                  </View>
                ))}
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Table columns={channelCols} rows={data.channels} limit={12} moreNoun="channels" dense />
            </View>
          </View>
        ) : (
          <Text style={{ fontSize: TYPE.ui, color: C.fgMuted }}>No revenue, leads or customers were recorded in this period.</Text>
        )}
      </Section>
    </View>
  );
}

export const channelMix = defineReportKind<ChannelMixData>({
  meta: REPORT_CATALOG["channel-mix"],
  load: loadChannelMix,
  Body,
});
