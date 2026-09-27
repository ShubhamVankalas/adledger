"use client";

import { useId, useSyncExternalStore } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { moneyShort, moneyWhole, shortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

const config = {
  attributed: { label: "Revenue from ads", color: "var(--chart-1)" },
  revenue: { label: "Total revenue", color: "var(--chart-4)" },
  spend: { label: "Ad spend", color: "var(--chart-2)" },
} satisfies ChartConfig;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
/** Recharts animates in JS, so CSS motion-reduce can't reach it: read the media query instead. */
function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/** Legend drawn in HTML (short labels on phones so it fits one row) with swatches that match the mark: bar, solid line, dashed line. */
function Legend() {
  const items = [
    {
      key: "attributed",
      short: "Ads revenue",
      swatch: <span aria-hidden className="h-[3px] w-3.5 rounded-full bg-chart-1" />,
    },
    {
      key: "revenue",
      short: "All revenue",
      swatch: <span aria-hidden className="w-3.5 border-t-2 border-dashed border-chart-4" />,
    },
    {
      key: "spend",
      short: "Spend",
      swatch: <span aria-hidden className="size-2.5 rounded-[3px] bg-chart-2/55" />,
    },
  ] as const;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5">
          {i.swatch}
          <span className="sm:hidden">{i.short}</span>
          <span className="max-sm:hidden">{config[i.key].label}</span>
        </li>
      ))}
    </ul>
  );
}

export function SpendRevenueChart({
  data,
  currency,
  className,
}: {
  data: {
    date: string;
    spendMinor: number;
    revenueMinor: number;
    attributedRevenueMinor: number;
  }[];
  currency: string;
  className?: string;
}) {
  // Plotted in minor units so the shared money formatters (src/lib/format.ts) label axis and tooltip.
  const rows = data.map((d) => ({
    date: d.date,
    spend: d.spendMinor,
    attributed: d.attributedRevenueMinor,
    revenue: d.revenueMinor,
  }));
  const animate = !usePrefersReducedMotion();
  // Unique per chart: two charts on one page must not share a gradient id.
  const fillId = `fillAttributed-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <div className={cn("space-y-3", className)}>
      <Legend />
      <ChartContainer config={config} className="aspect-auto h-[220px] w-full sm:h-[280px] 2xl:h-[320px]">
        <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-attributed)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-attributed)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={32} tickFormatter={(v: string) => shortDate(v)} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={48}
            tickMargin={6}
            tickCount={4}
            domain={[0, "auto"]}
            allowDataOverflow
            tickFormatter={(v: number) => moneyShort(v, currency)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--foreground)", opacity: 0.05 }}
            content={
              <ChartTooltipContent
                className="min-w-48"
                labelFormatter={(v) => shortDate(String(v))}
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span aria-hidden className="size-2 rounded-full" style={{ background: `var(--color-${String(name)})` }} />
                      {config[name as keyof typeof config]?.label}
                    </span>
                    <span className="tabular font-medium text-foreground">{moneyWhole(Number(value), currency)}</span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="spend" fill="var(--color-spend)" radius={[3, 3, 0, 0]} maxBarSize={12} fillOpacity={0.55} isAnimationActive={animate} animationDuration={500} />
          <Area
            dataKey="attributed"
            type="monotone"
            stroke="var(--color-attributed)"
            strokeWidth={2.25}
            fill={`url(#${fillId})`}
            isAnimationActive={animate}
            animationDuration={700}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }}
          />
          <Area
            dataKey="revenue"
            type="monotone"
            stroke="var(--color-revenue)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="none"
            isAnimationActive={animate}
            animationDuration={700}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--card)" }}
          />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
