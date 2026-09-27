"use client";

import { useId } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";
import type { NameType } from "recharts/types/component/DefaultTooltipContent";
import { DeltaText } from "@/components/overview/tone";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { shortDate } from "@/lib/format";
import { formatAxis, formatMetric, metricDelta, METRICS, type MetricKey } from "@/lib/metrics";
import { usePrefersReducedMotion } from "./use-reduced-motion";

export type ExplorerPoint = { date: string; prevDate: string | null; cur: number | null; prev: number | null };

const FAINT = "var(--fg-faint, var(--muted-foreground))";

/**
 * One metric over time: a filled line for this period, the previous period dashed in the same
 * frame, and a crosshair tooltip with both values and the change. Ratios get a 1.00× break-even line.
 */
export function MetricExplorerChart({ data, metric, currency, compare = true }: { data: ExplorerPoint[]; metric: MetricKey; currency: string; compare?: boolean }) {
  const def = METRICS[metric];
  const animate = !usePrefersReducedMotion();
  const fillId = `explorer-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const config = { cur: { label: "This period", color: def.color }, prev: { label: "Previous period", color: FAINT } } satisfies ChartConfig;
  const isRatio = def.format === "ratio";

  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full [&_.recharts-cartesian-axis-tick_text]:fill-[color:var(--fg-faint,var(--muted-foreground))]">
      <ComposedChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 0 }} accessibilityLayer>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={def.color} stopOpacity={0.16} />
            <stop offset="100%" stopColor={def.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} minTickGap={44} tickFormatter={(v: string) => shortDate(v)} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={52}
          tickMargin={6}
          tickCount={5}
          fontSize={11}
          domain={[0, "auto"]}
          // Refund-heavy days make net revenue dip below zero; keep the axis at 0 (the tooltip shows the true value).
          allowDataOverflow
          allowDecimals={def.format !== "count"}
          tickFormatter={(v: number) => formatAxis(metric, v, currency)}
        />
        {isRatio ? (
          <ReferenceLine
            y={1}
            stroke="var(--negative, var(--destructive))"
            strokeOpacity={0.55}
            strokeDasharray="4 4"
            label={{ value: "Break-even 1.00×", position: "insideTopLeft", fontSize: 11, fill: "var(--negative, var(--destructive))", opacity: 0.8 }}
          />
        ) : null}
        <Tooltip
          cursor={{ stroke: "var(--border-strong, var(--input))", strokeWidth: 1 }}
          isAnimationActive={false}
          content={(props: TooltipContentProps<TooltipValueType, NameType>) => <ExplorerTooltip {...props} metric={metric} currency={currency} compare={compare} />}
        />
        {compare ? (
          <Line dataKey="prev" type="monotone" stroke={FAINT} strokeWidth={1.25} strokeDasharray="3 4" dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
        ) : null}
        <Area
          dataKey="cur"
          type="monotone"
          stroke={def.color}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: def.color }}
          isAnimationActive={animate}
          animationDuration={400}
          animationEasing="ease-out"
          connectNulls={false}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function ExplorerTooltip({ active, payload, metric, currency, compare }: TooltipContentProps<TooltipValueType, NameType> & { metric: MetricKey; currency: string; compare: boolean }) {
  const point = payload?.[0]?.payload as ExplorerPoint | undefined;
  if (!active || !point) return null;
  const def = METRICS[metric];
  const delta = metricDelta(point.cur, point.prev, def.polarity);
  return (
    <div className="min-w-48 rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-1.5 text-muted-foreground">{shortDate(point.date)}</p>
      <div className="flex items-center justify-between gap-6">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: def.color }} />
          This period
        </span>
        <span className="font-semibold tabular-nums">{formatMetric(metric, point.cur, currency)}</span>
      </div>
      {compare ? (
        <>
          <div className="mt-1 flex items-center justify-between gap-6 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="w-3 border-t border-dashed" style={{ borderColor: FAINT }} />
              {point.prevDate ? shortDate(point.prevDate) : "Previous"}
            </span>
            <span className="tabular-nums">{formatMetric(metric, point.prev, currency)}</span>
          </div>
          {delta.tone !== "none" ? (
            <div className="mt-1.5 flex items-center justify-between gap-6 border-t pt-1.5">
              <span className="text-muted-foreground">Change</span>
              <DeltaText delta={delta} />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
