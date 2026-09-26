"use client";

import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { toMajor } from "@/lib/money";

const config = {
  spend: { label: "Ad spend", color: "var(--chart-2)" },
  attributed: { label: "Revenue from ads", color: "var(--chart-1)" },
  revenue: { label: "Total revenue", color: "var(--chart-4)" },
} satisfies ChartConfig;

const fmtDate = (v: string) =>
  new Date(`${v}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function SpendRevenueChart({
  data,
  currency,
}: {
  data: { date: string; spendMinor: number; revenueMinor: number; attributedRevenueMinor: number }[];
  currency: string;
}) {
  const rows = data.map((d) => ({
    date: d.date,
    spend: toMajor(d.spendMinor, currency),
    attributed: toMajor(d.attributedRevenueMinor, currency),
    revenue: toMajor(d.revenueMinor, currency),
  }));
  const moneyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

  return (
    <ChartContainer config={config} className="aspect-auto h-[300px] w-full">
      <ComposedChart data={rows} margin={{ left: 4, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="fillAttributed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-attributed)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-attributed)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={fmtDate} />
        <YAxis tickLine={false} axisLine={false} width={48} domain={[0, "auto"]} allowDataOverflow tickFormatter={(v: number) => compact.format(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.5 }}
          content={
            <ChartTooltipContent
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
        <ChartLegend content={<ChartLegendContent />} />
      </ComposedChart>
    </ChartContainer>
  );
}
