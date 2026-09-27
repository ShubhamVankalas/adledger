"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { bucketSeries } from "@/components/charts/buckets";
import { moneyShort } from "@/lib/format";
import { metricDelta, ratioX } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { DeltaText } from "./tone";
import { WidgetCard } from "./widget-card";

const SpendRevenueChart = dynamic(() => import("@/components/charts/spend-revenue-chart").then((m) => m.SpendRevenueChart), {
  ssr: false,
  loading: () => <div aria-hidden className="h-full animate-pulse rounded-lg bg-foreground/[0.03]" />,
});

type Interval = "day" | "week" | "month";
const INTERVALS: [Interval, string][] = [
  ["day", "Day"],
  ["week", "Week"],
  ["month", "Month"],
];

export type SpendRevenueData = {
  days: { date: string; spendMinor: number; attributedRevenueMinor: number; prevAttributedRevenueMinor: number | null }[];
  spendMinor: number;
  attributedRevenueMinor: number;
  prevAttributedRevenueMinor: number | null;
  roas: number | null;
};

export function SpendRevenueCard({ data, currency, interval: initial }: { data: SpendRevenueData; currency: string; interval?: Interval }) {
  const auto: Interval = data.days.length <= 45 ? "day" : data.days.length <= 200 ? "week" : "month";
  const [interval, setInterval] = useState<Interval>(initial ?? auto);
  const delta = metricDelta(data.attributedRevenueMinor, data.prevAttributedRevenueMinor, "up");
  const empty = data.spendMinor === 0 && data.attributedRevenueMinor === 0;
  return (
    <WidgetCard
      title="Spend vs revenue"
      description={
        <span className="flex items-baseline gap-2">
          <span className="text-base leading-6 font-semibold tracking-[-0.015em] text-foreground tabular-nums">{moneyShort(data.attributedRevenueMinor, currency)}</span>
          <DeltaText delta={delta} />
          <span className="truncate tabular-nums">
            from ads on {moneyShort(data.spendMinor, currency)} spend, {ratioX(data.roas)}
          </span>
        </span>
      }
      action={
        <div role="radiogroup" aria-label="Group by" className="flex h-7 items-center rounded-md bg-muted p-0.5 pointer-coarse:h-9">
          {INTERVALS.map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={interval === k}
              tabIndex={interval === k ? 0 : -1}
              onClick={() => setInterval(k)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                if (!step) return;
                e.preventDefault();
                const i = (INTERVALS.findIndex(([x]) => x === interval) + step + INTERVALS.length) % INTERVALS.length;
                setInterval(INTERVALS[i][0]);
                (e.currentTarget.parentElement?.children[i] as HTMLElement | undefined)?.focus();
              }}
              className={cn(
                "h-full rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                interval === k && "bg-card text-foreground shadow-xs ring-1 ring-foreground/[0.06]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      }
      bodyClassName="pt-2 pb-3 md:px-3"
    >
      {empty ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
          <p className="text-[13px] font-medium">No spend or revenue in this period</p>
          <p className="max-w-xs text-xs text-pretty text-muted-foreground">Try a longer date range, or connect an ad platform and payments.</p>
        </div>
      ) : (
        <SpendRevenueChart data={bucketSeries(data.days, interval)} currency={currency} />
      )}
    </WidgetCard>
  );
}
