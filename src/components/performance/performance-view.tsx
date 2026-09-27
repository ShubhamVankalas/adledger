"use client";

import { DownloadIcon, ScatterChartIcon, SearchIcon, SearchXIcon, TableIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { navProgress } from "@/components/app-shell";
import { ReportEmpty } from "@/components/reports/report-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHotkeys } from "@/lib/hotkeys";
import type { PerfLevel } from "@/lib/reports";
import type { PerformanceReport } from "@/lib/reports-performance";
import { cn } from "@/lib/utils";
import type { SavedView } from "@/lib/view-params";
import { COLUMN_BY_KEY, nextSort, sortRows, type PerfTargets } from "./columns";
import { downloadCsv, performanceCsv } from "./csv";
import { DisplayMenu } from "./display-menu";
import { PeekSheet, type PeekPeriod } from "./peek-sheet";
import { PerfTable } from "./perf-table";
import { QuadrantChart } from "./quadrant-chart";
import { useTableUrl } from "./use-table-url";
import { ViewsMenu } from "./views-menu";

export type LevelInfo = { key: PerfLevel; label: string; short: string; child: PerfLevel | null };

type Props = {
  report: PerformanceReport;
  levels: LevelInfo[];
  level: PerfLevel;
  /** Set when drilled into a campaign or ad set. */
  parent: string | null;
  currency: string;
  period: PeekPeriod;
  filename: string;
  views: SavedView[];
  canShareViews: boolean;
  targets: PerfTargets;
  /** The name filter the server applied (?q=). */
  serverQ: string;
};

const DEBOUNCE_MS = 250;

/** Space and Enter belong to a focused link or button; only take them over from the page itself. */
const focusOnControl = () => Boolean(document.activeElement?.closest("a[href], button, [role='button'], [role='radio'], summary"));
/** Params that belong to one screen and never carry over when the level changes. */
const TRANSIENT = ["peek", "q", "view", "parent", "level"];

/** Performance v2: toolbar, table or quadrant, and the row peek. All numbers arrive from SQL. */
export function PerformanceView({ report, levels, level, parent, currency, period, filename, views, canShareViews, targets, serverQ }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { state, set, params } = useTableUrl();
  const [pending, startTransition] = useTransition();
  const current = levels.find((l) => l.key === level)!;
  const child = current.child ? levels.find((l) => l.key === current.child)! : null;
  const grandchild = child?.child ? levels.find((l) => l.key === child.child)! : null;
  const noun = current.label.toLowerCase();

  // ---- name filter: instant on the rows we have, then the server recomputes rows and totals.
  const [q, setQ] = useState(serverQ);
  const [seenServerQ, setSeenServerQ] = useState(serverQ);
  if (serverQ !== seenServerQ) {
    // A view or Back changed ?q= underneath us: follow it.
    setSeenServerQ(serverQ);
    setQ(serverQ);
  }
  useEffect(() => {
    const next = q.trim();
    if (next === serverQ) return;
    const t = setTimeout(() => {
      const sp = new URLSearchParams(window.location.search);
      if (next) sp.set("q", next);
      else sp.delete("q");
      sp.delete("peek");
      startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q, serverQ, pathname, router]);
  useEffect(() => {
    if (pending) navProgress.start("perf-filter");
    else navProgress.done("perf-filter");
  }, [pending]);
  useEffect(() => () => navProgress.done("perf-filter"), []);

  const needle = q.trim().toLowerCase();
  const rows = useMemo(() => {
    const filtered =
      needle && needle !== serverQ.toLowerCase()
        ? report.rows.filter((r) => `${r.name} ${r.parentName ?? ""}`.toLowerCase().includes(needle))
        : report.rows;
    return sortRows(filtered, state.sort);
  }, [report.rows, needle, serverQ, state.sort]);
  const totalsStale = pending || q.trim() !== serverQ;

  const columns = useMemo(() => state.columns.map((k) => COLUMN_BY_KEY.get(k)!).filter(Boolean), [state.columns]);

  // ---- links
  const hrefWith = useCallback(
    (patch: Record<string, string>) => {
      const sp = new URLSearchParams(params.toString());
      for (const k of TRANSIENT) sp.delete(k);
      for (const [k, v] of Object.entries(patch)) sp.set(k, v);
      const qs = sp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );
  const childHref = useCallback((id: string) => (child ? hrefWith({ level: child.key, parent: id }) : null), [child, hrefWith]);
  const grandchildHref = useCallback((id: string) => (grandchild ? hrefWith({ level: grandchild.key, parent: id }) : null), [grandchild, hrefWith]);

  // ---- peek (Back closes it: opening pushes a history entry, closing pops it)
  const pushed = useRef(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const openPeek = useCallback(
    (id: string) => {
      setActiveId(id);
      const already = new URLSearchParams(window.location.search).has("peek");
      if (!already) pushed.current = true;
      set({ peek: id }, { push: !already });
    },
    [set],
  );
  const closePeek = useCallback(() => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else set({ peek: null });
  }, [set]);
  const peekIndex = state.peek ? rows.findIndex((r) => r.id === state.peek) : -1;
  const stepPeek = useCallback(
    (dir: 1 | -1) => {
      const next = rows[peekIndex + dir];
      if (!next) return;
      setActiveId(next.id);
      set({ peek: next.id });
    },
    [rows, peekIndex, set],
  );

  // ---- keyboard: J/K move, Space peeks, Enter opens, X toggles the comparison
  const move = (dir: 1 | -1) => {
    if (!rows.length || state.mode !== "table") return false;
    const i = rows.findIndex((r) => r.id === activeId);
    const next = rows[Math.min(rows.length - 1, Math.max(0, i === -1 ? 0 : i + dir))];
    setActiveId(next.id);
    document.querySelector(`[data-row-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const compareOn = report.compare !== null;
  // Δ lines only when the comparison period actually has something to compare with.
  const showDeltas = useMemo(
    () => compareOn && report.rows.some((r) => r.delta && Object.values(r.delta).some((v) => v !== null && v !== undefined)),
    [compareOn, report.rows],
  );
  useHotkeys([
    { id: "perf.next", keys: "j", label: "Next row", group: "Performance", run: () => move(1) },
    { id: "perf.prev", keys: "k", label: "Previous row", group: "Performance", run: () => move(-1) },
    {
      id: "perf.peek",
      keys: "space",
      label: "Preview the row",
      group: "Performance",
      run: () => {
        if (!activeId || focusOnControl()) return false;
        openPeek(activeId);
      },
    },
    {
      id: "perf.open",
      keys: "enter",
      label: "Open the row's ad sets or ads",
      group: "Performance",
      run: () => {
        const href = activeId ? childHref(activeId) : null;
        if (!href || focusOnControl()) return false;
        router.push(href);
      },
    },
    {
      id: "perf.compare",
      keys: "x",
      label: compareOn ? "Turn comparison off" : "Compare with the previous period",
      group: "Performance",
      run: () => {
        // Read the URL, not the props: a second press can land before the first one's report arrives.
        const sp = new URLSearchParams(window.location.search);
        if (sp.get("compare") !== "none") sp.set("compare", "none");
        else sp.delete("compare");
        startTransition(() => router.replace(`${pathname}?${sp}`, { scroll: false }));
      },
    },
    {
      id: "perf.mode",
      keys: "shift+q",
      label: state.mode === "table" ? "Show the quadrant chart" : "Show the table",
      group: "Performance",
      run: () => set({ mode: state.mode === "table" ? "quadrant" : "table" }),
    },
  ]);

  const empty =
    report.rows.length === 0 && !serverQ ? (
      <ReportEmpty icon={SearchXIcon} title={`No ${noun} with spend or conversions in this period`}>
        Try a longer date range{parent ? "" : " or another platform"}.
      </ReportEmpty>
    ) : rows.length === 0 ? (
      <ReportEmpty icon={SearchIcon} title={`No ${noun} match “${q.trim() || serverQ}”`}>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setQ("")}>
          Clear filter
        </Button>
      </ReportEmpty>
    ) : null;

  const levelNav = (
    <nav aria-label="Report level" className="grid h-10 grid-cols-3 items-center rounded-[7px] bg-fill p-0.5 @3xl:flex @3xl:h-7 @3xl:shrink-0">
      {levels.map((l) => {
        const active = level === l.key;
        return (
          <Link
            key={l.key}
            href={hrefWith(l.key === "campaign" ? {} : { level: l.key })}
            aria-current={active && !parent ? "page" : undefined}
            className={cn(
              "flex h-full items-center justify-center rounded-[5px] px-2.5 text-ui font-medium whitespace-nowrap text-muted-foreground outline-none transition-[color,background-color,box-shadow] duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              active && "bg-surface text-foreground shadow-sm",
            )}
          >
            <span className="@5xl:hidden">{l.short}</span>
            <span className="hidden @5xl:inline">{l.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="@container space-y-3">
      <div className="flex flex-col gap-2 @3xl:flex-row @3xl:items-center @3xl:gap-2">
        {levelNav}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 @3xl:justify-end">
          <div className="relative min-w-0 flex-1 @3xl:max-w-64">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-faint" />
            <Input
              type="search"
              name="q"
              data-hotkey-search
              autoComplete="off"
              spellCheck={false}
              placeholder={`Filter ${noun}…`}
              aria-label={`Filter ${noun} by name`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && q) {
                  e.preventDefault();
                  setQ("");
                }
              }}
              className="h-10 pr-8 pl-8 @3xl:h-7 [&::-webkit-search-cancel-button]:hidden"
            />
            {q ? (
              <button
                type="button"
                aria-label="Clear filter"
                onClick={() => setQ("")}
                className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring @3xl:size-6"
              >
                <XIcon className="size-3.5" />
              </button>
            ) : null}
          </div>
          <div role="radiogroup" aria-label="Show as" className="flex h-10 shrink-0 items-center rounded-[7px] bg-fill p-0.5 @3xl:h-7">
            {(
              [
                ["table", "Table", TableIcon],
                ["quadrant", "Quadrant", ScatterChartIcon],
              ] as const
            ).map(([m, label, Icon]) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={state.mode === m}
                aria-label={label}
                title={label}
                onClick={() => set({ mode: m })}
                className={cn(
                  "flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-ui font-medium text-muted-foreground outline-none transition-[color,background-color,box-shadow] duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  state.mode === m && "bg-surface text-foreground shadow-sm",
                )}
              >
                <Icon aria-hidden className="size-3.5" />
                <span className="hidden @6xl:inline">{label}</span>
              </button>
            ))}
          </div>
          <DisplayMenu
            preset={state.preset}
            columns={state.columns}
            density={state.density}
            onPreset={(p) => set({ preset: p })}
            onColumns={(cols) => set({ preset: "custom", columns: cols })}
            onDensity={(d) => set({ density: d })}
          />
          <ViewsMenu page="performance" initialViews={views} canShare={canShareViews} params={params} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadCsv(performanceCsv(rows, currency), filename)}
            disabled={!rows.length}
            aria-label="Export CSV"
            title="Export CSV"
            className="hidden h-10 w-10 shrink-0 px-0 font-normal @md:inline-flex @3xl:h-7 @3xl:w-7 @7xl:w-auto @7xl:px-2.5"
          >
            <DownloadIcon aria-hidden className="text-muted-foreground" />
            <span className="hidden @7xl:inline">Export</span>
          </Button>
        </div>
      </div>

      <div className={cn("transition-opacity duration-150", pending && "opacity-60")} aria-busy={pending || undefined}>
        {state.mode === "quadrant" ? (
          <QuadrantChart
            rows={rows}
            split={report.split}
            currency={currency}
            noun={noun}
            roasLabel={targets.roas ? "target" : "break-even"}
            onPeek={openPeek}
            peekId={state.peek}
          />
        ) : (
          <PerfTable
            rows={rows}
            columns={columns}
            sort={state.sort}
            onSort={(k) => set({ sort: nextSort(state.sort, k) })}
            onSortPreset={(s) => set({ sort: s })}
            density={state.density}
            compare={showDeltas}
            totals={report.totals}
            totalsDelta={report.totalsDelta}
            totalsStale={totalsStale}
            currency={currency}
            targets={targets}
            levelLabel={current.label}
            childHref={childHref}
            childLabel={child?.label ?? null}
            onPeek={openPeek}
            activeId={activeId}
            peekId={state.peek}
            empty={empty}
          />
        )}
      </div>

      <PeekSheet
        id={state.peek}
        level={level}
        row={rows.find((r) => r.id === state.peek) ?? report.rows.find((r) => r.id === state.peek)}
        period={period}
        currency={currency}
        targets={targets}
        childLabel={child?.label ?? null}
        childHref={childHref}
        grandchildHref={grandchildHref}
        onClose={closePeek}
        onStep={peekIndex === -1 ? null : stepPeek}
        position={peekIndex === -1 ? null : { index: peekIndex, total: rows.length }}
      />
    </div>
  );
}
