"use client";

import { BellIcon, BellOffIcon, EyeIcon, EyeOffIcon, RadioTowerIcon, SlidersHorizontalIcon, WindIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hotkeyText, useHotkeys } from "@/lib/hotkeys";
import { money, platformLabel } from "@/lib/format";
import type { LiveFeedItem, LiveSnapshot } from "@/lib/reports-live";
import { cn } from "@/lib/utils";
import { LiveCounters } from "./counters";
import { FeedRow, feedItemText, useNow } from "./feed-row";
import { HourlyChart } from "./hourly-chart";
import { LiveCard, LiveCardEmpty } from "./live-card";
import styles from "./live.module.css";
import { HIDDEN_AMOUNT, useLivePref } from "./live-prefs";
import { Segmented } from "./segmented";
import { TopPages, TopSources } from "./top-lists";
import { useLiveStream, type LiveStatus } from "./use-live-stream";
import { FEED_FILTERS, HOURLY_METRICS, type FeedFilter, type HourlyMetric } from "./options";


const STATUS: Record<LiveStatus, { label: string; hint: string }> = {
  connecting: { label: "Connecting…", hint: "Opening the live connection." },
  live: { label: "Live", hint: "New visits, leads and payments appear within a couple of seconds." },
  paused: { label: "Paused", hint: "Paused while this tab is in the background. It catches up when you come back." },
  reconnecting: { label: "Reconnecting…", hint: "The connection dropped. Retrying on its own; nothing is lost." },
  busy: { label: "Busy", hint: "Too many live tabs are open for this workspace. Retrying shortly." },
};

/** Keep ?feed= and ?chart= in the URL without a server round trip, so a view can be shared. */
function useUrlState<T extends string>(key: string, initial: T, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState(initial);
  const set = useCallback(
    (v: T) => {
      setValue(v);
      const url = new URL(window.location.href);
      if (v === fallback) url.searchParams.delete(key);
      else url.searchParams.set(key, v);
      window.history.replaceState(window.history.state, "", url);
    },
    [key, fallback],
  );
  return [value, set];
}

function StatusChip({ status }: { status: LiveStatus }) {
  const s = STATUS[status];
  return (
    <span title={s.hint} className="inline-flex h-7 items-center gap-2 rounded-full px-2 text-caption font-medium text-muted-foreground">
      <span aria-hidden className={styles.pulse} data-state={status} />
      <span role="status" aria-live="polite" className={cn(status === "live" && "text-foreground")}>
        {s.label}
      </span>
    </span>
  );
}

