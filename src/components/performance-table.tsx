"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  DownloadIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PlatformBadge } from "@/components/platform-badge";
import {
  ReportEmpty,
  ROW_HOVER,
  shortMoney,
  Stat,
  STICKY_HEAD_BG,
  STICKY_ROW_BG,
} from "@/components/reports/report-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, num, pct, roas } from "@/lib/format";
import { toMajor } from "@/lib/money";
import type { PerfRow } from "@/lib/reports";
import { cn } from "@/lib/utils";

type Key =
  | "name"
  | "spendMinor"
  | "clicks"
  | "ctr"
  | "leads"
  | "cplMinor"
  | "customers"
  | "cacMinor"
  | "revenueMinor"
  | "roas";

// Columns appear as the table's container (not the viewport) gets wider, so the table
// fits whether the sidebar is open or collapsed. Spend, revenue and ROAS always show.
const COLS: { key: Key; label: string; className?: string }[] = [
  { key: "spendMinor", label: "Spend" },
  { key: "clicks", label: "Clicks", className: "hidden @5xl:table-cell" },
  { key: "ctr", label: "CTR", className: "hidden @6xl:table-cell" },
  { key: "leads", label: "Leads" },
  { key: "cplMinor", label: "CPL", className: "hidden @3xl:table-cell" },
  { key: "customers", label: "Customers", className: "hidden @3xl:table-cell" },
  { key: "cacMinor", label: "CAC", className: "hidden @4xl:table-cell" },
  { key: "revenueMinor", label: "Revenue" },
  { key: "roas", label: "ROAS" },
];

const SORT_BUTTON =
  "group/sort inline-flex h-8 items-center gap-1 rounded-md px-1 -mx-1 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

const MOBILE_SORTS: [Key, 1 | -1, string][] = [
  ["spendMinor", -1, "Highest spend"],
  ["revenueMinor", -1, "Highest revenue"],
  ["roas", -1, "Best ROAS"],
  ["roas", 1, "Worst ROAS"],
  ["leads", -1, "Most leads"],
  ["name", 1, "Name (A–Z)"],
];

const roasTone = (r: PerfRow | { roas: number | null; spendMinor: number }) =>
  (r.roas ?? 0) >= 1
    ? "text-success"
    : r.spendMinor > 0
      ? "text-destructive"
      : "text-muted-foreground";

