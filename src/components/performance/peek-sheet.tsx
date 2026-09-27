"use client";

import { ArrowRightIcon, ChevronDownIcon, ChevronUpIcon, RotateCwIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { loadPeekAction } from "@/app/(app)/performance/actions";
import { UserAvatar } from "@/components/avatars";
import { PlatformBadge } from "@/components/platform-badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { credit, moneyShort, platformLabel, plural } from "@/lib/format";
import { ratioX } from "@/lib/metrics";
import type { PerfLevel } from "@/lib/reports";
import type { PerformancePeek, PerfRowV2 } from "@/lib/reports-performance";
import { cn } from "@/lib/utils";
import { cellLight, DeltaLine, gapSentence, StatusPill, StoplightDot } from "./cells";
import { COLUMN_BY_KEY, formatValue, type ColumnKey, type PerfTargets } from "./columns";
import { QUADRANTS } from "./quadrant-chart";
import { TrendChart } from "./trend-chart";

// The row peek: a sheet (right on desktop, bottom on phones) with the row's numbers, its daily
// trend, its top ad sets or ads, and the people it brought in. The URL carries ?peek=<id>, so Back
// closes it and a link reopens it. Details load on demand through a read-only server action and
// are cached per row and period for the life of the page.

export type PeekPeriod = { start: string; end: string; model: string; comparison: { start: string; end: string } | null };

type Props = {
  id: string | null;
  level: PerfLevel;
  /** The row as the table has it (instant header and numbers while the details load). */
  row: PerfRowV2 | undefined;
  period: PeekPeriod;
  currency: string;
  targets: PerfTargets;
  childLabel: string | null;
  childHref: (id: string) => string | null;
  /** Link for a child row's own children (an ad set's ads), when there is a deeper level. */
  grandchildHref: (childId: string) => string | null;
  onClose: () => void;
  onStep: ((dir: 1 | -1) => void) | null;
  position: { index: number; total: number } | null;
};

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; peek: PerformancePeek | null };

const KPIS: ColumnKey[] = ["spendMinor", "revenueMinor", "roas", "customers"];

