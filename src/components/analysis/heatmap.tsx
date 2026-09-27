"use client";

import { useState } from "react";
import { num, plural } from "@/lib/format";
import type { ConversionsHeatmap, HeatmapCell } from "@/lib/reports-analysis";
import { cn } from "@/lib/utils";
import { Segmented } from "./segmented";

// Weekday × hour grid of leads and payments in the workspace timezone. One colour per metric
// (leads amber, payments green, both brand), intensity = count ÷ the busiest cell. Hovering or
// focusing a cell fills the readout line; the busiest slot is shown by default.

type Kind = "all" | "leads" | "payments";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COLOR: Record<Kind, string> = { all: "var(--brand)", leads: "var(--chart-leads)", payments: "var(--chart-revenue)" };
const OPTIONS = [
  { value: "all", label: "All" },
  { value: "leads", label: "Leads" },
  { value: "payments", label: "Payments" },
] as const;

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const valueOf = (c: HeatmapCell, k: Kind) => (k === "leads" ? c.leads : k === "payments" ? c.payments : c.leads + c.payments);

function describe(c: HeatmapCell, k: Kind) {
  const parts = k === "all" ? [plural(c.leads, "lead"), plural(c.payments, "payment")] : k === "leads" ? [plural(c.leads, "lead")] : [plural(c.payments, "payment")];
  return { when: `${DAY_NAMES[c.dow]} ${hourLabel(c.hour)}–${hourLabel((c.hour + 1) % 24)}`, what: parts.join(", ") };
}
const sentence = (c: HeatmapCell, k: Kind) => {
  const d = describe(c, k);
  return `${d.when}: ${d.what}`;
};

export function HeatmapGrid({ data, compact = false }: { data: ConversionsHeatmap; compact?: boolean }) {
  const [kind, setKind] = useState<Kind>("all");
  const [hover, setHover] = useState<HeatmapCell | null>(null);
  const max = Math.max(1, ...data.cells.map((c) => valueOf(c, kind)));
  const total = data.cells.reduce((a, c) => a + valueOf(c, kind), 0);
  const peak = data.cells.reduce<HeatmapCell | null>((best, c) => (valueOf(c, kind) > (best ? valueOf(best, kind) : 0) ? c : best), null);
  const shown = hover ?? peak;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-h-5 min-w-0 text-caption text-muted-foreground tabular-nums">
          {total === 0 ? (
            "Nothing in this period"
          ) : shown ? (
            <>
              {hover ? null : <span className="text-fg-faint">Busiest · </span>}
              <span className="font-medium text-foreground">{describe(shown, kind).when}</span> · {describe(shown, kind).what}
            </>
          ) : null}
        </p>
        <Segmented label="Show" value={kind} onChange={setKind} options={OPTIONS} />
      </div>

      <div className="min-w-0" onPointerLeave={() => setHover(null)}>
        <table className="w-full table-fixed border-separate border-spacing-[2px]" aria-label={`Conversions by weekday and hour (${data.timezone})`}>
          <thead>
            <tr>
              <th scope="col" className={cn(compact ? "w-7" : "w-9")}>
                <span className="sr-only">Day</span>
              </th>
              {Array.from({ length: 24 }, (_, h) => (
                <th key={h} scope="col" className="p-0 text-center text-micro font-normal text-fg-faint tabular-nums">
                  <span aria-hidden className={cn(h % 6 !== 0 && (compact || h % 3 !== 0 ? "invisible" : "max-sm:invisible"))}>
                    {h}
                  </span>
                  <span className="sr-only">{hourLabel(h)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d, dow) => (
              <tr key={d}>
                <th scope="row" className="pr-1 text-left text-micro font-normal text-muted-foreground">
                  <abbr title={DAY_NAMES[dow]} className="no-underline">
                    {compact ? d.slice(0, 1) : d}
                  </abbr>
                </th>
                {Array.from({ length: 24 }, (_, h) => {
                  const c = data.cells[dow * 24 + h];
                  const v = valueOf(c, kind);
                  const t = v / max;
                  return (
                    <td
                      key={h}
                      tabIndex={-1}
                      aria-label={sentence(c, kind)}
                      onPointerEnter={() => setHover(c)}
                      onFocus={() => setHover(c)}
                      className={cn("p-0", compact ? "h-4" : "h-5 md:h-6")}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "block h-full w-full rounded-[3px] transition-[outline-color] duration-100",
                          v === 0 ? "bg-fill" : "",
                          hover === c && "outline outline-1 outline-offset-1 outline-foreground/60",
                        )}
                        style={v === 0 ? undefined : { background: `color-mix(in oklch, ${COLOR[kind]} ${Math.round(18 + t * 82)}%, var(--fill))` }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-micro text-muted-foreground">
        <span>
          {num(total)} {kind === "leads" ? (total === 1 ? "lead" : "leads") : kind === "payments" ? (total === 1 ? "payment" : "payments") : total === 1 ? "conversion" : "conversions"} ·{" "}
          <span translate="no">{data.timezone}</span>
        </span>
        <span className="flex items-center gap-1.5" aria-hidden>
          Fewer
          <span className="flex gap-[2px]">
            {[0, 0.25, 0.5, 0.75, 1].map((s) => (
              <span key={s} className="size-2.5 rounded-[2px]" style={{ background: s === 0 ? "var(--fill)" : `color-mix(in oklch, ${COLOR[kind]} ${Math.round(18 + s * 82)}%, var(--fill))` }} />
            ))}
          </span>
          More
        </span>
      </div>
    </div>
  );
}
