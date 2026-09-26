"use client";

import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { toMajor } from "@/lib/money";
import { cn } from "@/lib/utils";

const config = {
  attributed: { label: "Revenue from ads", color: "var(--chart-1)" },
  revenue: { label: "Total revenue", color: "var(--chart-4)" },
  spend: { label: "Ad spend", color: "var(--chart-2)" },
} satisfies ChartConfig;

const fmtDate = (v: string) =>
  new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/** Legend drawn in HTML (short labels on phones so it fits one row) with swatches that match the mark: bar, solid line, dashed line. */
function Legend() {
  const items = [
    {
      key: "attributed",
      short: "Ads revenue",
      swatch: <span className="h-0.5 w-3.5 rounded-full bg-chart-1" />,
    },
    {
      key: "revenue",
      short: "All revenue",
      swatch: <span className="w-3.5 border-t-2 border-dashed border-chart-4" />,
    },
    {
      key: "spend",
      short: "Spend",
      swatch: <span className="size-2.5 rounded-[2px] bg-chart-2 opacity-85" />,
    },
  ] as const;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground">
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
  const rows = data.map((d) => ({
    date: d.date,
    spend: toMajor(d.spendMinor, currency),
    attributed: toMajor(d.attributedRevenueMinor, currency),
    revenue: toMajor(d.revenueMinor, currency),
  }));
  const moneyFmt = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });
  const compactMoney = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  });

  return (
    <div className={cn("space-y-3", className)}>
      <Legend />
      <ChartContainer config={config} className="aspect-auto h-[220px] w-full sm:h-[280px] 2xl:h-[320px]">
        <ComposedChart data={rows} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="fillAttributed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-attributed)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--color-attributed)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={fmtDate} />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tickCount={4}
            domain={[0, "auto"]}
            allowDataOverflow
            tickFormatter={(v: number) => compactMoney.format(v)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={
              <ChartTooltipContent
                className="min-w-44"
                labelFormatter={(v) => fmtDate(String(v))}
                formatter={(value, name) => (
                  <div className="flex w-full items-center justify-between gap-4">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="size-2 rounded-[2px]" style={{ background: `var(--color-${String(name)})` }} />
                      {config[name as keyof typeof config]?.label}
                    </span>
                    <span className="tabular font-medium text-foreground">{moneyFmt.format(Number(value))}</span>
                  </div>
                )}
              />
            }
          />
          <Bar dataKey="spend" fill="var(--color-spend)" radius={[3, 3, 0, 0]} maxBarSize={14} fillOpacity={0.85} />
          <Area dataKey="attributed" type="monotone" stroke="var(--color-attributed)" strokeWidth={2} fill="url(#fillAttributed)" />
          <Area dataKey="revenue" type="monotone" stroke="var(--color-revenue)" strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
        </ComposedChart>
      </ChartContainer>
    </div>
  );
}
