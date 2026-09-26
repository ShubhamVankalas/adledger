"use client";

import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { NativeSelect } from "@/components/native-select";
import { PlatformBadge } from "@/components/platform-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, num, pct, roas } from "@/lib/format";
import { toMajor } from "@/lib/money";
import type { PerfRow } from "@/lib/reports";
import { cn } from "@/lib/utils";

type Key = "name" | "spendMinor" | "clicks" | "ctr" | "leads" | "cplMinor" | "customers" | "cacMinor" | "revenueMinor" | "roas";

const COLS: { key: Key; label: string; className?: string }[] = [
  { key: "spendMinor", label: "Spend" },
  { key: "clicks", label: "Clicks", className: "hidden lg:table-cell" },
  { key: "ctr", label: "CTR", className: "hidden xl:table-cell" },
  { key: "leads", label: "Leads" },
  { key: "cplMinor", label: "CPL", className: "hidden md:table-cell" },
  { key: "customers", label: "Customers", className: "hidden md:table-cell" },
  { key: "cacMinor", label: "CAC", className: "hidden lg:table-cell" },
  { key: "revenueMinor", label: "Revenue" },
  { key: "roas", label: "ROAS" },
];

const SORT_BUTTON = "inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

const MOBILE_SORTS: [Key, 1 | -1, string][] = [
  ["spendMinor", -1, "Highest spend"],
  ["revenueMinor", -1, "Highest revenue"],
  ["roas", -1, "Best ROAS"],
  ["roas", 1, "Worst ROAS"],
  ["leads", -1, "Most leads"],
  ["name", 1, "Name (A–Z)"],
];

function MobileStat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular truncate text-sm", className)}>{value}</dd>
    </div>
  );
}

