"use client";

import { ActivityIcon, ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useCallback } from "react";
import { moneyShort, num } from "@/lib/format";
import type { LiveFeedItem, LiveSnapshot } from "@/lib/reports-live";
import { CountUp } from "./count-up";
import { MinuteBars } from "./counters";
import { FeedRow, useNow } from "./feed-row";
import styles from "./live.module.css";
import { HIDDEN_AMOUNT, useLivePref } from "./live-prefs";
import { useLiveStream } from "./use-live-stream";

const ROWS = 4;

/**
 * "Live now" for the Overview board: visitors in the last 5 minutes (with the last 30 minutes as
 * bars), today's revenue and leads, and the newest activity. Subscribes to the same stream as the
 * Live page, so it updates in place. Built to sit in a 380px card.
 */
export function LiveNowCard({ initialSnapshot, initialItems, initialCursor }: { initialSnapshot: LiveSnapshot; initialItems: LiveFeedItem[]; initialCursor: string }) {
  const { snapshot: s, items, status, fresh, settle } = useLiveStream({ initialSnapshot, initialItems, initialCursor, maxItems: ROWS });
  const [streamer] = useLivePref("streamer");
  const now = useNow(Date.parse(initialSnapshot.asOf));
  const count = useCallback((v: number) => num(v), []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-[3.25rem] items-start gap-3 px-4 pt-3.5 md:px-5 md:pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 truncate text-sm leading-5 font-semibold tracking-[-0.006em]">
            <span aria-hidden className={styles.pulse} data-state={status} />
            Live now
          </h3>
          <p className="truncate text-xs leading-4 text-muted-foreground">Visitors on your site in the last {s.windowMinutes} minutes</p>
        </div>
        <Link
          href="/live"
          className="-mr-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:h-9"
        >
          Open Live
          <ArrowRightIcon aria-hidden className="size-3.5" />
        </Link>
      </div>
      <div className="flex min-h-0 flex-1 flex-col pt-2">
        <div className="flex items-end gap-4 px-4 md:px-5">
          <div className="min-w-0">
            <CountUp value={s.visitorsNow} format={count} className="block text-[2rem] leading-10 font-semibold tracking-[-0.025em] tabular-nums" />
            <p className="text-caption text-muted-foreground">{s.visitorsNow === 1 ? "visitor" : "visitors"} now</p>
          </div>
          <dl className="ml-auto grid grid-cols-2 gap-x-5 text-right text-caption">
            <dt className="text-muted-foreground">Revenue today</dt>
            <dt className="text-muted-foreground">Leads today</dt>
            <dd className="text-body font-semibold tabular-nums">{streamer ? HIDDEN_AMOUNT : moneyShort(s.today.revenueMinor, s.currency)}</dd>
            <dd className="text-body font-semibold tabular-nums">{num(s.today.leads)}</dd>
          </dl>
        </div>
        <MinuteBars values={s.visitorsByMinute} className="mt-0 px-4 pt-3 md:px-5 [&_figcaption]:hidden" barsClassName="h-8" />
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
            <ActivityIcon aria-hidden className="size-5 text-fg-faint" />
            <p className="text-ui font-medium">Quiet for now</p>
            <p className="text-caption text-muted-foreground">Visits, leads and payments appear here as they happen.</p>
          </div>
        ) : (
          <ol aria-label="Latest activity" className="mt-2 min-h-0 flex-1 divide-y divide-border/70 overflow-hidden border-t border-border/70">
            {items.slice(0, ROWS).map((item) => (
              <FeedRow key={item.key} item={item} now={now} timezone={s.timezone} fresh={fresh.has(item.key)} onSettled={settle} hideMoney={streamer} dense />
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