export function PeekSheet(props: Props) {
  const { id, onClose } = props;
  const mobile = useIsMobile();
  // Keep the last row on screen while the sheet animates closed.
  const [shown, setShown] = useState(id);
  if (id && id !== shown) setShown(id);

  return (
    <Sheet open={id !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <SheetContent
        side={mobile ? "bottom" : "right"}
        className={cn("gap-0 p-0", mobile ? "max-h-[88dvh] rounded-t-xl" : "w-full data-[side=right]:sm:max-w-[30rem]")}
        onKeyDown={(e) => {
          // J / K step through rows without closing the sheet (the page's shortcuts pause while a dialog is open).
          if (!props.onStep || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select")) return;
          if (e.key === "j" || e.key === "k") {
            e.preventDefault();
            props.onStep(e.key === "j" ? 1 : -1);
          }
        }}
      >
        {shown ? (
          <PeekBody
            key={`${props.level}:${shown}:${props.period.start}:${props.period.end}:${props.period.model}:${props.period.comparison?.start ?? ""}`}
            {...props}
            id={shown}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

const cache = new Map<string, PerformancePeek | null>();

function PeekBody({ id, level, row: tableRow, period, currency, targets, childLabel, childHref, grandchildHref, onStep, position }: Props & { id: string }) {
  const cacheKey = `${level}:${id}:${period.start}:${period.end}:${period.model}:${period.comparison?.start ?? ""}`;
  const [load, setLoad] = useState<Load>(() => (cache.has(cacheKey) ? { status: "ready", peek: cache.get(cacheKey)! } : { status: "loading" }));
  const [attempt, setAttempt] = useState(0);
  const cmpStart = period.comparison?.start ?? null;
  const cmpEnd = period.comparison?.end ?? null;

  useEffect(() => {
    if (cache.has(cacheKey) && attempt === 0) return;
    let active = true;
    const comparison = cmpStart && cmpEnd ? { start: cmpStart, end: cmpEnd } : null;
    loadPeekAction({ level, id, start: period.start, end: period.end, model: period.model, comparison })
      .then((res) => {
        if (!active) return;
        if (!res.ok) return setLoad({ status: "error", message: res.message ?? "Couldn't load the details." });
        cache.set(cacheKey, res.peek ?? null);
        setLoad({ status: "ready", peek: res.peek ?? null });
      })
      .catch(() => {
        if (active) setLoad({ status: "error", message: "Couldn't reach the server. Check your connection." });
      });
    return () => {
      active = false;
    };
  }, [cacheKey, attempt, level, id, period.start, period.end, period.model, cmpStart, cmpEnd]);

  const retry = () => {
    setLoad({ status: "loading" });
    setAttempt((a) => a + 1);
  };

  const peek = load.status === "ready" ? load.peek : null;
  const row = peek?.row ?? tableRow;

  if (load.status === "ready" && !peek) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-8 text-center">
        <SheetTitle>Not found</SheetTitle>
        <SheetDescription>This row isn&rsquo;t in this workspace any more. It may have been removed by a sync.</SheetDescription>
      </div>
    );
  }

  const platform = row ? platformLabel(row.platform) : "";
  const quadrant = tableRow?.quadrant ? QUADRANTS[tableRow.quadrant] : null;
  const href = childHref(id);

  return (
    <>
      <SheetHeader className="gap-2 border-b px-5 pt-4 pb-4">
        <div className="flex min-w-0 items-center gap-2 pr-16 text-caption text-muted-foreground">
          {row ? <PlatformBadge platform={row.platform} /> : <Skeleton className="h-4 w-16" />}
          {row?.parentName ? (
            <>
              <span aria-hidden className="text-fg-faint">/</span>
              <span className="truncate" title={row.parentName}>
                {row.parentName}
              </span>
            </>
          ) : null}
        </div>
        <SheetTitle className="text-title leading-7 break-words text-balance">{row?.name ?? "Loading…"}</SheetTitle>
        <SheetDescription className="sr-only">Spend, revenue, trend and the people this {level === "ad_group" ? "ad set" : level.replace("_", " ")} brought in.</SheetDescription>
        <div className="flex flex-wrap items-center gap-1.5">
          {row?.status ? <StatusPill status={row.status} /> : null}
          {quadrant ? (
            <span className={cn("inline-flex h-[18px] items-center rounded-full bg-fill px-1.5 text-micro font-medium", quadrant.text)} title={quadrant.hint}>
              {quadrant.label}
            </span>
          ) : null}
        </div>
        {onStep ? (
          <div className="absolute top-3 right-11 flex items-center">
            <Button variant="ghost" size="icon-sm" aria-label="Previous row" onClick={() => onStep(-1)} disabled={!position || position.index <= 0}>
              <ChevronUpIcon />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next row" onClick={() => onStep(1)} disabled={!position || position.index >= position.total - 1}>
              <ChevronDownIcon />
            </Button>
          </div>
        ) : null}
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
        {row ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            {KPIS.map((k) => {
              const col = COLUMN_BY_KEY.get(k)!;
              const light = cellLight(col, row, targets, currency);
              return (
                <div key={k} className="min-w-0">
                  <dt className="text-caption text-muted-foreground">{col.label}</dt>
                  <dd className="num mt-0.5 flex items-center gap-1.5 text-title-sm">
                    {light ? <StoplightDot light={light.light} target={light.target} /> : null}
                    {formatValue(col.format, row[k as keyof PerfRowV2] as number | null, currency, true)}
                  </dd>
                  {row.delta ? <DeltaLine change={row.delta[k as keyof typeof row.delta]} polarity={col.polarity} className="justify-start" /> : null}
                </div>
              );
            })}
          </dl>
        ) : (
          <div className="grid grid-cols-4 gap-4">
            {KPIS.map((k) => (
              <Skeleton key={k} className="h-11" />
            ))}
          </div>
        )}

        <section aria-labelledby="peek-trend">
          <h3 id="peek-trend" className="mb-2 text-ui font-medium">
            Trend
          </h3>
          {peek ? <TrendChart data={peek.trend} currency={currency} /> : load.status === "error" ? <LoadError message={load.message} onRetry={retry} /> : <Skeleton className="h-[156px]" />}
        </section>

        {row && (row.platformConversions ?? 0) > 0 ? (
          <section aria-labelledby="peek-gap" className="rounded-lg bg-fill/70 p-3">
            <h3 id="peek-gap" className="text-ui font-medium">
              Platform gap
            </h3>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <GapStat label={`${platform} says`} value={credit(row.platformConversions)} />
              <GapStat label="AdLedger verified" value={credit(row.verifiedConversions)} />
              <GapStat label="Gap" value={row.platformGap === null ? "—" : formatValue("gap", row.platformGap, currency)} tone={row.platformGap !== null && row.platformGap >= 0.5} />
            </div>
            <p className="mt-2 text-caption text-pretty text-muted-foreground">{gapSentence(platform, row)} Verified means a lead or a new customer AdLedger matched to a real person.</p>
          </section>
        ) : null}

        {childLabel ? (
          <section aria-labelledby="peek-children">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 id="peek-children" className="text-ui font-medium">
                {childLabel}
              </h3>
              {peek && peek.childCount > 0 ? <span className="num text-caption text-muted-foreground">{peek.childCount}</span> : null}
            </div>
            {peek ? (
              peek.children.length ? (
                <ul className="divide-y">
                  {peek.children.map((c) => {
                    const deeper = grandchildHref(c.id);
                    const body = (
                      <>
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="num shrink-0 text-muted-foreground">{moneyShort(c.spendMinor, currency)}</span>
                        <span className={cn("num w-14 shrink-0 text-right font-medium", (c.roas ?? 0) >= (targets.roas ?? 1) ? "text-positive" : (c.spendMinor ?? 0) > 0 ? "text-negative" : "text-muted-foreground")}>
                          {ratioX(c.roas)}
                        </span>
                      </>
                    );
                    return (
                      <li key={c.id}>
                        {deeper ? (
                          <Link href={deeper} className="-mx-2 flex h-9 items-center gap-3 rounded-md px-2 text-ui outline-none hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring">
                            {body}
                          </Link>
                        ) : (
                          <div className="flex h-9 items-center gap-3 text-ui">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-caption text-muted-foreground">No {childLabel.toLowerCase()} had spend or conversions in this period.</p>
              )
            ) : load.status === "loading" ? (
              <ListSkeleton />
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="peek-contacts">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h3 id="peek-contacts" className="text-ui font-medium">
              People it brought in
            </h3>
            {peek && peek.contactCount > 0 ? <span className="num text-caption text-muted-foreground">{peek.contactCount}</span> : null}
          </div>
          {peek ? (
            peek.contacts.length ? (
              <>
                <ul className="divide-y">
                  {peek.contacts.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/contacts/${c.id}`}
                        className="-mx-2 flex h-11 items-center gap-2.5 rounded-md px-2 text-ui outline-none hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <UserAvatar id={c.id} name={c.label} email={c.label} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{c.label}</span>
                          <span className="block truncate text-caption text-muted-foreground capitalize">{c.lifecycle}</span>
                        </span>
                        <span className="num shrink-0 text-right">
                          {c.revenueMinor ? <span className="font-medium">{moneyShort(c.revenueMinor, currency)}</span> : <span className="text-muted-foreground">{c.leadCredit ? `${credit(c.leadCredit)} lead` : "—"}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {peek.contactCount > peek.contacts.length ? (
                  <p className="mt-2 text-caption text-muted-foreground">
                    Top {peek.contacts.length} by revenue of {plural(peek.contactCount, "person", "people")}.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg bg-fill/60 px-3 py-3 text-caption text-muted-foreground">
                <UsersIcon aria-hidden className="size-4 shrink-0" />
                Nobody was credited to it in this period with the {period.model.replace("_", " ")} model.
              </div>
            )
          ) : load.status === "loading" ? (
            <ListSkeleton rows={4} avatar />
          ) : null}
        </section>
      </div>

      {href && childLabel ? (
        <SheetFooter className="flex-row items-center justify-between gap-3 border-t px-5 py-3">
          <span className="num text-caption text-muted-foreground">{position ? `${position.index + 1} of ${position.total}` : null}</span>
          <Button render={<Link href={href} />} size="default">
            Open {childLabel.toLowerCase()}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </SheetFooter>
      ) : null}
    </>
  );
}

function GapStat({ label, value, tone }: { label: string; value: string; tone?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-caption text-muted-foreground">{label}</p>
      <p className={cn("num text-title-sm", tone && "text-warning-foreground")}>{value}</p>
    </div>
  );
}

function ListSkeleton({ rows = 3, avatar = false }: { rows?: number; avatar?: boolean }) {
  return (
    <div className="space-y-2.5 pt-1" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          {avatar ? <Skeleton className="size-6 rounded-full" /> : null}
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-negative-soft px-3 py-2.5 text-caption text-negative">
      <span>{message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCwIcon data-icon="inline-start" />
        Retry
      </Button>
    </div>
  );
}
