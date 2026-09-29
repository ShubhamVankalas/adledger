"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis, type TooltipContentProps, type TooltipValueType } from "recharts";
import type { NameType } from "recharts/types/component/DefaultTooltipContent";
import { usePrefersReducedMotion } from "@/components/charts/use-reduced-motion";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { moneyShort, moneyWhole } from "@/lib/format";
import { cn } from "@/lib/utils";

// Revenue per customer by days since their first payment, one line per acquisition source. The
// selected source is drawn in colour with its CAC as a dashed line: where the curve crosses the
// dashed line is the payback day. Other sources stay as faint context.

export type LtvCurveSeries = {
  key: string;
  label: string;
  /** [day, ltvMinor | null] at the report's curve marks. */
  points: { day: number; ltvMinor: number | null }[];
  cacMinor: number | null;
  paybackDays: number | null;
};

const ACTIVE = "var(--chart-revenue)";
const CAC = "var(--chart-spend)";
const FAINT = "color-mix(in oklch, var(--fg-faint) 45%, transparent)";

export function LtvCurveChart({ series, currency, initial }: { series: LtvCurveSeries[]; currency: string; initial?: string }) {
  const [active, setActive] = useState(initial ?? series[0]?.key);
  const animate = !usePrefersReducedMotion();
  const sel = series.find((s) => s.key === active) ?? series[0];
  const days = [...new Set(series.flatMap((s) => s.points.filter((p) => p.ltvMinor !== null).map((p) => p.day)))].sort((a, b) => a - b);
  const maxDay = Math.max(30, days.at(-1) ?? 30);
  const rows = [...new Set(series.flatMap((s) => s.points.map((p) => p.day)))]
    .filter((d) => d <= maxDay)
    .sort((a, b) => a - b)
    .map((day) => Object.fromEntries([["day", day], ...series.map((s) => [s.key, s.points.find((p) => p.day === day)?.ltvMinor ?? null])]));
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.key === sel?.key ? ACTIVE : FAINT }])) satisfies ChartConfig;

  if (!sel) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div role="radiogroup" aria-label="Acquisition source" className="flex flex-wrap gap-1.5">
        {series.map((s) => {
          const on = s.key === sel.key;
          return (
            <button
              key={s.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setActive(s.key)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-caption transition-[color,background-color,border-color] duration-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:h-7",
                on ? "border-transparent bg-fill-active font-medium text-foreground" : "bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
              )}
            >
              <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: on ? ACTIVE : "var(--fg-faint)" }} />
              {s.label}
            </button>
          );
        })}
      </div>
      <div className="h-64 md:h-72">
        <ChartContainer config={config} className="aspect-auto h-full w-full [&_.recharts-cartesian-axis-tick_text]:fill-[color:var(--fg-faint,var(--muted-foreground))]">
          <LineChart data={rows} margin={{ left: 0, right: 12, top: 8, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" type="number" domain={[0, maxDay]} ticks={days.length ? days : [0]} tickLine={false} axisLine={false} tickMargin={10} fontSize={11} tickFormatter={(d: number) => (d === 0 ? "Day 0" : `${d}d`)} />
            <YAxis tickLine={false} axisLine={false} width={56} tickMargin={6} tickCount={5} fontSize={11} domain={[0, "auto"]} tickFormatter={(v: number) => moneyShort(v, currency)} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: "var(--border-strong)" }} content={(p: TooltipContentProps<TooltipValueType, NameType>) => <CurveTooltip {...p} sel={sel} currency={currency} />} />
            {sel.cacMinor !== null ? (
              <ReferenceLine
                y={sel.cacMinor}
                stroke={CAC}
                strokeDasharray="4 4"
                strokeWidth={1.25}
                ifOverflow="extendDomain"
                label={{ value: `CAC ${moneyShort(sel.cacMinor, currency)}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }}
              />
            ) : null}
            {series
              .filter((s) => s.key !== sel.key)
              .map((s) => (
                <Line key={s.key} dataKey={s.key} type="linear" stroke={FAINT} strokeWidth={1.25} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} className="chart-late" />
              ))}
            <Line
              dataKey={sel.key}
              type="linear"
              stroke={ACTIVE}
              strokeWidth={2}
              dot={{ r: 2.5, fill: ACTIVE, strokeWidth: 0 }}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: ACTIVE }}
              connectNulls={false}
              isAnimationActive={animate}
              animationDuration={750}
              animationEasing="ease-out"
            />
          </LineChart>
        </ChartContainer>
      </div>
    </div>
  );
}

function CurveTooltip({ active, payload, sel, currency }: TooltipContentProps<TooltipValueType, NameType> & { sel: LtvCurveSeries; currency: string }) {
  const row = payload?.[0]?.payload as Record<string, number | null> | undefined;
  if (!active || !row) return null;
  const v = row[sel.key];
  return (
    <div className="grid min-w-44 gap-1 rounded-lg bg-popover px-3 py-2 text-caption text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <p className="text-muted-foreground">{row.day === 0 ? "First payment day" : `${row.day} days after the first payment`}</p>
      <div className="flex items-center justify-between gap-6">
        <span>{sel.label}</span>
        <span className="font-semibold tabular-nums">{v === null || v === undefined ? "Too early" : moneyWhole(v, currency)}</span>
      </div>
      {sel.cacMinor !== null ? (
        <div className="flex items-center justify-between gap-6 text-muted-foreground">
          <span>CAC</span>
          <span className="tabular-nums">{moneyWhole(sel.cacMinor, currency)}</span>
        </div>
      ) : null}
    </div>
  );
}
