// Client-safe display helpers shared by the CRM surfaces (table, peek, record page, tasks).
// Dates render in the workspace timezone; relative times are measured against a `now` that the
// server passes down, so the server and the browser print the same text (no hydration drift).

import { channelLabel, platformLabel } from "@/lib/format";

export type Touch = { platform: string | null; channel: string | null; campaign: string | null } | null;

/** "Meta", "Paid search", or null when there is no tracked touch. */
export function touchSource(t: Touch): string | null {
  if (!t) return null;
  if (t.platform) return platformLabel(t.platform);
  return t.channel ? channelLabel(t.channel) : null;
}

const cache = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string, opts: Intl.DateTimeFormatOptions) {
  const key = `${timeZone}|${JSON.stringify(opts)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone });
    cache.set(key, f);
  }
  return f;
}

/** "Sep 24" this year, "Sep 24, 2025" otherwise. */
export function shortDay(iso: string, tz: string, now: string): string {
  const sameYear = fmt(tz, { year: "numeric" }).format(new Date(iso)) === fmt(tz, { year: "numeric" }).format(new Date(now));
  return fmt(tz, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
}

export const longDay = (iso: string, tz: string) => fmt(tz, { weekday: "long", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
export const fullDate = (iso: string, tz: string) => fmt(tz, { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
export const clock = (iso: string, tz: string) => fmt(tz, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
export const dateTime = (iso: string, tz: string) => fmt(tz, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Calendar day key (YYYY-MM-DD) in the workspace timezone. */
export const dayKey = (iso: string, tz: string) => fmt(tz, { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** "just now", "12 min ago", "3 h ago", "Yesterday", "4 days ago", then the date. */
export function relative(iso: string | null, tz: string, now: string): string {
  if (!iso) return "—";
  const diff = new Date(now).getTime() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24 && dayKey(iso, tz) === dayKey(now, tz)) return `${h} h ago`;
  const yesterday = new Date(new Date(now).getTime() - 86_400_000).toISOString();
  if (dayKey(iso, tz) === dayKey(yesterday, tz)) return "Yesterday";
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `${days} days ago`;
  return shortDay(iso, tz, now);
}

/** Due-date wording for a task relative to today in the workspace timezone. */
export function dueLabel(iso: string, tz: string, now: string): { text: string; overdue: boolean; today: boolean } {
  const today = dayKey(now, tz);
  const due = dayKey(iso, tz);
  const tomorrow = dayKey(new Date(new Date(now).getTime() + 86_400_000).toISOString(), tz);
  const overdue = new Date(iso).getTime() < new Date(now).getTime();
  if (due === today) return { text: "Today", overdue, today: true };
  if (due === tomorrow) return { text: "Tomorrow", overdue: false, today: false };
  return { text: shortDay(iso, tz, now), overdue, today: false };
}

export function contactName(c: { name: string | null; email: string | null }): string {
  return c.name?.trim() || c.email || "Anonymous contact";
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
