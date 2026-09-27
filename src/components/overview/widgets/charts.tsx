import { ChartNoAxesColumnIcon } from "lucide-react";
import { loadChannels, loadKpiPair, type DashParams } from "@/lib/dashboard/data";
import { channelLabel, countLabel, moneyShort, pct } from "@/lib/format";
import { METRIC_KEYS, type MetricKey } from "@/lib/metrics";
import type { KpiSeries } from "@/lib/reports-metrics";
import type { WidgetSettings } from "@/lib/widgets/catalog";
import { ExplorerClient, type ExplorerData } from "../explorer-client";
import { SpendRevenueCard } from "../spend-revenue-card";
import { WidgetCard, WidgetEmpty } from "../widget-card";

const byMetric = (s: KpiSeries) => Object.fromEntries(METRIC_KEYS.map((k) => [k, s.days.map((d) => d.values[k])])) as Record<MetricKey, (number | null)[]>;

/** Metric explorer: every KPI's daily series goes to the client once, so switching metric is instant. */
export async function ExplorerWidget({ p, currency, settings }: { p: DashParams; currency: string; settings?: WidgetSettings }) {
  const [cur, prev] = await loadKpiPair(p);
  const data: ExplorerData = {
    dates: cur.days.map((d) => d.date),
    prevDates: prev.days.map((d) => d.date),
    cur: byMetric(cur),
    prev: byMetric(prev),
    totals: cur.totals,
    prevTotals: prev.totals,
  };
  return <ExplorerClient data={data} currency={currency} defaultMetric={settings?.metric ?? "revenue"} title={settings?.title} />;
}

export async function SpendRevenueWidget({ p, currency, settings }: { p: DashParams; currency: string; settings?: WidgetSettings }) {
  const [cur, prev] = await loadKpiPair(p);
  return (
    <SpendRevenueCard
      currency={currency}
      interval={settings?.interval}
      data={{
        days: cur.days.map((d, i) => ({
          date: d.date,
          spendMinor: d.values.spend ?? 0,
          attributedRevenueMinor: d.values.attributedRevenue ?? 0,
          prevAttributedRevenueMinor: prev.days[i]?.values.attributedRevenue ?? null,
        })),
        spendMinor: cur.raw.spendMinor,
        attributedRevenueMinor: cur.raw.attributedRevenueMinor,
        prevAttributedRevenueMinor: prev.raw.spendMinor || prev.raw.attributedRevenueMinor ? prev.raw.attributedRevenueMinor : null,
        roas: cur.totals.roas,
      }}
    />
  );
}

/** Credited revenue by channel as horizontal bars, with each channel's share and conversions. */
export async function ChannelsWidget({ p, currency }: { p: DashParams; currency: string }) {
  const rows = await loadChannels(p.start, p.end, p.model);
  const total = rows.reduce((s, r) => s + Math.max(0, r.revenueMinor), 0);
  const max = Math.max(1, ...rows.map((r) => r.revenueMinor));
  return (
    <WidgetCard title="Revenue by channel" description="Where credited revenue came from">
      {rows.length === 0 ? (
        <WidgetEmpty icon={ChartNoAxesColumnIcon} title="No conversions in this period">
          Revenue appears here once payments come in.
        </WidgetEmpty>
      ) : (
        <ul className="flex h-full flex-col justify-start gap-3.5 overflow-hidden">
          {rows.slice(0, 6).map((r) => {
            const share = total > 0 ? Math.max(0, r.revenueMinor) / total : 0;
            const unattributed = r.channel === "unattributed";
            return (
              <li key={r.channel} className="min-w-0" title={`${countLabel(r.leads, "lead")}, ${countLabel(r.customers, "customer")}`}>
                <div className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
                  <span className="truncate font-medium">
                    {channelLabel(r.channel)}
                    <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums max-sm:hidden">{countLabel(r.customers, "customer")}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-medium">{moneyShort(r.revenueMinor, currency)}</span>
                    <span className="text-muted-foreground"> · {pct(share, 0)}</span>
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={unattributed ? "h-full rounded-full bg-muted-foreground/35" : "h-full rounded-full bg-[color:var(--chart-revenue,var(--chart-1))]"}
                    style={{ width: `${Math.max(1.5, (Math.max(0, r.revenueMinor) / max) * 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
