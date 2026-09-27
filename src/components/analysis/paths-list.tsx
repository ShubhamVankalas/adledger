import { ChevronRightIcon } from "lucide-react";
import { moneyShort, moneyWhole, num, pct, plural } from "@/lib/format";
import type { PathsReport } from "@/lib/reports-analysis";
import { daysLabel, SourceLabel, stepLabel } from "./primitives";

// The most common journeys as rows of step chips (Meta › Google › Direct), each with how many
// people took it, their revenue, how long it took and how many touches. The share bar is scaled
// to the most common path so the ranking reads at a glance.

const COLS = "sm:grid-cols-[minmax(0,1fr)_9rem_6rem_5rem_4.5rem]";

function Steps({ steps }: { steps: string[] }) {
  if (steps.length === 0) {
    return <span className="text-muted-foreground italic">No tracked touch</span>;
  }
  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1" aria-label={steps.map(stepLabel).join(", then ")}>
      {steps.map((s, i) => (
        <li key={`${s}-${i}`} className="flex min-w-0 items-center gap-1">
          {i > 0 ? <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-fg-faint" /> : null}
          <span className="inline-flex h-6 min-w-0 items-center rounded-md bg-fill px-1.5">
            <SourceLabel id={s} />
          </span>
        </li>
      ))}
    </ol>
  );
}

export function PathsList({ report, currency, noun }: { report: PathsReport; currency: string; noun: string }) {
  const top = Math.max(1, ...report.rows.map((r) => r.converters));
  return (
    <div className="min-w-0">
      <div aria-hidden className={`hidden gap-x-4 border-b pb-2 text-caption font-medium text-muted-foreground sm:grid ${COLS}`}>
        <span>Journey</span>
        <span className="text-right">{noun.charAt(0).toUpperCase() + noun.slice(1)}</span>
        <span className="text-right">Revenue</span>
        <span className="text-right">Median</span>
        <span className="text-right">Touches</span>
      </div>
      <ol className="flex flex-col divide-y">
        {report.rows.map((r, i) => (
          <li key={r.key || "untracked"} className={`grid grid-cols-2 items-center gap-x-4 gap-y-2 py-3 sm:py-2.5 ${COLS}`}>
            <div className="col-span-2 flex min-w-0 items-start gap-2.5 sm:col-span-1">
              <span className="mt-[3px] w-4 shrink-0 text-right text-caption text-fg-faint tabular-nums">{i + 1}</span>
              <Steps steps={r.steps} />
            </div>
            <div className="col-span-2 flex min-w-0 items-center gap-2.5 sm:col-span-1 sm:justify-end">
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-fill sm:max-w-16" aria-hidden>
                <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (r.converters / top) * 100)}%` }} />
              </span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="font-medium">{num(r.converters)}</span>
                <span className="ml-1.5 text-caption text-muted-foreground">{pct(r.share, 0)}</span>
              </span>
            </div>
            <Cell label="Revenue" title={moneyWhole(r.revenueMinor, currency)}>
              {moneyShort(r.revenueMinor, currency)}
            </Cell>
            <Cell label="Median time">{daysLabel(r.medianDays, { short: true })}</Cell>
            <Cell label="Avg touches" className="max-sm:hidden">
              {r.steps.length ? num(r.avgTouches, 1) : "—"}
            </Cell>
          </li>
        ))}
        {report.other.paths > 0 ? (
          <li className={`flex items-center justify-between gap-x-4 py-2.5 text-muted-foreground sm:grid ${COLS}`}>
            <span className="sm:pl-6.5">{plural(report.other.paths, "other journey")}</span>
            <span className="text-right tabular-nums">
              {num(report.other.converters)} <span className="text-caption">{pct(report.converters ? report.other.converters / report.converters : 0, 0)}</span>
              <span className="text-caption sm:hidden"> · {moneyShort(report.other.revenueMinor, currency)}</span>
            </span>
            <span className="text-right tabular-nums max-sm:hidden">{moneyShort(report.other.revenueMinor, currency)}</span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

function Cell({ label, children, title, className }: { label: string; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <div className={`flex min-w-0 items-baseline justify-between gap-2 tabular-nums sm:block sm:text-right ${className ?? ""}`} title={title}>
      <span className="text-caption text-muted-foreground sm:sr-only">{label}</span>
      <span>{children}</span>
    </div>
  );
}
