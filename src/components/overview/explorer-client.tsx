"use client";

import { ChevronDownIcon } from "lucide-react";
import dynamic from "next/dynamic";
import type { ExplorerPoint } from "@/components/charts/metric-explorer-chart";
import { formatMetric, isMetricKey, METRIC_KEYS, metricDelta, METRICS, type MetricKey } from "@/lib/metrics";
import { useDashboard } from "./dashboard-context";
import { DeltaText } from "./tone";
import { WidgetCard } from "./widget-card";

// Recharts loads in its own chunk (it's below the KPI strip); the frame keeps its height meanwhile.
const MetricExplorerChart = dynamic(() => import("@/components/charts/metric-explorer-chart").then((m) => m.MetricExplorerChart), {
  ssr: false,
  loading: () => <div aria-hidden className="h-full animate-pulse rounded-lg bg-foreground/[0.03]" />,
});

export type ExplorerData = {
  dates: string[];
  prevDates: string[];
  cur: Record<MetricKey, (number | null)[]>;
  prev: Record<MetricKey, (number | null)[]>;
  totals: Record<MetricKey, number | null>;
  prevTotals: Record<MetricKey, number | null>;
};

/** Metric explorer: follows the KPI tile that was clicked, or its own metric picker. */
export function ExplorerClient({ data, currency, defaultMetric, title }: { data: ExplorerData; currency: string; defaultMetric: MetricKey; title?: string }) {
  const { metric: selected, selectMetric } = useDashboard();
  const metric = selected ?? defaultMetric;
  const def = METRICS[metric];
  const value = data.totals[metric];
  const prevValue = data.prevTotals[metric];
  const delta = metricDelta(value, prevValue, def.polarity);
  const points: ExplorerPoint[] = data.dates.map((date, i) => ({ date, prevDate: data.prevDates[i] ?? null, cur: data.cur[metric][i] ?? null, prev: data.prev[metric][i] ?? null }));
  const hasData = points.some((p) => p.cur !== null && p.cur !== 0);

  return (
    <WidgetCard
      title={title ?? def.label}
      description={
        <span className="flex items-baseline gap-2">
          <span className="text-base leading-6 font-semibold tracking-[-0.015em] text-foreground tabular-nums">{formatMetric(metric, value, currency)}</span>
          <DeltaText delta={delta} />
          {prevValue !== null ? <span className="truncate tabular-nums">was {formatMetric(metric, prevValue, currency)}</span> : null}
        </span>
      }
      action={
        <>
          <span className="mr-2 hidden items-center gap-3 text-xs text-muted-foreground lg:flex">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: def.color }} />
              This period
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-3 border-t border-dashed border-muted-foreground/60" />
              Previous
            </span>
          </span>
          <label className="relative">
            <span className="sr-only">Metric to chart</span>
            <select
              name="explorer-metric"
              value={metric}
              onChange={(e) => isMetricKey(e.target.value) && selectMetric(e.target.value)}
              className="h-7 appearance-none rounded-md border border-input bg-background pr-7 pl-2.5 text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 pointer-coarse:h-9 max-md:text-base [&>option]:bg-popover [&>option]:text-popover-foreground"
            >
              {METRIC_KEYS.map((k) => (
                <option key={k} value={k}>
                  {METRICS[k].label}
                </option>
              ))}
            </select>
            <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          </label>
        </>
      }
      bodyClassName="pt-2 pb-3 md:px-3"
    >
      {hasData ? (
        <MetricExplorerChart data={points} metric={metric} currency={currency} />
      ) : (
        <div className="flex h-full items-center justify-center text-center text-[13px] text-muted-foreground">No {def.label.toLowerCase()} in this period.</div>
      )}
    </WidgetCard>
  );
}
