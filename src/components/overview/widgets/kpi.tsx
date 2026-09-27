import Link from "next/link";
import { Sparkline } from "@/components/charts/sparkline";
import { loadKpiPair, type DashParams } from "@/lib/dashboard/data";
import { formatMetric, metricDelta, METRICS, ratioX, type MetricKey } from "@/lib/metrics";
import { seriesOf, type KpiSeries } from "@/lib/reports-metrics";
import { cn } from "@/lib/utils";
import type { WidgetSettings } from "@/lib/widgets/catalog";
import { MetricInfo } from "../metric-info";
import { DeltaText } from "../tone";

// KPI tile body: label (drills into the report) + ⓘ, the value, the change coloured by polarity
// with the previous value, and a server-rendered sparkline with the comparison dashed.

/** The small line under the value: the companion metric for combined tiles. */
function companion(metric: MetricKey, cur: KpiSeries, currency: string): string | null {
  const t = cur.totals;
  switch (metric) {
    case "revenue":
      return `${formatMetric("attributedRevenue", t.attributedRevenue, currency, { compact: true })} from ads`;
    case "roas":
      return `MER ${ratioX(t.mer)}`;
    case "leads":
      return `CPL ${formatMetric("cpl", t.cpl, currency)}`;
    case "customers":
      return `CAC ${formatMetric("cac", t.cac, currency)}`;
    case "unattributedShare":
      return t.revenue ? `${formatMetric("revenue", cur.raw.unattributedRevenueMinor, currency, { compact: true })} of revenue` : null;
    default:
      return null;
  }
}

export async function KpiWidget({ metric, p, currency, settings }: { metric: MetricKey; p: DashParams; currency: string; settings?: WidgetSettings }) {
  const [cur, prev] = await loadKpiPair(p);
  const def = METRICS[metric];
  const value = cur.totals[metric];
  const prevValue = prev.totals[metric];
  const prevText = formatMetric(metric, prevValue, currency, { compact: true });
  const delta = metricDelta(value, prevValue, def.polarity);
  const withPrev = { ...delta, label: prevValue === null ? delta.label : `${delta.label}, was ${prevText}` };
  const sub = companion(metric, cur, currency);
  const text = formatMetric(metric, value, currency, { compact: true });
  const target = settings?.target;
  const progress = target && value !== null ? (def.polarity === "down" ? target / Math.max(value, 1e-9) : value / target) : null;
  const drill = def.href.startsWith("/performance") ? `${def.href}?${new URLSearchParams({ range: p.range, model: p.model, ...(p.range === "custom" ? { from: p.start, to: p.end } : {}) })}` : def.href;

  return (
    <div className="flex h-full flex-col px-3.5 pt-3 pb-3 md:px-4 md:pt-3.5">
      <div className="flex h-4 items-center gap-1.5 pr-6 text-xs leading-4 font-medium text-muted-foreground">
        <Link href={drill} className="relative z-10 truncate rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          {def.label}
        </Link>
        <MetricInfo metric={metric} />
      </div>
      <p className="mt-1 truncate text-[1.375rem] leading-7 font-semibold tracking-[-0.02em] tabular-nums md:text-2xl md:leading-8" title={formatMetric(metric, value, currency)}>
        {text}
      </p>
      <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs leading-4">
        <DeltaText delta={withPrev} />
        <span className="truncate text-muted-foreground">{sub ?? (prevValue !== null ? `was ${prevText}` : "no earlier data")}</span>
      </p>
      {target && progress !== null ? (
        <div className="mt-auto hidden md:block" title={`${Math.round(progress * 100)}% of the ${formatMetric(metric, target, currency, { compact: true })} target`}>
          <div className="mb-1 flex justify-between text-[11px] leading-4 text-muted-foreground tabular-nums">
            <span>Target {formatMetric(metric, target, currency, { compact: true })}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full bg-[color:var(--chart-revenue,var(--chart-1))]", progress < 0.7 && "bg-[color:var(--warning)]")} style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        </div>
      ) : (
        <Sparkline className="mt-auto hidden md:block" values={seriesOf(cur, metric)} previous={seriesOf(prev, metric)} color={def.color} />
      )}
    </div>
  );
}
