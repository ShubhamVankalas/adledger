"use client";

import { useState } from "react";
import { moneyShort, moneyWhole, num, pct, plural } from "@/lib/format";
import type { CohortAverage, CohortReport } from "@/lib/reports-analysis";
import { cn } from "@/lib/utils";
import { monthLabel } from "./primitives";
import { Segmented } from "./segmented";

// Monthly acquisition cohorts × months since the first payment. Three readings of the same grid:
// retention (share paying again that month), cumulative LTV per customer, and revenue that month.
// A green dot marks the month a cohort's revenue per customer passed its CAC. Months that have
// not happened yet stay empty rather than reading as zero. The view lives in ?view=.

export type CohortView = "retention" | "ltv" | "revenue";

const OPTIONS = [
  { value: "retention", label: "Retention" },
  { value: "ltv", label: "Cumulative LTV" },
  { value: "revenue", label: "Revenue" },
] as const;

const COLOR: Record<CohortView, string> = {
  retention: "var(--chart-customers)",
  ltv: "var(--chart-revenue)",
  revenue: "var(--chart-revenue)",
};

const HINT: Record<CohortView, string> = {
  retention: "Share of each cohort that paid again in that month. Month 0 is the month of the first payment.",
  ltv: "Net revenue per customer so far, at the end of each month after the first payment.",
  revenue: "Net revenue (payments minus refunds) each cohort brought in that month.",
};

export function CohortHeatmap({ report, average, currency, initialView }: { report: CohortReport; average: CohortAverage; currency: string; initialView: CohortView }) {
  const [view, setView] = useState<CohortView>(initialView);
  const change = (v: CohortView) => {
    setView(v);
    // Keep the choice in the URL (shareable) without a server round trip.
    const url = new URL(window.location.href);
    if (v === "retention") url.searchParams.delete("view");
    else url.searchParams.set("view", v);
    window.history.replaceState(window.history.state, "", url);
  };

  const months = report.months;
  const valueAt = (c: { retention: (number | null)[]; cumulativeLtvMinor: (number | null)[]; revenueMinor: (number | null)[] }, k: number): number | null => {
    if (c.retention[k] === null || c.retention[k] === undefined) return null;
    return view === "retention" ? c.retention[k] : view === "ltv" ? c.cumulativeLtvMinor[k] : c.revenueMinor[k];
  };
  // Scale: retention ignores month 0 (always 100%) so later months get the full colour range.
  const all = report.cohorts.flatMap((c) => Array.from({ length: c.retention.length }, (_, k) => (view === "retention" && k === 0 ? null : valueAt(c, k))));
  const max = Math.max(view === "retention" ? 0.01 : 1, ...all.filter((v): v is number => v !== null));
  const fmt = (v: number | null) => (v === null ? "" : view === "retention" ? pct(v, 0) : moneyShort(v, currency));
  const full = (v: number | null) => (v === null ? "not yet" : view === "retention" ? pct(v, 1) : moneyWhole(v, currency));
  const avgRow = { retention: average.retention, cumulativeLtvMinor: average.cumulativeLtvMinor, revenueMinor: average.revenueMinor };

  // Cells cap at a 60% tint so the normal text colour stays readable (AA) on every shade, in both themes.
  const cell = (v: number | null, k: number, opts: { payback?: boolean; label: string }) => {
    const muted = view === "retention" && k === 0;
    const t = v === null || muted ? 0 : Math.max(0, v) / max;
    return (
      <td key={k} className="p-0.5">
        <div
          title={`${opts.label}, month ${k}: ${full(v)}${opts.payback ? " · paid back CAC" : ""}`}
          className={cn(
            "relative flex h-8 w-[4.25rem] items-center justify-center rounded-[4px] px-1 text-caption tabular-nums",
            v === null ? "" : muted || t === 0 ? "bg-fill text-muted-foreground" : "",
            t > 0.6 && "font-medium",
          )}
          style={v !== null && !muted && t > 0 ? { background: `color-mix(in oklch, ${COLOR[view]} ${Math.round(10 + t * 50)}%, var(--fill))` } : undefined}
        >
          {fmt(v)}
          {opts.payback ? (
            <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-[color:var(--positive)] ring-2 ring-card" />
          ) : null}
          {opts.payback ? <span className="sr-only"> (paid back CAC)</span> : null}
        </div>
      </td>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-xl text-caption text-muted-foreground">{HINT[view]}</p>
        <Segmented label="Show" value={view} onChange={change} options={OPTIONS} />
      </div>
      <div role="region" aria-label="Cohort table" tabIndex={0} className="-mx-4 overflow-x-auto overscroll-x-contain px-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <table className="border-separate border-spacing-0 text-ui">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-card pr-3 pb-2 text-left text-caption font-medium whitespace-nowrap text-muted-foreground">
                Cohort
              </th>
              <th scope="col" className="px-2 pb-2 text-right text-caption font-medium whitespace-nowrap text-muted-foreground">
                Customers
              </th>
              <th scope="col" className="px-2 pb-2 text-right text-caption font-medium whitespace-nowrap text-muted-foreground">
                CAC
              </th>
              {Array.from({ length: months }, (_, k) => (
                <th key={k} scope="col" className="px-0.5 pb-2 text-center text-caption font-medium whitespace-nowrap text-muted-foreground">
                  M{k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.cohorts.map((c) => {
              const label = monthLabel(c.cohort);
              return (
                <tr key={c.cohort}>
                  <th scope="row" className="sticky left-0 z-10 bg-card py-0.5 pr-3 text-left font-medium whitespace-nowrap">
                    {label}
                  </th>
                  <td className="px-2 text-right whitespace-nowrap tabular-nums">{c.customers ? num(c.customers) : <span className="text-fg-faint">0</span>}</td>
                  <td className="px-2 text-right whitespace-nowrap text-muted-foreground tabular-nums">{moneyShort(c.cacMinor, currency)}</td>
                  {c.customers === 0 ? (
                    <td colSpan={Math.max(1, months)} className="p-0.5 text-caption text-fg-faint">
                      <div className="flex h-8 items-center rounded-[4px] px-2">No new customers</div>
                    </td>
                  ) : (
                    Array.from({ length: months }, (_, k) =>
                      k < c.retention.length ? cell(valueAt(c, k), k, { payback: c.paybackMonth === k, label }) : <td key={k} className="p-0.5" />,
                    )
                  )}
                </tr>
              );
            })}
            {report.cohorts.filter((c) => c.customers > 0).length > 1 ? (
              <tr>
                <th scope="row" className="sticky left-0 z-10 border-t bg-card pt-1.5 pr-3 text-left font-medium whitespace-nowrap">
                  {view === "revenue" ? "Total" : "All cohorts"}
                </th>
                <td className="border-t px-2 pt-1.5 text-right tabular-nums">{num(report.customers)}</td>
                <td className="border-t px-2 pt-1.5" />
                {Array.from({ length: months }, (_, k) => {
                  const v = valueAt(avgRow, k);
                  return (
                    <td key={k} className="border-t px-0.5 pt-1.5 text-center text-caption font-medium tabular-nums" title={`All cohorts, month ${k}: ${full(v)} (${plural(average.customers[k] ?? 0, "customer")})`}>
                      {v === null ? "" : fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-micro text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-[color:var(--positive)]" /> Month the cohort paid back its CAC
        </span>
        <span>Empty cells: months that have not happened yet</span>
      </div>
    </div>
  );
}
