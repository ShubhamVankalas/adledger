"use client";

import { CircleDollarSignIcon, GlobeIcon, MousePointerClickIcon, Undo2Icon, UserPlusIcon, type LucideIcon } from "lucide-react";
import { memo, useEffect, useState } from "react";
import { PlatformBadge } from "@/components/platform-badge";
import { channelLabel, money, platformLabel } from "@/lib/format";
import type { LiveFeedItem, LiveFeedKind } from "@/lib/reports-live";
import { cn } from "@/lib/utils";
import styles from "./live.module.css";
import { HIDDEN_AMOUNT } from "./live-prefs";

// One line of the live feed: an icon for the kind, what happened, where it came from and when.
// Colour means money: payments are green and refunds red; everything else stays neutral.

const KIND: Record<LiveFeedKind, { icon: LucideIcon; label: string; tile: string }> = {
  ad_click: { icon: MousePointerClickIcon, label: "Ad click", tile: "bg-fill text-foreground" },
  visit: { icon: GlobeIcon, label: "Visit", tile: "bg-fill text-muted-foreground" },
  lead: { icon: UserPlusIcon, label: "New lead", tile: "bg-fill text-foreground" },
  payment: { icon: CircleDollarSignIcon, label: "Payment", tile: "bg-positive-soft text-positive" },
  refund: { icon: Undo2Icon, label: "Refund", tile: "bg-negative-soft text-negative" },
};

export const FEED_KIND_LABELS = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [k, v.label])) as Record<LiveFeedKind, string>;

const SOURCES: Record<string, string> = {
  stripe: "Stripe",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  paddle: "Paddle",
  lemonsqueezy: "Lemon Squeezy",
  razorpay: "Razorpay",
  paypal: "PayPal",
  gumroad: "Gumroad",
  chargebee: "Chargebee",
  recurly: "Recurly",
  cashfree: "Cashfree",
  instamojo: "Instamojo",
  phonepe: "PhonePe",
  api: "API",
  csv: "CSV import",
  pixel: "Website form",
  webhook: "Form webhook",
};
export const sourceLabel = (s: string | null) => (s ? (SOURCES[s] ?? s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())) : null);

// ---------------------------------------------------------------- time

const MINUTE = 60_000;

/** "now", "4m", "2h", or a date for anything older than a day. */
export function relativeTime(at: string, now: number): string {
  const ms = Math.max(0, now - Date.parse(at));
  if (ms < 45_000) return "now";
  if (ms < 60 * MINUTE) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < 24 * 60 * MINUTE) return `${Math.floor(ms / (60 * MINUTE))}h`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * A clock for relative times: starts at `initial` (the server's time, so server and client
 * render the same text), then follows the browser clock every 15 seconds.
 */
export function useNow(initial: number, everyMs = 15_000) {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [everyMs]);
  return now;
}

// ---------------------------------------------------------------- row

function Money({ minor, currency, hidden, className }: { minor: number | null; currency: string | null; hidden: boolean; className?: string }) {
  if (minor === null || !currency) return null;
  return <span className={cn("font-semibold tabular-nums", className)}>{hidden ? HIDDEN_AMOUNT : money(minor, currency)}</span>;
}

const Dot = () => (
  <span aria-hidden className="text-fg-faint">
    ·
  </span>
);

