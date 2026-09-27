"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, ChevronsUpDownIcon, PanelRightOpenIcon } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { PlatformBadge } from "@/components/platform-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { creditTitle, platformLabel } from "@/lib/format";
import type { PerfDeltas, PerfMetrics, PerfRowV2 } from "@/lib/reports-performance";
import { cn } from "@/lib/utils";
import { cellLight, DeltaLine, gapDetail, gapSentence, RoasBar, StatusPill, StoplightDot } from "./cells";
import { formatValue, type ColumnDef, type Density, type PerfTargets, type Sort, type SortKey } from "./columns";

// The Performance table. Wide containers get a real <table> with a sticky header, sticky name
// column and a sticky SQL totals row; narrow ones (phones, a tablet with the sidebar open) get one
// card per row. Both render from the same rows and callbacks.

export type TableProps = {
  rows: PerfRowV2[];
  columns: ColumnDef[];
  sort: Sort;
  onSort: (key: SortKey) => void;
  onSortPreset: (sort: Sort) => void;
  density: Density;
  compare: boolean;
  totals: (PerfMetrics & { count: number }) | null;
  totalsDelta: PerfDeltas | null;
  /** Totals are being recomputed for a new name filter: dim them. */
  totalsStale: boolean;
  currency: string;
  targets: PerfTargets;
  levelLabel: string;
  childHref: (id: string) => string | null;
  childLabel: string | null;
  onPeek: (id: string) => void;
  activeId: string | null;
  peekId: string | null;
  empty: React.ReactNode;
};

const SORT_BUTTON =
  "group/sort -mx-1 inline-flex h-7 items-center gap-1 rounded-md px-1 outline-none transition-colors duration-100 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";

function SortIcon({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active) return <ChevronsUpDownIcon aria-hidden className="size-3 opacity-0 transition-opacity duration-100 group-hover/sort:opacity-60" />;
  return dir === -1 ? <ArrowDownIcon aria-hidden className="size-3 text-foreground" /> : <ArrowUpIcon aria-hidden className="size-3 text-foreground" />;
}

const ariaSort = (sort: Sort, k: SortKey) => (sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined);
const columnMax = (rows: PerfRowV2[]) => rows.reduce((m, r) => Math.max(m, r.roas ?? 0), 0);

export function PerfTable(props: TableProps) {
  return (
    <>
      <DesktopTable {...props} />
      <PhoneCards {...props} />
    </>
  );
}

// ---------------------------------------------------------------- desktop