function SortIcon({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  if (!active)
    return (
      <ChevronsUpDownIcon
        aria-hidden
        className="size-3.5 opacity-35 transition-opacity group-hover/sort:opacity-80"
      />
    );
  return dir === -1 ? (
    <ArrowDownIcon aria-hidden className="size-3.5 text-primary" />
  ) : (
    <ArrowUpIcon aria-hidden className="size-3.5 text-primary" />
  );
}

export function PerformanceTable({
  rows,
  currency,
  childHref,
  levelLabel,
  filename,
  nav,
}: {
  rows: PerfRow[];
  currency: string;
  childHref: ((id: string) => string) | string | null;
  levelLabel: string;
  filename: string;
  /** Level switcher rendered in the toolbar next to the filter. */
  nav?: React.ReactNode;
}) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({
    key: "spendMinor",
    dir: -1,
  });
  const [q, setQ] = useState("");
  const hrefFor = (id: string) =>
    typeof childHref === "string"
      ? childHref.replace("__ID__", id)
      : childHref
        ? childHref(id)
        : null;
  const noun = levelLabel.toLowerCase();

  const sorted = useMemo(() => {
    const f = q
      ? rows.filter((r) =>
          `${r.name} ${r.parentName ?? ""}`
            .toLowerCase()
            .includes(q.toLowerCase()),
        )
      : rows;
    return [...f].sort((a, b) => {
      const av = a[sort.key] ?? -Infinity;
      const bv = b[sort.key] ?? -Infinity;
      return (
        (typeof av === "string"
          ? av.localeCompare(String(bv))
          : Number(av) - Number(bv)) * sort.dir
      );
    });
  }, [rows, sort, q]);

  const totals = useMemo(() => {
    const t = sorted.reduce(
      (s, r) => ({
        spend: s.spend + r.spendMinor,
        clicks: s.clicks + r.clicks,
        imp: s.imp + r.impressions,
        leads: s.leads + r.leads,
        cust: s.cust + r.customers,
        rev: s.rev + r.revenueMinor,
      }),
      { spend: 0, clicks: 0, imp: 0, leads: 0, cust: 0, rev: 0 },
    );
    return t;
  }, [sorted]);
  const totalRoas = totals.spend ? totals.rev / totals.spend : null;

  const maxRoas = Math.max(1, ...sorted.map((r) => r.roas ?? 0));

  const exportCsv = () => {
    const head = [
      "name",
      "platform",
      "parent",
      "spend",
      "impressions",
      "clicks",
      "leads",
      "customers",
      "revenue",
      "roas",
      "cpl",
      "cac",
      "currency",
    ];
    const esc = (v: string | number | null) => {
      const s = v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = sorted.map((r) =>
      [
        r.name,
        r.platform,
        r.parentName,
        toMajor(r.spendMinor, currency),
        r.impressions,
        r.clicks,
        r.leads,
        r.customers,
        toMajor(r.revenueMinor, currency),
        r.roas === null ? "" : r.roas.toFixed(4),
        r.cplMinor === null ? "" : toMajor(r.cplMinor, currency),
        r.cacMinor === null ? "" : toMajor(r.cacMinor, currency),
        currency,
      ]
        .map(esc)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], {
      type: "text/csv",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const toggle = (k: Key) =>
    setSort((s) => ({
      key: k,
      dir: s.key === k ? (s.dir === 1 ? -1 : 1) : k === "name" ? 1 : -1,
    }));
  const ariaSort = (k: Key) =>
    sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined;

  const empty =
    rows.length === 0 ? (
      <ReportEmpty
        icon={SearchXIcon}
        title={`No ${noun} with spend or conversions in this period`}
      >
        Try a longer date range or another platform.
      </ReportEmpty>
    ) : sorted.length === 0 ? (
      <ReportEmpty icon={SearchIcon} title={`No ${noun} match “${q}”`}>
        <Button
          variant="outline"
          size="sm"
          className="mt-1 h-9"
          onClick={() => setQ("")}
        >
          Clear filter
        </Button>
      </ReportEmpty>
    ) : null;

  return (
    <div className="@container space-y-3">
      {/* Toolbar: level switcher, filter and export. Stacks on narrow containers. */}
      <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:gap-3">
        {nav}
        <div className="flex min-w-0 flex-1 items-center gap-2 @3xl:justify-end">
          <div className="relative min-w-0 flex-1 @3xl:max-w-72">
            <SearchIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              placeholder={`Filter ${noun}…`}
              aria-label={`Filter ${noun}`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-10 pr-9 pl-9 @3xl:h-9 [&::-webkit-search-cancel-button]:hidden"
            />
            {q ? (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => setQ("")}
                className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <XIcon className="size-4" />
              </button>
            ) : null}
          </div>
          <Button
            variant="outline"
            onClick={exportCsv}
            aria-label="Export CSV"
            title="Export CSV"
            className="h-10 w-10 shrink-0 px-0 @md:w-auto @md:px-3 @3xl:h-9"
          >
            <DownloadIcon />
            <span className="hidden @md:inline">Export CSV</span>
          </Button>
        </div>
      </div>

      {/* Wide containers: a table with a sticky header, sticky name column and sticky totals. */}
      <div
        role="region"
        aria-label={`${levelLabel} table`}
        tabIndex={0}
        className="hidden max-h-[max(22rem,calc(100dvh-12rem))] overflow-auto outline-none focus-visible:ring-3 focus-visible:ring-ring/50 overscroll-x-contain rounded-xl border bg-card @2xl:block"
      >
        <table className="w-full caption-bottom border-separate border-spacing-0 text-sm">
          <TableHeader className="sticky top-0 z-20 [&_th]:border-b [&_tr]:border-0">
            <TableRow className={cn("hover:bg-transparent", STICKY_HEAD_BG)}>
              <TableHead
                className={cn(
                  "sticky left-0 z-10 min-w-52 border-r pl-3 text-muted-foreground @5xl:min-w-64",
                  STICKY_HEAD_BG,
                )}
                aria-sort={ariaSort("name")}
              >
                <button
                  type="button"
                  onClick={() => toggle("name")}
                  className={cn(
                    SORT_BUTTON,
                    sort.key === "name" && "text-foreground",
                  )}
                >
                  {levelLabel}
                  <SortIcon active={sort.key === "name"} dir={sort.dir} />
                </button>
              </TableHead>
              {COLS.map((c) => (
                <TableHead
                  key={c.key}
                  className={cn(
                    "text-right text-muted-foreground",
                    STICKY_HEAD_BG,
                    c.key === "roas" && "pr-3",
                    c.className,
                  )}
                  aria-sort={ariaSort(c.key)}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className={cn(
                      SORT_BUTTON,
                      "flex-row-reverse",
                      sort.key === c.key && "text-foreground",
                    )}
                  >
                    {c.label}
                    <SortIcon active={sort.key === c.key} dir={sort.dir} />
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_td]:border-b [&_tr:last-child_td]:border-b-0 [&_tr]:border-0">
            {empty ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={COLS.length + 1}
                  className="whitespace-normal"
                >
                  {empty}
                </TableCell>
              </TableRow>
            ) : null}
            {sorted.map((r) => {
              const href = hrefFor(r.id);
              const sortedCol = (k: Key) => sort.key === k && "font-medium";
              return (
                <TableRow key={r.id} className={ROW_HOVER}>
                  <TableCell
                    className={cn(
                      "sticky left-0 z-10 max-w-64 border-r pl-3 @6xl:max-w-96",
                      STICKY_ROW_BG,
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <PlatformBadge
                        platform={r.platform}
                        compact
                        className="@6xl:hidden"
                      />
                      <PlatformBadge
                        platform={r.platform}
                        className="hidden @6xl:inline-flex"
                      />
                      <div className="min-w-0">
                        {href ? (
                          <Link
                            href={href}
                            className="flex items-center gap-1 font-medium outline-none hover:text-primary focus-visible:underline"
                            title={r.name}
                          >
                            <span className="truncate">{r.name}</span>
                            <ChevronRightIcon
                              aria-hidden
                              className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100"
                            />
                          </Link>
                        ) : (
                          <div className="truncate font-medium" title={r.name}>
                            {r.name}
                          </div>
                        )}
                        {r.parentName ? (
                          <div className="truncate text-xs text-muted-foreground">
                            {r.parentName}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular text-right",
                      sortedCol("spendMinor"),
                    )}
                  >
                    {money(r.spendMinor, currency)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular hidden text-right @5xl:table-cell",
                      sortedCol("clicks"),
                    )}
                  >
                    {num(r.clicks)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular hidden text-right @6xl:table-cell",
                      sortedCol("ctr"),
                    )}
                  >
                    {pct(r.ctr, 2)}
                  </TableCell>
                  <TableCell
                    className={cn("tabular text-right", sortedCol("leads"))}
                  >
                    {num(r.leads, 1)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular hidden text-right @3xl:table-cell",
                      sortedCol("cplMinor"),
                    )}
                  >
                    {money(r.cplMinor, currency)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular hidden text-right @3xl:table-cell",
                      sortedCol("customers"),
                    )}
                  >
                    {num(r.customers, 1)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "tabular hidden text-right @4xl:table-cell",
                      sortedCol("cacMinor"),
                    )}
                  >
                    {money(r.cacMinor, currency)}
                  </TableCell>
                  <TableCell className="tabular text-right font-medium">
                    {money(r.revenueMinor, currency)}
                  </TableCell>
                  <TableCell className="pr-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div
                        className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted @4xl:block"
                        aria-hidden
                      >
                        <div
                          className={cn(
                            "h-full rounded-full",
                            (r.roas ?? 0) >= 1
                              ? "bg-success"
                              : "bg-destructive/70",
                          )}
                          style={{
                            width: `${Math.min(100, ((r.roas ?? 0) / maxRoas) * 100)}%`,
                          }}
                        />
                      </div>
                      <span
                        className={cn(
                          "tabular min-w-12 text-right font-semibold",
                          roasTone(r),
                        )}
                      >
                        {roas(r.roas)}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {sorted.length > 1 ? (
            <TableFooter className="sticky bottom-0 z-20 border-0 bg-transparent [&_td]:border-t">
              <TableRow className={cn("hover:bg-transparent", STICKY_HEAD_BG)}>
                <TableCell
                  className={cn(
                    "sticky left-0 z-10 border-r pl-3 font-semibold",
                    STICKY_HEAD_BG,
                  )}
                >
                  Total{" "}
                  <span className="font-normal text-muted-foreground">
                    ({sorted.length})
                  </span>
                </TableCell>
                <TableCell className="tabular text-right font-semibold">
                  {money(totals.spend, currency)}
                </TableCell>
                <TableCell className="tabular hidden text-right @5xl:table-cell">
                  {num(totals.clicks)}
                </TableCell>
                <TableCell className="tabular hidden text-right @6xl:table-cell">
                  {pct(totals.imp ? totals.clicks / totals.imp : null, 2)}
                </TableCell>
                <TableCell className="tabular text-right">
                  {num(totals.leads, 1)}
                </TableCell>
                <TableCell className="tabular hidden text-right @3xl:table-cell">
                  {money(
                    totals.leads
                      ? Math.round(totals.spend / totals.leads)
                      : null,
                    currency,
                  )}
                </TableCell>
                <TableCell className="tabular hidden text-right @3xl:table-cell">
                  {num(totals.cust, 1)}
                </TableCell>
                <TableCell className="tabular hidden text-right @4xl:table-cell">
                  {money(
                    totals.cust ? Math.round(totals.spend / totals.cust) : null,
                    currency,
                  )}
                </TableCell>
                <TableCell className="tabular text-right font-semibold">
                  {money(totals.rev, currency)}
                </TableCell>
                <TableCell
                  className={cn(
                    "tabular pr-3 text-right font-semibold",
                    roasTone({ roas: totalRoas, spendMinor: totals.spend }),
                  )}
                >
                  {roas(totalRoas)}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </table>
      </div>

      {/* Narrow containers (phones, tablets with the sidebar open): one tappable card per row. */}
      <div className="space-y-3 @2xl:hidden">
        {sorted.length > 1 ? (
          <dl
            className="grid grid-cols-3 gap-3 rounded-xl border bg-muted/40 p-3"
            aria-label="Totals"
          >
            <Stat
              label="Total spend"
              value={shortMoney(totals.spend, currency)}
            />
            <Stat label="Revenue" value={shortMoney(totals.rev, currency)} />
            <Stat
              label="ROAS"
              value={roas(totalRoas)}
              className={cn(
                "font-semibold",
                roasTone({ roas: totalRoas, spendMinor: totals.spend }),
              )}
            />
          </dl>
        ) : null}
        <div
          className={cn(
            "flex items-center justify-between gap-3",
            rows.length === 0 && "hidden",
          )}
        >
          <p className="tabular text-sm text-muted-foreground">
            {q ? `${sorted.length} of ${rows.length}` : rows.length} {noun}
          </p>
          <div className="relative">
            <select
              aria-label="Sort by"
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(":");
                setSort({ key: key as Key, dir: Number(dir) === 1 ? 1 : -1 });
              }}
              className="h-10 appearance-none rounded-lg border border-input bg-background pr-9 pl-3 text-sm font-medium shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-popover"
            >
              {/* A sort picked from the table header (e.g. before rotating the phone) may not be in the list. */}
              {MOBILE_SORTS.some(
                ([k, dir]) => k === sort.key && dir === sort.dir,
              ) ? null : (
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
            <ChevronDownIcon
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
          </div>
        </div>
        {empty ? (
          <div className="rounded-xl border bg-card">{empty}</div>
        ) : null}
        <ul
          className="grid grid-cols-1 gap-2 @md:grid-cols-2"
          aria-label={levelLabel}
        >
          {sorted.map((r) => {
            const href = hrefFor(r.id);
            const body = (
              <>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <span
                      data-slot="row-name"
                      className="line-clamp-2 text-sm font-medium break-words"
                    >
                      {r.name}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <PlatformBadge platform={r.platform} />
                      {r.parentName ? (
                        <span className="truncate">{r.parentName}</span>
                      ) : null}
                    </span>
                  </div>
                  {href ? (
                    <ChevronRightIcon
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                  ) : null}
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2">
                  <Stat
                    label="Spend"
                    value={shortMoney(r.spendMinor, currency)}
                  />
                  <Stat
                    label="Revenue"
                    value={shortMoney(r.revenueMinor, currency)}
                  />
                  <Stat
                    label="ROAS"
                    value={roas(r.roas)}
                    className={cn("font-semibold", roasTone(r))}
                  />
                </dl>
                <p className="tabular mt-2 truncate border-t pt-2 text-xs text-muted-foreground">
                  {num(r.leads, 1)} leads · {num(r.customers, 1)} customers
                  {r.cacMinor !== null
                    ? ` · ${shortMoney(r.cacMinor, currency)} CAC`
                    : ""}
                </p>
              </>
            );
            return (
              <li key={r.id}>
                {href ? (
                  <Link
                    href={href}
                    className="block h-full rounded-xl border bg-card p-3 outline-none transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted/60"
                  >
                    {body}
                  </Link>
                ) : (
                  <div className="h-full rounded-xl border bg-card p-3">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
