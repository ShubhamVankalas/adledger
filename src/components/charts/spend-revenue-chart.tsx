"use client";

import { useId } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";
import type { NameType } from "recharts/types/component/DefaultTooltipContent";
import { DeltaText } from "@/components/overview/tone";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { moneyShort, moneyWhole } from "@/lib/format";
import { metricDelta, METRICS } from "@/lib/metrics";
import { usePrefersReducedMotion } from "./use-reduced-motion";

export type SpendRevenuePoint = {
  /** Bucket start (a day, the Monday of a week, or the 1st of a month). */
  date: string;
  /** Bucket label for the axis and tooltip ("Sep 20", "Week of Sep 15", "Sep 2026"). */
  label: string;
  spendMinor: number;
  attributedRevenueMinor: number;
  /** Revenue from ads in the matching bucket of the previous period (null without comparison). */
  prevAttributedRevenueMinor: number | null;
};

const SPEND = METRICS.spend.color;
const REVENUE = METRICS.revenue.color;
const FAINT = "var(--fg-faint, var(--muted-foreground))";

const config = {
  attributed: { label: "Revenue from ads", color: REVENUE },
  prev: { label: "Previous period", color: FAINT },
  spend: { label: "Ad spend", color: SPEND },
} satisfies ChartConfig;

/** Spend bars against revenue credited to ads, with the previous period's revenue dashed. */
export function SpendRevenueChart({ data, currency, compare = true }: { data: SpendRevenuePoint[]; currency: string; compare?: boolean }) {
  const rows = data.map((d) => ({ date: d.date, label: d.label, spend: d.spendMinor, attributed: d.attributedRevenueMinor, prev: d.prevAttributedRevenueMinor }));
  const animate = !usePrefersReducedMotion();
  const fillId = `sr-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full [&_.recharts-cartesian-axis-tick_text]:fill-[color:var(--fg-faint,var(--muted-foreground))]">
      <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 6, bottom: 0 }} accessibilityLayer>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={REVENUE} stopOpacity={0.16} />
            <stop offset="100%" stopColor={REVENUE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={10} minTickGap={36} fontSize={11} />
        <YAxis tickLine={false} axisLine={false} width={52} tickMargin={6} tickCount={5} fontSize={11} domain={[0, "auto"]} tickFormatter={(v: number) => moneyShort(v, currency)} />
        <Tooltip
          cursor={{ fill: "var(--foreground)", opacity: 0.04 }}
          isAnimationActive={false}
          content={(p: TooltipContentProps<TooltipValueType, NameType>) => <SpendRevenueTooltip {...p} currency={currency} compare={compare} />}
        />
        <Bar dataKey="spend" fill={SPEND} fillOpacity={0.5} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={animate} animationDuration={400} />
        {compare ? <Line dataKey="prev" type="monotone" stroke={FAINT} strokeWidth={1.25} strokeDasharray="3 4" dot={false} activeDot={false} isAnimationActive={false} /> : null}
        <Area
          dataKey="attributed"
          type="monotone"
          stroke={REVENUE}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: REVENUE }}
          isAnimationActive={animate}
          animationDuration={400}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function SpendRevenueTooltip({ active, payload, currency, compare }: TooltipContentProps<TooltipValueType, NameType> & { currency: string; compare: boolean }) {
  const row = payload?.[0]?.payload as { label: string; spend: number; attributed: number; prev: number | null } | undefined;
  if (!active || !row) return null;
  const delta = metricDelta(row.attributed, row.prev, "up");
  const roas = row.spend > 0 ? row.attributed / row.spend : null;
  const line = (swatch: React.ReactNode, label: string, value: string, muted?: boolean) => (
    <div className={muted ? "flex items-center justify-between gap-6 text-muted-foreground" : "flex items-center justify-between gap-6"}>
      <span className="flex items-center gap-1.5">
        {swatch}
        {label}
      </span>
      <span className={muted ? "tabular-nums" : "font-semibold tabular-nums"}>{value}</span>
    </div>
  );
  return (
    <div className="grid min-w-52 gap-1 rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-0.5 text-muted-foreground">{row.label}</p>
      {line(<span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: REVENUE }} />, "Revenue from ads", moneyWhole(row.attributed, currency))}
      {line(<span aria-hidden className="size-2 rounded-[2px] opacity-60" style={{ background: SPEND }} />, "Ad spend", moneyWhole(row.spend, currency))}
      {compare && row.prev !== null ? line(<span aria-hidden className="w-3 border-t border-dashed" style={{ borderColor: FAINT }} />, "Previous period", moneyWhole(row.prev, currency), true) : null}
      <div className="mt-1 flex items-center justify-between gap-6 border-t pt-1.5">
        <span className="text-muted-foreground">ROAS {roas === null ? "—" : `${roas.toFixed(2)}×`}</span>
        {compare ? <DeltaText delta={delta} /> : null}
      </div>
    </div>
  );
}