function DesktopTable({
  rows,
  columns,
  sort,
  onSort,
  density,
  compare,
  totals,
  totalsDelta,
  totalsStale,
  currency,
  targets,
  levelLabel,
  childHref,
  childLabel,
  onPeek,
  activeId,
  peekId,
  empty,
}: TableProps) {
  const max = columnMax(rows);
  const compact = density === "compact";
  const showTotals = totals !== null && rows.length > 1;
  return (
    <div
      role="region"
      aria-label={`${levelLabel} table`}
      tabIndex={0}
      className="hidden max-h-[max(24rem,calc(100dvh-13rem))] overflow-auto overscroll-x-contain rounded-xl surface-card outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring @2xl:block"
    >
      <table className="w-full border-separate border-spacing-0 text-ui">
        <thead className="sticky top-0 z-20">
          <tr>
            <th
              scope="col"
              aria-sort={ariaSort(sort, "name")}
              className="sticky left-0 z-10 h-9 min-w-56 border-r border-b bg-bg-subtle pr-3 pl-3 text-left text-caption font-medium whitespace-nowrap text-muted-foreground"
            >
              <button type="button" onClick={() => onSort("name")} className={cn(SORT_BUTTON, sort.key === "name" && "text-foreground")}>
                {levelLabel}
                <SortIcon active={sort.key === "name"} dir={sort.dir} />
              </button>
            </th>
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={c.key === "status" ? undefined : ariaSort(sort, c.key)}
                className={cn(
                  "h-9 border-b bg-bg-subtle px-3 text-caption font-medium whitespace-nowrap text-muted-foreground",
                  c.key === "status" ? "text-left" : "text-right",
                  i === columns.length - 1 && "pr-4",
                )}
              >
                <Tooltip>
                  <TooltipTrigger
                    delay={500}
                    render={
                      <button
                        type="button"
                        onClick={() => onSort(c.key)}
                        className={cn(SORT_BUTTON, c.key !== "status" && "flex-row-reverse", sort.key === c.key && "text-foreground")}
                      />
                    }
                  >
                    <span className="hidden @6xl:inline">{c.label}</span>
                    <span className="@6xl:hidden">{c.short ?? c.label}</span>
                    <SortIcon active={sort.key === c.key} dir={sort.dir} />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-60">
                    {c.hint}
                  </TooltipContent>
                </Tooltip>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr>
              <td colSpan={columns.length + 1} className="whitespace-normal">
                {empty}
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <Row
              key={r.id}
              row={r}
              columns={columns}
              sortKey={sort.key}
              compact={compact}
              compare={compare}
              currency={currency}
              targets={targets}
              max={max}
              href={childHref(r.id)}
              childLabel={childLabel}
              onPeek={onPeek}
              active={activeId === r.id}
              peeked={peekId === r.id}
            />
          ))}
        </tbody>
        {showTotals ? (
          <tfoot className="sticky bottom-0 z-20">
            <tr className={cn("transition-opacity duration-150", totalsStale && "opacity-50")} aria-busy={totalsStale || undefined}>
              <td className="sticky left-0 z-10 h-10 border-t border-r bg-bg-subtle pl-3 font-medium">
                Total <span className="num font-normal text-muted-foreground">({totals.count})</span>
              </td>
              {columns.map((c, i) => (
                <td key={c.key} className={cn("num h-10 border-t bg-bg-subtle px-3 text-right font-medium whitespace-nowrap", i === columns.length - 1 && "pr-4")}>
                  {c.key === "status" ? null : c.format === "gap" ? (
                    <span className="inline-flex flex-col items-end" title="All platforms together: conversions they reported vs conversions AdLedger verified.">
                      <CellValue col={c} row={totals} currency={currency} />
                      <span className="text-micro font-normal text-muted-foreground">{gapDetail(totals)}</span>
                    </span>
                  ) : (
                    <>
                      <CellValue col={c} row={totals} currency={currency} />
                      {compare ? <DeltaLine change={totalsDelta?.[c.key]} polarity={c.polarity} /> : null}
                    </>
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function CellValue({ col, row, currency }: { col: ColumnDef; row: PerfMetrics; currency: string }) {
  if (col.key === "status") return null;
  const v = row[col.key];
  if (col.format === "credit") return <span title={creditTitle(v, col.label.toLowerCase())}>{formatValue("credit", v, currency)}</span>;
  return <>{formatValue(col.format, v, currency)}</>;
}

type RowProps = {
  row: PerfRowV2;
  columns: ColumnDef[];
  sortKey: SortKey;
  compact: boolean;
  compare: boolean;
  currency: string;
  targets: PerfTargets;
  max: number;
  href: string | null;
  childLabel: string | null;
  onPeek: (id: string) => void;
  active: boolean;
  peeked: boolean;
};

/** Clicks on the row background open the peek; the name link drills down; the icon button is the keyboard route. */
const Row = memo(function Row({ row: r, columns, sortKey, compact, compare, currency, targets, max, href, childLabel, onPeek, active, peeked }: RowProps) {
  const selected = active || peeked;
  const cellBg = selected ? "[background:linear-gradient(var(--brand-soft),var(--brand-soft)),var(--card)]" : "bg-card group-hover/row:bg-fill";
  return (
    <tr
      data-row-id={r.id}
      data-selected={selected || undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a,button")) return;
        onPeek(r.id);
      }}
      className="group/row cursor-default"
    >
      <td
        className={cn(
          "sticky left-0 z-10 max-w-64 min-w-56 border-r border-b pr-2 pl-3 transition-colors duration-100 @6xl:max-w-80",
          compact ? "h-9" : "h-11",
          cellBg,
          selected && "shadow-[inset_2px_0_0_var(--brand)]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <PlatformBadge platform={r.platform} compact />
          <div className="min-w-0 flex-1">
            {href ? (
              <Link
                href={href}
                title={childLabel ? `${r.name}: open ${childLabel.toLowerCase()}` : r.name}
                className="flex min-w-0 items-center gap-1 rounded-sm font-medium outline-none hover:underline hover:decoration-border-strong hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
              >
                <span className="truncate">{r.name}</span>
                <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-fg-faint opacity-0 transition-opacity duration-100 group-hover/row:opacity-100" />
              </Link>
            ) : (
              <div className="truncate font-medium" title={r.name}>
                {r.name}
              </div>
            )}
            {r.parentName && !compact ? (
              <div className="truncate text-caption text-muted-foreground" title={r.parentName}>
                {r.parentName}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => onPeek(r.id)}
            aria-label={`Preview ${r.name}`}
            aria-haspopup="dialog"
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 outline-none transition-[opacity,color,background-color] duration-100 group-hover/row:opacity-100 pointer-coarse:opacity-100 hover:bg-fill-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <PanelRightOpenIcon className="size-3.5" />
          </button>
        </div>
      </td>
      {columns.map((c, i) => {
        const light = cellLight(c, r, targets, currency);
        return (
          <td
            key={c.key}
            className={cn(
              "num border-b px-3 whitespace-nowrap transition-colors duration-100",
              compact ? "h-9" : "h-11",
              c.key === "status" ? "text-left" : "text-right",
              i === columns.length - 1 && "pr-4",
              sortKey === c.key && "font-medium",
              c.key === "revenueMinor" && "font-medium",
              cellBg,
            )}
          >
            {c.key === "status" ? (
              <StatusPill status={r.status} />
            ) : c.format === "gap" ? (
              <GapCell row={r} />
            ) : (
              <>
                <span className="inline-flex items-center justify-end gap-2">
                  {c.key === "roas" ? <RoasBar value={r.roas} max={max} target={targets.roas} className="hidden @4xl:block" /> : null}
                  {light ? <StoplightDot light={light.light} target={light.target} /> : null}
                  <CellValue col={c} row={r} currency={currency} />
                </span>
                {compare ? <DeltaLine change={r.delta?.[c.key]} polarity={c.polarity} /> : null}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
});

function GapCell({ row }: { row: PerfRowV2 }) {
  const sentence = gapSentence(platformLabel(row.platform), row);
  if (row.platformGap === null) {
    return (
      <span className="inline-flex flex-col items-end text-fg-faint" title={sentence}>
        <span aria-hidden>—</span>
        <span aria-hidden className="text-micro">&nbsp;</span>
        <span className="sr-only">{sentence}</span>
      </span>
    );
  }
  const big = row.platformGap >= 0.5;
  return (
    <span className="inline-flex flex-col items-end" title={sentence}>
      <span className={cn(big && "text-warning-foreground")}>{formatValue("gap", row.platformGap, "USD")}</span>
      <span className="text-micro font-normal text-muted-foreground">{gapDetail(row)}</span>
      <span className="sr-only">{sentence}</span>
    </span>
  );
}

// ---------------------------------------------------------------- phone

const MOBILE_SORTS: [SortKey, 1 | -1, string][] = [
  ["spendMinor", -1, "Highest spend"],
  ["revenueMinor", -1, "Highest revenue"],
  ["roas", -1, "Best ROAS"],
  ["roas", 1, "Worst ROAS"],
  ["leads", -1, "Most leads"],
  ["name", 1, "Name (A–Z)"],
];

function PhoneCards({ rows, sort, onSortPreset, compare, totals, totalsStale, currency, targets, levelLabel, onPeek, empty, peekId }: TableProps) {
  const roasCol = { key: "roas", label: "ROAS", hint: "", format: "ratio", polarity: "up", group: "Revenue" } as const satisfies ColumnDef;
  return (
    <div className="space-y-3 @2xl:hidden">
      {totals && rows.length > 1 ? (
        <dl aria-label="Totals" className={cn("grid grid-cols-3 gap-3 rounded-xl surface-card p-3 transition-opacity", totalsStale && "opacity-50")}>
          <MiniStat label="Spend" value={formatValue("money", totals.spendMinor, currency, true)} />
          <MiniStat label="Revenue" value={formatValue("money", totals.revenueMinor, currency, true)} />
          <MiniStat label="ROAS" value={formatValue("ratio", totals.roas, currency)} />
        </dl>
      ) : null}
      {rows.length ? (
        <div className="flex items-center justify-between gap-3">
          <p className="num text-ui text-muted-foreground">
            {rows.length} {levelLabel.toLowerCase()}
          </p>
          <div className="relative">
            <select
              name="sort"
              aria-label="Sort by"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":");
                onSortPreset({ key: key as SortKey, dir: Number(dir) === 1 ? 1 : -1 });
              }}
              className="h-10 appearance-none rounded-md border border-input bg-surface pr-9 pl-3 text-body font-medium text-foreground outline-none transition-[border-color] duration-100 hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring [&>option]:bg-popover [&>option]:text-popover-foreground"
            >
              {/* A sort picked from the table header (e.g. before rotating the phone) may not be in the list. */}
              {MOBILE_SORTS.some(([k, dir]) => k === sort.key && dir === sort.dir) ? null : (
                <option value={`${sort.key}:${sort.dir}`} disabled hidden>
                  Custom order
                </option>
              )}
              {MOBILE_SORTS.map(([k, dir, label]) => (
                <option key={`${k}:${dir}`} value={`${k}:${dir}`}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>
      ) : null}
      {empty ? <div className="rounded-xl surface-card">{empty}</div> : null}
      <ul aria-label={levelLabel} className="grid grid-cols-1 gap-2 @md:grid-cols-2">
        {rows.map((r) => {
          const light = cellLight(roasCol, r, targets, currency);
          return (
            <li key={r.id} className="[contain-intrinsic-size:auto_8.5rem] [content-visibility:auto]">
              <button
                type="button"
                onClick={() => onPeek(r.id)}
                aria-haspopup="dialog"
                aria-current={peekId === r.id || undefined}
                className="block h-full w-full rounded-xl surface-card p-3 text-left outline-none transition-[background-color,box-shadow] duration-100 hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:bg-fill-hover"
              >
                <span className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span data-slot="row-name" title={r.name} className="line-clamp-2 text-body font-medium break-words">
                      {r.name}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
                      <PlatformBadge platform={r.platform} />
                      {r.parentName ? (
                        <span className="truncate" title={r.parentName}>
                          {r.parentName}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  {r.status ? <StatusPill status={r.status} className="mt-0.5" /> : null}
                </span>
                <span className="mt-3 grid grid-cols-3 gap-2">
                  <MiniStat as="span" label="Spend" value={formatValue("money", r.spendMinor, currency, true)} />
                  <MiniStat as="span" label="Revenue" value={formatValue("money", r.revenueMinor, currency, true)} delta={compare ? r.delta?.revenueMinor : undefined} polarity="up" />
                  <MiniStat
                    as="span"
                    label="ROAS"
                    value={formatValue("ratio", r.roas, currency)}
                    delta={compare ? r.delta?.roas : undefined}
                    polarity="up"
                    extra={light ? <StoplightDot light={light.light} target={light.target} /> : null}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MiniStat({
  label,
  value,
  delta,
  polarity = "neutral",
  extra,
  as = "div",
}: {
  label: string;
  value: string;
  delta?: number | null;
  polarity?: ColumnDef["polarity"];
  extra?: React.ReactNode;
  as?: "div" | "span";
}) {
  const Wrap = as;
  const Term = as === "div" ? "dt" : "span";
  const Def = as === "div" ? "dd" : "span";
  return (
    <Wrap className="block min-w-0">
      <Term className="block truncate text-caption text-muted-foreground">{label}</Term>
      <Def className="num mt-0.5 flex items-center gap-1.5 truncate text-body font-medium">
        {extra}
        {value}
      </Def>
      {delta !== undefined ? <DeltaLine change={delta} polarity={polarity} className="justify-start" /> : null}
    </Wrap>
  );
}
