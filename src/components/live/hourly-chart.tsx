"use client";

import { useId } from "react";
import { Area, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";
import type { NameType } from "recharts/types/component/DefaultTooltipContent";
import { usePrefersReducedMotion } from "@/components/charts/use-reduced-motion";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { moneyShort, moneyWhole, num } from "@/lib/format";
import type { LiveHour } from "@/lib/reports-live";
import { HIDDEN_AMOUNT } from "./live-prefs";
import { HOURLY_METRICS, type HourlyMetric } from "./options";


const FAINT = "var(--fg-faint, var(--muted-foreground))";

/** "12a", "6a", "12p", "6p": short hour ticks. */
const hourTick = (h: number) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "a" : "p"}`;
const hourLabel = (h: number) => new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric" });

type Row = { hour: number; today: number | null; yesterday: number };

function toRows(hours: LiveHour[], metric: HourlyMetric): Row[] {
  return hours.map((h) => ({
    hour: h.hour,
    // Revenue is a running total (how the day is building up); visitors and leads are per hour.
    today: h.today === null ? null : metric === "revenue" ? h.today.revenueCumMinor : h.today[metric],
    yesterday: metric === "revenue" ? h.yesterday.revenueCumMinor : h.yesterday[metric],
  }));
}

/**
 * Today (solid, up to the current hour) against yesterday (dashed, same hue, the whole day), by
 * hour in the workspace timezone. In streamer mode the money axis and tooltip values are hidden.
 */
export function HourlyChart({ hours, metric, currency, hideMoney }: { hours: LiveHour[]; metric: HourlyMetric; currency: string; hideMoney: boolean }) {
  const def = HOURLY_METRICS.find((m) => m.key === metric)!;
  const rows = toRows(hours, metric);
  const animate = !usePrefersReducedMotion();
  const fillId = `live-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const isMoney = metric === "revenue";
  const masked = isMoney && hideMoney;
  const fmt = (v: number) => (isMoney ? moneyShort(v, currency) : num(v));
  const config = { today: { label: "Today", color: def.color }, yesterday: { label: "Yesterday", color: def.color } } satisfies ChartConfig;

  return (
    <ChartContainer config={config} className="aspect-auto h-full w-full [&_.recharts-cartesian-axis-tick_text]:fill-[color:var(--fg-faint,var(--muted-foreground))]">
      <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 6, bottom: 0 }} accessibilityLayer>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={def.color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={def.color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} ticks={[0, 6, 12, 18]} tickFormatter={hourTick} fontSize={11} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={masked ? 20 : 44}
          tickMargin={6}
          tickCount={4}
          fontSize={11}
          allowDecimals={false}
          domain={[(min: number) => Math.min(0, min), "auto"]}
          tickFormatter={(v: number) => (masked ? "" : fmt(v))}
        />
        <Tooltip
          cursor={{ stroke: "var(--border-strong, var(--border))" }}
          isAnimationActive={false}
          content={(p: TooltipContentProps<TooltipValueType, NameType>) => <HourlyTooltip {...p} metric={def} format={(v) => (masked ? HIDDEN_AMOUNT : isMoney ? moneyWhole(v, currency) : num(v))} running={isMoney} />}
        />
        <Line dataKey="yesterday" type="monotone" stroke={def.color} strokeOpacity={0.55} strokeWidth={1.25} strokeDasharray="3 4" dot={false} activeDot={false} isAnimationActive={false} className="chart-late" />
        <Area
          dataKey="today"
          type="monotone"
          stroke={def.color}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          dot={false}
          connectNulls={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: def.color }}
          isAnimationActive={animate}
          animationDuration={600}
          animationEasing="ease-out"
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function HourlyTooltip({
  active,
  payload,
  metric,
  format,
  running,
}: TooltipContentProps<TooltipValueType, NameType> & { metric: { label: string; color: string }; format: (v: number) => string; running: boolean }) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  const next = (row.hour + 1) % 24;
  return (
    <div className="grid min-w-44 gap-1 rounded-lg bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="mb-0.5 text-muted-foreground">{running ? `${metric.label} by ${hourLabel(next)}` : `${metric.label}, ${hourLabel(row.hour)} to ${hourLabel(next)}`}</p>
      <div className="flex items-center justify-between gap-6">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: metric.color }} />
          Today
        </span>
        <span className="font-semibold tabular-nums">{row.today === null ? "—" : format(row.today)}</span>
      </div>
      <div className="flex items-center justify-between gap-6 text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-3 border-t border-dashed" style={{ borderColor: FAINT }} />
          Yesterday
        </span>
        <span className="tabular-nums">{format(row.yesterday)}</span>
      </div>
    </div>
  );
}
