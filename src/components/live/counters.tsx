"use client";

import { useCallback } from "react";
import { DeltaText } from "@/components/overview/tone";
import { moneyWhole, num, plural } from "@/lib/format";
import { metricDelta, ratioX, type Polarity } from "@/lib/metrics";
import type { LiveSnapshot } from "@/lib/reports-live";
import { cn } from "@/lib/utils";
import { CountUp } from "./count-up";
import styles from "./live.module.css";
import { HIDDEN_AMOUNT } from "./live-prefs";
import type { LiveStatus } from "./use-live-stream";

// The top of the Live page: "on your site now" (with the last 30 minutes, minute by minute) and
// four counters for today so far against the same time yesterday.

const TILE = "flex min-w-0 flex-col rounded-xl bg-card px-4 py-3.5 text-card-foreground shadow-(--elev-card) md:px-5 md:py-4";

function vsYesterday(cur: number, prev: number, polarity: Polarity, prevText: string) {
  const d = metricDelta(cur, prev, polarity);
  return { ...d, label: d.tone === "none" ? d.label : `${d.label.replace("previous period", "the same time yesterday")}, was ${prevText}` };
}

function Tile({
  label,
  value,
  format,
  prev,
  prevText,
  polarity,
  note,
  noteTitle,
}: {
  label: string;
  value: number;
  format: (v: number) => string;
  prev: number;
  prevText: string;
  polarity: Polarity;
  note?: string | null;
  noteTitle?: string;
}) {
  const delta = vsYesterday(value, prev, polarity, prevText);
  return (
    <div className={TILE}>
      <p className="truncate text-caption font-medium text-muted-foreground">{label}</p>
      <CountUp value={value} format={format} className="mt-1 truncate text-kpi tabular-nums sm:text-kpi-lg" title={format(value)} />
      <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-caption">
        <DeltaText delta={delta} />
        <span className="truncate text-muted-foreground" title={noteTitle}>
          {prev === 0 && value === 0 ? "none yet today or yesterday" : `vs ${prevText} yesterday`}
        </span>
      </p>
      {note ? <p className="mt-auto line-clamp-2 pt-2 text-caption text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/** 30 thin bars, one per minute; the current minute is drawn in the brand colour. */
export function MinuteBars({ values, className, barsClassName = "h-12" }: { values: number[]; className?: string; barsClassName?: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <figure className={cn("mt-auto pt-4", className)}>
      <div role="img" aria-label={`Visitors per minute over the last ${values.length} minutes, ${num(values.at(-1) ?? 0)} this minute`} className={cn("flex items-end gap-[2px]", barsClassName)}>
        {values.map((v, i) => (
          <span
            key={i}
            className={cn(
              "min-w-0 flex-1 rounded-t-[2px] transition-[height] duration-200 ease-out motion-reduce:transition-none",
              i === values.length - 1 ? "bg-brand" : v > 0 ? "bg-[color:var(--chart-customers,var(--chart-4))]/45" : "bg-fill-active",
            )}
            style={{ height: v > 0 ? `${Math.max(8, (v / max) * 100)}%` : "2px" }}
          />
        ))}
      </div>
      <figcaption className="mt-1.5 flex justify-between text-micro text-muted-foreground">
        <span>{values.length} min ago</span>
        <span>{total === 0 ? "No visits in this window" : "Now"}</span>
      </figcaption>
    </figure>
  );
}

export function LiveCounters({ snapshot: s, status, hideMoney }: { snapshot: LiveSnapshot; status: LiveStatus; hideMoney: boolean }) {
  const count = useCallback((v: number) => num(v), []);
  const cash = useCallback((v: number) => (hideMoney ? HIDDEN_AMOUNT : moneyWhole(v, s.currency)), [hideMoney, s.currency]);
  const trend = s.visitorsNow - s.visitorsPrev;
  const hiddenOr = (text: string) => (hideMoney ? HIDDEN_AMOUNT : text);

  return (
    <div className="grid gap-3 lg:grid-cols-12 lg:gap-4">
      <section aria-labelledby="live-now" className={cn(TILE, "lg:col-span-5 xl:col-span-4")}>
        <div className="flex items-center gap-2">
          <span aria-hidden className={styles.pulse} data-state={status} />
          <h2 id="live-now" className="text-caption font-medium text-muted-foreground">
            On your site now
          </h2>
        </div>
        <div className="mt-2 flex items-baseline gap-3">
          <CountUp value={s.visitorsNow} format={count} className="text-[2.75rem] leading-none font-semibold tracking-[-0.03em] tabular-nums" />
          <span className="text-body text-muted-foreground">{s.visitorsNow === 1 ? "visitor" : "visitors"}</span>
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
          <span>In the last {s.windowMinutes} minutes</span>
          {trend !== 0 ? (
            <span className="tabular-nums" title={`${num(s.visitorsPrev)} in the ${s.windowMinutes} minutes before`}>
              <span className="text-foreground">
                {trend > 0 ? "+" : "−"}
                {num(Math.abs(trend))}
              </span>{" "}
              vs the {s.windowMinutes} before
            </span>
          ) : null}
        </p>
        <MinuteBars values={s.visitorsByMinute} barsClassName="h-14 lg:h-20" />
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-caption">
          <div className="min-w-0">
            <dt className="text-muted-foreground">Visitors today</dt>
            <dd className="mt-0.5 flex items-baseline gap-1.5">
              <CountUp value={s.today.visitors} format={count} className="text-body font-semibold tabular-nums" />
              <DeltaText delta={vsYesterday(s.today.visitors, s.sameTimeYesterday.visitors, "up", num(s.sameTimeYesterday.visitors))} />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">Page views today</dt>
            <dd className="mt-0.5 flex items-baseline gap-1.5">
              <CountUp value={s.today.pageviews} format={count} className="text-body font-semibold tabular-nums" />
              <DeltaText delta={vsYesterday(s.today.pageviews, s.sameTimeYesterday.pageviews, "up", num(s.sameTimeYesterday.pageviews))} />
            </dd>
          </div>
        </dl>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:col-span-7 lg:gap-4 xl:col-span-8">
        <Tile
          label="Revenue today"
          value={s.today.revenueMinor}
          format={cash}
          prev={s.sameTimeYesterday.revenueMinor}
          prevText={hiddenOr(moneyWhole(s.sameTimeYesterday.revenueMinor, s.currency))}
          polarity="up"
          note={s.today.orders ? `${plural(s.today.orders, "order")}${s.today.refundsMinor ? `, ${hiddenOr(moneyWhole(-s.today.refundsMinor, s.currency))} refunded` : ""}` : "Net of refunds"}
        />
        <Tile
          label="Ad spend today"
          value={s.today.spendMinor}
          format={cash}
          prev={s.sameTimeYesterday.spendMinor}
          prevText={hiddenOr(moneyWhole(s.sameTimeYesterday.spendMinor, s.currency))}
          noteTitle={`Ad platforms report spend per day: yesterday's ${hiddenOr(moneyWhole(s.yesterdaySpendMinor, s.currency))} × ${Math.round(s.dayFraction * 100)}% of the day so far.`}
          polarity="neutral"
          note={s.roasToday === null ? "No spend synced yet today" : `ROAS ${ratioX(s.roasToday)} so far`}
        />
        <Tile label="Leads today" value={s.today.leads} format={count} prev={s.sameTimeYesterday.leads} prevText={num(s.sameTimeYesterday.leads)} polarity="up" note="People who filled in a form" />
        <Tile
          label="New customers today"
          value={s.today.customers}
          format={count}
          prev={s.sameTimeYesterday.customers}
          prevText={num(s.sameTimeYesterday.customers)}
          polarity="up"
          note="First payment ever"
        />
      </div>
    </div>
  );
}
