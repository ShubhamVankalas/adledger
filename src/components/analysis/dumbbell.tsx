import { PlatformBadge } from "@/components/platform-badge";
import { moneyShort, moneyWhole } from "@/lib/format";
import type { ModelDisagreement } from "@/lib/reports-analysis";
import { cn } from "@/lib/utils";
import { Legend } from "./primitives";

// Model disagreement as a dumbbell per campaign: one dot per attribution model on a shared
// revenue scale, joined by a line. A long line = the campaign's value depends on the model you
// pick; dots on top of each other = every model agrees.

export const MODEL_DOTS = [
  { key: "firstMinor", label: "First touch", color: "var(--chart-customers)" },
  { key: "linearMinor", label: "Linear", color: "var(--fg)" },
  { key: "lastMinor", label: "Last touch", color: "var(--chart-leads)" },
] as const;

const ROLE: Record<string, { label: string; className: string } | undefined> = {
  starter: { label: "Starter", className: "bg-[color-mix(in_oklch,var(--chart-customers)_14%,transparent)] text-foreground" },
  closer: { label: "Closer", className: "bg-warning-soft text-warning-foreground" },
};

export function DumbbellLegend() {
  return (
    <Legend>
      {MODEL_DOTS.map((d) => (
        <span key={d.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-full" style={{ background: d.color }} />
          {d.label}
        </span>
      ))}
    </Legend>
  );
}

export function Dumbbell({ report, currency, limit = 10 }: { report: ModelDisagreement; currency: string; limit?: number }) {
  const rows = report.rows.slice(0, limit);
  const scale = Math.max(1, ...rows.map((r) => r.maxMinor));
  const at = (v: number) => `${(Math.max(0, v) / scale) * 100}%`;
  return (
    <div className="min-w-0">
      <div aria-hidden className="mb-2 hidden grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5.5rem] gap-x-4 border-b pb-2 text-caption font-medium text-muted-foreground sm:grid">
        <span>Campaign</span>
        <span className="flex justify-between">
          <span>{moneyShort(0, currency)}</span>
          <span className="tabular-nums">{moneyShort(scale, currency)}</span>
        </span>
        <span className="text-right">Moves by</span>
      </div>
    <ul className="flex flex-col divide-y" aria-label="Revenue by attribution model per campaign">
      {rows.map((r) => {
        const role = ROLE[r.role];
        const summary = MODEL_DOTS.map((d) => `${d.label} ${moneyWhole(r[d.key], currency)}`).join(", ");
        return (
          <li key={r.id} className="grid grid-cols-1 gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_5.5rem] sm:items-center">
            <div className="flex min-w-0 items-center gap-2">
              <PlatformBadge platform={r.platform} compact />
              <span className="truncate font-medium" title={r.name}>
                {r.name}
              </span>
              {role ? <span className={cn("shrink-0 rounded-[4px] px-1.5 text-micro leading-[18px]", role.className)}>{role.label}</span> : null}
            </div>
            <div className="relative h-5" role="img" aria-label={`${r.name}: ${summary}`}>
              <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
              <span
                aria-hidden
                className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-foreground/25"
                style={{ left: at(r.minMinor), width: `calc(${at(r.maxMinor)} - ${at(r.minMinor)})` }}
              />
              {MODEL_DOTS.map((d) => (
                <span
                  key={d.key}
                  aria-hidden
                  title={`${d.label}: ${moneyWhole(r[d.key], currency)}`}
                  className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                  style={{ left: at(r[d.key]), background: d.color }}
                />
              ))}
            </div>
            <div className="flex items-baseline justify-between gap-2 text-caption tabular-nums sm:block sm:text-right">
              <span className="text-muted-foreground sm:hidden">Moves</span>
              <span className="font-medium text-foreground" title={`${moneyWhole(r.minMinor, currency)} – ${moneyWhole(r.maxMinor, currency)}`}>
                {r.spreadMinor === 0 ? "—" : moneyShort(r.spreadMinor, currency)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
    </div>
  );
}
