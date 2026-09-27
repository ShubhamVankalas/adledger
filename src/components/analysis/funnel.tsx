import { ArrowDownIcon } from "lucide-react";
import Link from "next/link";
import { DeltaText } from "@/components/overview/tone";
import { credit, creditTitle, moneyShort, moneyWhole, num, pct } from "@/lib/format";
import { metricDelta } from "@/lib/metrics";
import type { FunnelReport } from "@/lib/reports-analysis";
import { cn } from "@/lib/utils";

// Visitors → leads → customers → revenue. Each step's bar is its conversion rate from the step
// before (so the biggest drop-off is the shortest bar, instead of every bar after "visitors"
// collapsing to a sliver); a hairline marks the previous period's rate. Steps link to the people
// behind them.

type Step = {
  key: "visitors" | "leads" | "customers";
  label: string;
  value: number;
  prev: number | null;
  /** This step ÷ the step before; null for the first step. */
  rate: number | null;
  prevRate: number | null;
  rateLabel?: string;
  href?: string;
};

export function FunnelChart({ report, currency, dense = false }: { report: FunnelReport; currency: string; dense?: boolean }) {
  const r = report;
  const prev = r.previous;
  const steps: Step[] = [
    { key: "visitors", label: "Visitors", value: r.visitors, prev: prev?.visitors ?? null, rate: null, prevRate: null },
    {
      key: "leads",
      label: "Leads",
      value: r.leads,
      prev: prev?.leads ?? null,
      rate: r.leadRate,
      prevRate: prev?.leadRate ?? null,
      rateLabel: "of visitors",
      href: "/contacts?lifecycle=lead",
    },
    {
      key: "customers",
      label: "Customers",
      value: r.customers,
      prev: prev?.customers ?? null,
      rate: r.closeRate,
      prevRate: prev?.closeRate ?? null,
      rateLabel: "of leads",
      href: "/contacts?lifecycle=customer",
    },
  ];
  const revDelta = metricDelta(r.revenueMinor, prev?.revenueMinor ?? null, "up");

  return (
    <ol className={cn("flex flex-col", dense ? "gap-2.5" : "gap-3.5")} aria-label="Conversion funnel">
      {steps.map((s, i) => {
        const delta = metricDelta(s.value, s.prev, "up");
        const fill = s.rate === null ? 1 : Math.min(1, Math.max(0, s.rate));
        const ghost = s.prevRate === null ? null : Math.min(1, Math.max(0, s.prevRate));
        const valueText = s.key === "visitors" ? num(s.value) : credit(s.value);
        const name = s.href ? (
          <Link href={s.href} className="rounded-sm font-medium underline-offset-[3px] hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {s.label}
          </Link>
        ) : (
          <span className="font-medium">{s.label}</span>
        );
        return (
          <li key={s.key} className="min-w-0">
            {i > 0 ? (
              <p className={cn("flex items-center gap-1 text-caption text-muted-foreground", dense ? "mb-1.5" : "mb-2")}>
                <ArrowDownIcon aria-hidden className="size-3 text-fg-faint" />
                <span className="tabular-nums">
                  <span className="font-medium text-foreground">{pct(s.rate, s.rate !== null && s.rate < 0.1 ? 1 : 0)}</span> {s.rateLabel}
                </span>
                {s.prevRate !== null ? <span className="tabular-nums max-sm:hidden">· was {pct(s.prevRate, s.prevRate < 0.1 ? 1 : 0)}</span> : null}
              </p>
            ) : null}
            <div className="flex items-baseline justify-between gap-3 text-ui">
              {name}
              <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
                <DeltaText delta={delta} className="text-caption" />
                <span className="font-semibold" title={creditTitle(s.value, s.label.toLowerCase())}>
                  {valueText}
                </span>
              </span>
            </div>
            <div
              className={cn("relative mt-1.5 overflow-hidden rounded-[4px] bg-fill", dense ? "h-2" : "h-2.5")}
              role="img"
              aria-label={s.rate === null ? `${valueText} visitors` : `${pct(s.rate)} ${s.rateLabel}${s.prevRate !== null ? `, previously ${pct(s.prevRate)}` : ""}`}
            >
              <div
                className="h-full rounded-[4px] transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.max(fill > 0 ? 1.5 : 0, fill * 100)}%`,
                  background: s.key === "visitors" ? "var(--chart-spend)" : s.key === "leads" ? "var(--chart-leads)" : "var(--chart-customers)",
                }}
              />
              {ghost !== null ? (
                <span aria-hidden className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground/55" style={{ left: `${Math.max(0.5, ghost * 100)}%` }} />
              ) : null}
            </div>
          </li>
        );
      })}
      <li className={cn("flex items-baseline justify-between gap-3 border-t text-ui", dense ? "pt-2.5" : "pt-3.5")}>
        <span className="min-w-0">
          <span className="font-medium">Revenue</span>
          <span className="ml-2 text-caption text-muted-foreground tabular-nums">
            {r.revenuePerVisitorMinor === null ? "no visitors" : `${moneyWhole(r.revenuePerVisitorMinor, currency)} per visitor`}
          </span>
        </span>
        <span className="flex shrink-0 items-baseline gap-2 tabular-nums">
          <DeltaText delta={revDelta} className="text-caption" />
          <span className="font-semibold text-[color:var(--positive)]" title={moneyWhole(r.revenueMinor, currency)}>
            {moneyShort(r.revenueMinor, currency)}
          </span>
        </span>
      </li>
    </ol>
  );
}