export function PerformanceTable({
  rows,
  currency,
  childHref,
  levelLabel,
  filename,
}: {
  rows: PerfRow[];
  currency: string;
  childHref: ((id: string) => string) | string | null;
  levelLabel: string;
  filename: string;
}) {
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: "spendMinor", dir: -1 });
  const [q, setQ] = useState("");
  const hrefFor = (id: string) => (typeof childHref === "string" ? childHref.replace("__ID__", id) : childHref ? childHref(id) : null);

  const sorted = useMemo(() => {
    const f = q ? rows.filter((r) => `${r.name} ${r.parentName ?? ""}`.toLowerCase().includes(q.toLowerCase())) : rows;
    return [...f].sort((a, b) => {
      const av = a[sort.key] ?? -Infinity;
      const bv = b[sort.key] ?? -Infinity;
      return (typeof av === "string" ? av.localeCompare(String(bv)) : Number(av) - Number(bv)) * sort.dir;
    });
  }, [rows, sort, q]);

  const totals = useMemo(() => {
    const t = sorted.reduce(
      (s, r) => ({ spend: s.spend + r.spendMinor, clicks: s.clicks + r.clicks, imp: s.imp + r.impressions, leads: s.leads + r.leads, cust: s.cust + r.customers, rev: s.rev + r.revenueMinor }),
      { spend: 0, clicks: 0, imp: 0, leads: 0, cust: 0, rev: 0 },
    );
    return t;
  }, [sorted]);

  const maxRoas = Math.max(1, ...sorted.map((r) => r.roas ?? 0));

  const exportCsv = () => {
    const head = ["name", "platform", "parent", "spend", "impressions", "clicks", "leads", "customers", "revenue", "roas", "cpl", "cac", "currency"];
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
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const Th = ({ k, label, className }: { k: Key; label: string; className?: string }) => (
    <TableHead className={cn("text-right", className)} aria-sort={sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 1 ? -1 : 1) : -1 }))}
        className={cn(SORT_BUTTON, sort.key === k && "text-foreground")}
      >
        {label}
        {sort.key === k ? sort.dir === -1 ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" /> : null}
      </button>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          placeholder={`Filter ${levelLabel.toLowerCase()}…`}
          aria-label={`Filter ${levelLabel.toLowerCase()}`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 min-w-0 flex-1 sm:max-w-64"
        />
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <DownloadIcon /> Export CSV
        </Button>
      </div>

      <div className="hidden overflow-hidden rounded-xl border bg-card sm:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="min-w-56" aria-sort={sort.key === "name" ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                <button
                  type="button"
                  onClick={() => setSort((s) => ({ key: "name", dir: s.key === "name" ? (s.dir === 1 ? -1 : 1) : 1 }))}
                  className={cn(SORT_BUTTON, sort.key === "name" && "text-foreground")}
                >
                  {levelLabel}
                </button>
              </TableHead>
              {COLS.map((c) => (
                <Th key={c.key} k={c.key} label={c.label} className={c.className} />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLS.length + 1} className="h-32 text-center text-muted-foreground">
                  No {levelLabel.toLowerCase()} with spend or conversions in this period.
                </TableCell>
              </TableRow>
            ) : null}
            {sorted.map((r) => {
              const href = hrefFor(r.id);
              const good = (r.roas ?? 0) >= 1;
              return (
                <TableRow key={r.id} className="group">
                  <TableCell className="max-w-80">
                    <div className="flex items-center gap-2">
                      <PlatformBadge platform={r.platform} />
                      <div className="min-w-0">
                        {href ? (
                          <Link href={href} className="flex items-center gap-1 truncate font-medium hover:text-primary">
                            <span className="truncate">{r.name}</span>
                            <ChevronRightIcon className="size-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                        ) : (
                          <div className="truncate font-medium">{r.name}</div>
                        )}
                        {r.parentName ? <div className="truncate text-xs text-muted-foreground">{r.parentName}</div> : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">{money(r.spendMinor, currency)}</TableCell>
                  <TableCell className="tabular hidden text-right lg:table-cell">{num(r.clicks)}</TableCell>
                  <TableCell className="tabular hidden text-right xl:table-cell">{pct(r.ctr, 2)}</TableCell>
                  <TableCell className="tabular text-right">{num(r.leads, 1)}</TableCell>
                  <TableCell className="tabular hidden text-right md:table-cell">{money(r.cplMinor, currency)}</TableCell>
                  <TableCell className="tabular hidden text-right md:table-cell">{num(r.customers, 1)}</TableCell>
                  <TableCell className="tabular hidden text-right lg:table-cell">{money(r.cacMinor, currency)}</TableCell>
                  <TableCell className="tabular text-right font-medium">{money(r.revenueMinor, currency)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted sm:block">
                        <div className={cn("h-full rounded-full", good ? "bg-success" : "bg-destructive/70")} style={{ width: `${Math.min(100, ((r.roas ?? 0) / maxRoas) * 100)}%` }} />
                      </div>
                      <span className={cn("tabular w-14 text-right font-semibold", good ? "text-success" : r.spendMinor > 0 ? "text-destructive" : "")}>{roas(r.roas)}</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          {sorted.length > 1 ? (
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">Total ({sorted.length})</TableCell>
                <TableCell className="tabular text-right font-medium">{money(totals.spend, currency)}</TableCell>
                <TableCell className="tabular hidden text-right lg:table-cell">{num(totals.clicks)}</TableCell>
                <TableCell className="tabular hidden text-right xl:table-cell">{pct(totals.imp ? totals.clicks / totals.imp : null, 2)}</TableCell>
                <TableCell className="tabular text-right">{num(totals.leads, 1)}</TableCell>
                <TableCell className="tabular hidden text-right md:table-cell">{money(totals.leads ? Math.round(totals.spend / totals.leads) : null, currency)}</TableCell>
                <TableCell className="tabular hidden text-right md:table-cell">{num(totals.cust, 1)}</TableCell>
                <TableCell className="tabular hidden text-right lg:table-cell">{money(totals.cust ? Math.round(totals.spend / totals.cust) : null, currency)}</TableCell>
                <TableCell className="tabular text-right font-medium">{money(totals.rev, currency)}</TableCell>
                <TableCell className="tabular text-right font-semibold">{roas(totals.spend ? totals.rev / totals.spend : null)}</TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>

      {/* Phones: one card per row with the four numbers that matter. */}
      <div className="space-y-2 sm:hidden">
        <NativeSelect
          aria-label="Sort by"
          value={`${sort.key}:${sort.dir}`}
          onChange={(e) => {
            const [key, dir] = e.target.value.split(":");
            setSort({ key: key as Key, dir: Number(dir) === 1 ? 1 : -1 });
          }}
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
        </NativeSelect>
        {sorted.length === 0 ? (
          <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">No {levelLabel.toLowerCase()} with spend or conversions in this period.</p>
        ) : null}
        <ul className="space-y-2" aria-label={levelLabel}>
          {sorted.map((r) => {
            const href = hrefFor(r.id);
            const good = (r.roas ?? 0) >= 1;
            const name = (
              <>
                <span className="line-clamp-2 font-medium break-words">{r.name}</span>
                {r.parentName ? <span className="block truncate text-xs text-muted-foreground">{r.parentName}</span> : null}
              </>
            );
            return (
              <li key={r.id} className="rounded-xl border bg-card p-3">
                <div className="flex items-start gap-2">
                  <PlatformBadge platform={r.platform} />
                  {href ? (
                    <Link href={href} className="-my-1 flex min-h-9 min-w-0 flex-1 items-center gap-1 text-sm hover:text-primary">
                      <span className="min-w-0 flex-1">{name}</span>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1 text-sm">{name}</div>
                  )}
                </div>
                <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
                  <MobileStat label="Spend" value={money(r.spendMinor, currency, true)} />
                  <MobileStat label="Leads" value={num(r.leads, 1)} />
                  <MobileStat label="Revenue" value={money(r.revenueMinor, currency, true)} />
                  <MobileStat
                    label="ROAS"
                    value={roas(r.roas)}
                    className={cn("font-semibold", good ? "text-success" : r.spendMinor > 0 ? "text-destructive" : "")}
                  />
                </dl>
              </li>
            );
          })}
        </ul>
        {sorted.length > 1 ? (
          <div className="flex items-center justify-between rounded-xl border bg-muted/50 px-3 py-2 text-xs font-medium">
            <span>Total ({sorted.length})</span>
            <span className="tabular">
              {money(totals.spend, currency, true)} → {money(totals.rev, currency, true)} · {roas(totals.spend ? totals.rev / totals.spend : null)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
