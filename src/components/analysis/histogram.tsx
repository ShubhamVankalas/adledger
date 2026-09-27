import { num, pct } from "@/lib/format";
import { LAG_BUCKETS, type LagStats } from "@/lib/reports-analysis";
import { cn } from "@/lib/utils";
import { daysLabel } from "./primitives";

// Lag distribution as five columns (same day, 1–7, 7–14, 14–30, 30+ days). Columns past the
// workspace attribution window are faded: conversions there get no ad credit. Plain HTML, so it
// renders on the server and scales with the text.

const UPPER = [1, 7, 14, 30];

export function LagHistogram({
  stats,
  windowDays,
  color,
  label,
  height = 132,
}: {
  stats: LagStats;
  windowDays: number;
  color: string;
  /** What is being measured, for screen readers ("first touch to payment"). */
  label: string;
  height?: number;
}) {
  const max = Math.max(1, ...stats.buckets);
  const total = stats.conversions;
  return (
    <figure className="min-w-0">
      <dl className="grid grid-cols-3 gap-3 text-caption">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Median</dt>
          <dd className="text-title-sm tabular-nums">{daysLabel(stats.medianDays)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">80% within</dt>
          <dd className="text-title-sm tabular-nums">{daysLabel(stats.p80Days)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">In window</dt>
          <dd className="text-title-sm tabular-nums">{pct(stats.withinWindowShare, 0)}</dd>
        </div>
      </dl>
      <div
        role="img"
        aria-label={`${label}: ${LAG_BUCKETS.map((b, i) => `${b.label} ${num(stats.buckets[i])}`).join(", ")}`}
        className="mt-4 grid grid-cols-5 items-end gap-2 border-b border-border-strong"
        style={{ height }}
      >
        {LAG_BUCKETS.map((b, i) => {
          const v = stats.buckets[i];
          const share = total > 0 ? v / total : 0;
          // Every lag in this column is longer than the window.
          const outside = (i === 0 ? 0 : UPPER[i - 1]) >= windowDays;
          return (
            <div key={b.key} className="flex h-full min-w-0 flex-col justify-end" title={`${b.label}: ${num(v)} (${pct(share, 0)})`}>
              <span className={cn("mb-1 text-center text-micro text-muted-foreground tabular-nums", v === 0 && "text-fg-faint")}>{v ? pct(share, 0) : "0"}</span>
              <div
                aria-hidden
                className={cn("mx-auto w-full max-w-10 rounded-t-[4px] transition-[height] duration-300 ease-out", outside && "opacity-35")}
                style={{ height: `${v ? Math.max(3, (v / max) * (height - 22)) : 0}px`, background: color }}
              />
            </div>
          );
        })}
      </div>
      <figcaption className="mt-1.5 grid grid-cols-5 gap-2 text-center text-micro text-muted-foreground">
        {LAG_BUCKETS.map((b) => (
          <span key={b.key} className="truncate">
            {b.short}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