function describe(item: LiveFeedItem, hideMoney: boolean): { title: React.ReactNode; detail: React.ReactNode } {
  const campaign = item.campaign ? (
    <span className="min-w-0 truncate" translate="no">
      {item.campaign}
    </span>
  ) : null;
  const via = item.platform ? <PlatformBadge platform={item.platform} className="text-inherit" /> : item.channel ? <span className="shrink-0">{channelLabel(item.channel)}</span> : null;
  const path = item.path ? (
    <span className="min-w-0 truncate font-mono text-mono" translate="no">
      {item.path}
    </span>
  ) : null;
  switch (item.kind) {
    case "ad_click":
      return {
        title: (
          <>
            <span className="shrink-0 font-medium whitespace-nowrap">Ad click</span>
            {via ? <span className="shrink-0 text-muted-foreground">{via}</span> : null}
          </>
        ),
        detail: (
          <>
            {campaign ?? <span>Campaign not synced</span>}
            {path ? (
              <>
                <Dot />
                {path}
              </>
            ) : null}
          </>
        ),
      };
    case "visit":
      return {
        title: (
          <>
            <span className="shrink-0 font-medium whitespace-nowrap">Visit</span>
            <span className="text-muted-foreground">{item.channel ? `from ${channelLabel(item.channel).toLowerCase()}` : "direct"}</span>
          </>
        ),
        detail: path ?? <span>Landing page not recorded</span>,
      };
    case "lead":
      return {
        title: (
          <>
            <span className="shrink-0 font-medium whitespace-nowrap">New lead</span>
            {item.who ? <span className="truncate text-muted-foreground">{item.who}</span> : null}
          </>
        ),
        detail: (
          <>
            <span className="min-w-0 truncate">{item.form ?? sourceLabel(item.provider)}</span>
            {via ? (
              <>
                <Dot />
                <span className="flex min-w-0 items-center gap-1">
                  <span className="shrink-0">via</span> {via}
                </span>
              </>
            ) : null}
          </>
        ),
      };
    case "payment":
    case "refund":
      return {
        title: (
          <>
            <Money minor={item.amountMinor} currency={item.currency} hidden={hideMoney} className={item.kind === "refund" ? "text-negative" : "text-positive"} />
            <span className="text-muted-foreground">{item.kind === "refund" ? "refund" : "payment"}</span>
            {item.who ? <span className="truncate text-muted-foreground">{item.who}</span> : null}
          </>
        ),
        detail: (
          <>
            <span className="shrink-0">{sourceLabel(item.provider)}</span>
            {item.kind === "payment" ? (
              <>
                <Dot />
                {via ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="shrink-0">first touch</span> {via}
                    {campaign ? <span className="hidden min-w-0 truncate sm:inline">{campaign}</span> : null}
                  </span>
                ) : (
                  <span className="truncate">no ad touch</span>
                )}
              </>
            ) : null}
          </>
        ),
      };
  }
}

/** A plain-text version for screen readers and toasts. */
export function feedItemText(item: LiveFeedItem, hideMoney: boolean): string {
  const amount = item.amountMinor !== null && item.currency ? (hideMoney ? "an amount" : money(item.amountMinor, item.currency)) : "";
  const via = item.platform ? ` via ${platformLabel(item.platform)}` : "";
  switch (item.kind) {
    case "ad_click":
      return `Ad click${via}${item.campaign ? `, ${item.campaign}` : ""}`;
    case "visit":
      return `Visit${item.channel ? ` from ${channelLabel(item.channel).toLowerCase()}` : ""}${item.path ? ` to ${item.path}` : ""}`;
    case "lead":
      return `New lead${item.who ? ` ${item.who}` : ""}${via}`;
    case "payment":
      return `Payment of ${amount}${item.who ? ` from ${item.who}` : ""}${via ? `, first touch${via}` : ""}`;
    case "refund":
      return `Refund of ${amount}${item.who ? ` to ${item.who}` : ""}`;
  }
}

export const FeedRow = memo(function FeedRow({
  item,
  now,
  timezone,
  fresh,
  onSettled,
  hideMoney,
  dense,
  className,
}: {
  item: LiveFeedItem;
  now: number;
  timezone: string;
  fresh?: boolean;
  onSettled?: (key: string) => void;
  hideMoney: boolean;
  /** Overview widget: one line, smaller tile. */
  dense?: boolean;
  className?: string;
}) {
  const k = KIND[item.kind];
  const Icon = k.icon;
  const { title, detail } = describe(item, hideMoney);
  const absolute = new Date(item.at).toLocaleString("en-US", { timeZone: timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
  return (
    <li
      data-kind={item.kind}
      className={cn("flex items-start gap-3 px-4 [content-visibility:auto] [contain-intrinsic-size:auto_3.5rem] md:px-5", dense ? "py-2" : "py-2.5", fresh && styles.enter, className)}
      // Payments glow a little longer than the slide-in: settle when the last animation ends.
      onAnimationEnd={
        fresh && onSettled
          ? (e) => {
              if (e.target !== e.currentTarget) return;
              if (item.kind !== "payment" || /glow|fade/.test(e.animationName)) onSettled(item.key);
            }
          : undefined
      }
    >
      <span aria-hidden className={cn("mt-0.5 grid shrink-0 place-items-center rounded-md", dense ? "size-6" : "size-7", k.tile)}>
        <Icon className={dense ? "size-3.5" : "size-4"} strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="sr-only">{feedItemText(item, hideMoney)}</p>
        <div aria-hidden className="flex min-w-0 items-center gap-1.5 text-ui leading-5">
          {title}
          {dense ? <span className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">{detail}</span> : null}
        </div>
        {dense ? null : (
          <div aria-hidden className="mt-0.5 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground">
            {detail}
          </div>
        )}
      </div>
      <time dateTime={item.at} title={absolute} suppressHydrationWarning className="mt-0.5 shrink-0 text-caption leading-5 text-fg-faint tabular-nums">
        {relativeTime(item.at, now)}
      </time>
    </li>
  );
});