function PrefToggle({ pressed, onChange, on, off, label, keys }: { pressed: boolean; onChange: (v: boolean) => void; on: React.ReactNode; off: React.ReactNode; label: string; keys: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle size="sm" variant="outline" pressed={pressed} onPressedChange={onChange} aria-label={label} aria-keyshortcuts={keys.toUpperCase()}>
            {pressed ? on : off}
          </Toggle>
        }
      />
      <TooltipContent>
        {label} <kbd className="kbd ml-1">{hotkeyText(keys)}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

export function LiveView({
  initialSnapshot,
  initialItems,
  initialCursor,
  initialFilter,
  initialMetric,
  hasPixel,
  canSetup,
}: {
  initialSnapshot: LiveSnapshot;
  initialItems: LiveFeedItem[];
  initialCursor: string;
  initialFilter: FeedFilter;
  initialMetric: HourlyMetric;
  /** A pixel site exists (otherwise the empty feed explains how to add one). */
  hasPixel: boolean;
  canSetup: boolean;
}) {
  const [streamer, setStreamer] = useLivePref("streamer");
  const [saleAlerts, setSaleAlerts] = useLivePref("saleAlerts");
  const [filter, setFilter] = useUrlState<FeedFilter>("feed", initialFilter, "all");
  const [metric, setMetric] = useUrlState<HourlyMetric>("chart", initialMetric, "revenue");
  const [announce, setAnnounce] = useState("");
  const [showAll, setShowAll] = useState(false);

  const onArrive = useCallback(
    (items: LiveFeedItem[]) => {
      // Screen readers hear leads and money, not every page view.
      const notable = items.filter((i) => i.kind === "lead" || i.kind === "payment" || i.kind === "refund");
      if (notable.length) setAnnounce(notable.map((i) => feedItemText(i, streamer)).join(". "));
      if (!saleAlerts) return;
      const sales = items.filter((i) => i.kind === "payment");
      if (sales.length > 2) {
        toast(`${sales.length} new sales`, { description: "Open the feed for the details." });
        return;
      }
      for (const s of sales) {
        const amount = streamer || s.amountMinor === null || !s.currency ? null : money(s.amountMinor, s.currency);
        toast(amount ? `New sale ${amount}` : "New sale", {
          description: [s.who, s.platform ? `first touch ${platformLabel(s.platform)}` : null, s.campaign].filter(Boolean).join(" · ") || undefined,
        });
      }
    },
    [saleAlerts, streamer],
  );

  const { snapshot, items, status, fresh, settle } = useLiveStream({ initialSnapshot, initialItems, initialCursor, onArrive });
  const now = useNow(Date.parse(initialSnapshot.asOf));

  useHotkeys([
    { id: "live.streamer", keys: "s", label: "Streamer mode (hide amounts)", group: "Live", run: () => setStreamer(!streamer) },
    { id: "live.alerts", keys: "a", label: "Sale alerts on or off", group: "Live", run: () => setSaleAlerts(!saleAlerts) },
  ]);

  const kinds = FEED_FILTERS.find((f) => f.value === filter)!.kinds;
  const shown = items.filter((i) => kinds.includes(i.kind));
  const PHONE_LIMIT = 12;

  return (
    <>
      <PageHeader title="Live" description="Visitors, leads and payments as they happen">
        <StatusChip status={status} />
        <PrefToggle
          pressed={streamer}
          onChange={setStreamer}
          on={
            <>
              <EyeOffIcon aria-hidden />
              <span className="hidden sm:inline">Amounts hidden</span>
            </>
          }
          off={
            <>
              <EyeIcon aria-hidden />
              <span className="hidden sm:inline">Streamer mode</span>
            </>
          }
          label="Streamer mode: hide every amount on screen"
          keys="s"
        />
        <PrefToggle
          pressed={saleAlerts}
          onChange={setSaleAlerts}
          on={
            <>
              <BellIcon aria-hidden />
              <span className="hidden xl:inline">Sale alerts</span>
            </>
          }
          off={
            <>
              <BellOffIcon aria-hidden />
              <span className="hidden xl:inline">Sale alerts</span>
            </>
          }
          label={saleAlerts ? "Sale alerts are on" : "Sale alerts are off"}
          keys="a"
        />
      </PageHeader>
      <PageBody>
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>
        <LiveCounters snapshot={snapshot} status={status} hideMoney={streamer} />

        <div className="grid gap-3 lg:grid-cols-12 lg:gap-4">
          <LiveCard
            headingId="live-feed"
            title="Activity"
            description="Newest first, last 24 hours"
            className="lg:col-span-7 lg:h-[46rem]"
            bodyClassName="flex flex-col px-0 pb-0 md:px-0"
            action={
              <Segmented
                label="Show"
                value={filter}
                onChange={(v) => {
                  setFilter(v);
                  setShowAll(false);
                }}
                options={FEED_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
              />
            }
          >
            {shown.length === 0 ? (
              filter !== "all" && items.length > 0 ? (
                <LiveCardEmpty icon={SlidersHorizontalIcon} title={`No ${FEED_FILTERS.find((f) => f.value === filter)!.label.toLowerCase()} in the last 24 hours`} action={<Button size="sm" variant="outline" onClick={() => setFilter("all")}>Show everything</Button>}>
                  Other activity is still coming in.
                </LiveCardEmpty>
              ) : hasPixel ? (
                <LiveCardEmpty icon={WindIcon} title="Quiet for now">
                  Nothing in the last 24 hours. New visits, leads and payments appear here the moment they happen.
                </LiveCardEmpty>
              ) : (
                <LiveCardEmpty
                  icon={RadioTowerIcon}
                  title="Waiting for your first visitor"
                  action={
                    canSetup ? (
                      <Button size="sm" render={<Link href="/settings/workspace/tracking" />}>
                        Set up tracking
                      </Button>
                    ) : null
                  }
                >
                  Add the AdLedger pixel to your site and visits show up here within seconds.
                </LiveCardEmpty>
              )
            ) : (
              <div
                tabIndex={0}
                aria-label="Live activity feed"
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md outline-none [scrollbar-gutter:stable] focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ol aria-labelledby="live-feed" className="divide-y divide-border/70 pb-1">
                  {shown.map((item, idx) => (
                    <FeedRow
                      key={item.key}
                      item={item}
                      now={now}
                      timezone={snapshot.timezone}
                      fresh={fresh.has(item.key)}
                      onSettled={settle}
                      hideMoney={streamer}
                      className={!showAll && idx >= PHONE_LIMIT ? "max-lg:hidden" : undefined}
                    />
                  ))}
                </ol>
                {!showAll && shown.length > PHONE_LIMIT ? (
                  <div className="border-t px-4 py-2 lg:hidden">
                    <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAll(true)}>
                      Show {shown.length - PHONE_LIMIT} more
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </LiveCard>

          <div className="grid min-w-0 content-start gap-3 lg:col-span-5 lg:gap-4">
            <LiveCard
              title="Today vs yesterday"
              description={metric === "revenue" ? "Revenue so far, by hour" : `${HOURLY_METRICS.find((m) => m.key === metric)!.label} per hour`}
              action={<Segmented label="Chart" value={metric} onChange={setMetric} options={HOURLY_METRICS.map((m) => ({ value: m.key, label: m.label }))} />}
              bodyClassName="px-3 md:px-4"
            >
              <div className="h-52">
                <HourlyChart hours={snapshot.hourly} metric={metric} currency={snapshot.currency} hideMoney={streamer} />
              </div>
              <p className="mt-1 flex items-center gap-4 px-1 text-micro text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: HOURLY_METRICS.find((m) => m.key === metric)!.color }} />
                  Today
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="w-3 border-t border-dashed opacity-70" style={{ borderColor: HOURLY_METRICS.find((m) => m.key === metric)!.color }} />
                  Yesterday
                </span>
                <span className="ml-auto truncate">Hours in {snapshot.timezone.replace(/_/g, " ")}</span>
              </p>
            </LiveCard>
            <TopPages pages={snapshot.topPages} minutes={30} />
            <TopSources sources={snapshot.topSources} minutes={30} />
          </div>
        </div>
        {streamer ? (
          <p className="text-center text-caption text-muted-foreground">
            Streamer mode is on: amounts show as {HIDDEN_AMOUNT}. Press <kbd className="kbd">S</kbd> to show them again.
          </p>
        ) : null}
      </PageBody>
    </>
  );
}
