"use client";

import {
  BanknoteIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleIcon,
  EyeIcon,
  FileTextIcon,
  MousePointerClickIcon,
  StickyNoteIcon,
  Undo2Icon,
  ZapIcon,
} from "lucide-react";
import { useMemo, useSyncExternalStore } from "react";
import { PlatformBadge } from "@/components/platform-badge";
import type { TimelineEntry, TimelineKind } from "@/lib/crm-query";
import { channelLabel, money, platformLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { clock, dayKey, dueLabel, longDay } from "./crm-format";

// The unified activity timeline: ad clicks, page views, forms, payments, refunds, notes and tasks,
// newest first, grouped by day in the workspace timezone. Runs of page views collapse into one row.

const KINDS: { kind: TimelineKind; label: string }[] = [
  { kind: "ad_click", label: "Ad clicks" },
  { kind: "page_view", label: "Page views" },
  { kind: "form", label: "Forms" },
  { kind: "payment", label: "Payments" },
  { kind: "refund", label: "Refunds" },
  { kind: "note", label: "Notes" },
  { kind: "task", label: "Tasks" },
];

const kindOf = (e: TimelineEntry): TimelineKind =>
  e.kind === "touchpoint" ? "ad_click" : e.kind === "event" || e.kind === "page_view" ? "page_view" : e.kind === "lead" ? "form" : e.kind;

const STORAGE_KEY = "adledger:crm-timeline-hidden";

const CHANGE = "adledger:crm-timeline";
function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}
function parseHidden(raw: string): TimelineKind[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((k) => KINDS.some((x) => x.kind === k)) : [];
  } catch {
    return [];
  }
}
const subscribe = (l: () => void) => {
  window.addEventListener(CHANGE, l);
  window.addEventListener("storage", l);
  return () => {
    window.removeEventListener(CHANGE, l);
    window.removeEventListener("storage", l);
  };
};

const LEAD_SOURCES: Record<string, string> = {
  pixel: "website form",
  webhook: "form webhook",
  api: "API",
  csv: "CSV import",
  meta_leads: "Meta lead form",
  google_ads_leads: "Google Ads lead form",
  tiktok_leads: "TikTok lead form",
  whatsapp: "WhatsApp",
  hubspot: "HubSpot",
  pipedrive: "Pipedrive",
};
export const leadSourceLabel = (s: string) => LEAD_SOURCES[s] ?? s.replace(/_/g, " ");

type Row = { type: "entry"; entry: TimelineEntry } | { type: "views"; entries: Extract<TimelineEntry, { kind: "page_view" }>[] };

export function Timeline({
  entries,
  tz,
  now,
  capped,
  memberName,
  compact,
}: {
  entries: TimelineEntry[];
  tz: string;
  now: string;
  capped?: boolean;
  memberName: (id: string | null) => string;
  compact?: boolean;
}) {
  // The chip choice is remembered per browser (the server renders everything visible).
  const raw = useSyncExternalStore(subscribe, readRaw, () => "[]");
  const hidden = useMemo(() => parseHidden(raw), [raw]);
  const toggle = (k: TimelineKind) => {
    const next = hidden.includes(k) ? hidden.filter((x) => x !== k) : [...hidden, k];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
    window.dispatchEvent(new Event(CHANGE));
  };

  const counts = useMemo(() => {
    const c = new Map<TimelineKind, number>();
    for (const e of entries) c.set(kindOf(e), (c.get(kindOf(e)) ?? 0) + 1);
    return c;
  }, [entries]);

  const days = useMemo(() => {
    const visible = entries.filter((e) => !hidden.includes(kindOf(e)));
    const out: { key: string; label: string; rows: Row[] }[] = [];
    for (const e of visible) {
      const key = dayKey(e.at, tz);
      if (out.at(-1)?.key !== key) out.push({ key, label: longDay(e.at, tz), rows: [] });
      const rows = out.at(-1)!.rows;
      const last = rows.at(-1);
      if (e.kind === "page_view" && last?.type === "views") last.entries.push(e);
      else if (e.kind === "page_view") rows.push({ type: "views", entries: [e] });
      else rows.push({ type: "entry", entry: e });
    }
    // Short runs read better as individual rows.
    for (const d of out) d.rows = d.rows.flatMap((r) => (r.type === "views" && r.entries.length < 3 ? r.entries.map((entry) => ({ type: "entry" as const, entry })) : [r]));
    return out;
  }, [entries, hidden, tz]);

  const present = KINDS.filter((k) => counts.get(k.kind));
  return (
    <div className="space-y-4">
      {present.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label="Show in timeline">
          {present.map((k) => {
            const on = !hidden.includes(k.kind);
            return (
              <button
                key={k.kind}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(k.kind)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-caption font-medium transition-[color,background-color,border-color] duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  on ? "border-border bg-surface text-foreground hover:bg-fill" : "border-dashed border-border-strong text-fg-faint hover:text-muted-foreground",
                )}
              >
                {k.label}
                <span className="num text-fg-faint">{counts.get(k.kind)}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {days.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-ui text-muted-foreground">
          {entries.length ? "Everything is hidden. Turn a filter back on to see activity." : "No activity recorded yet. Visits, forms and payments appear here as they happen."}
        </p>
      ) : (
        <div>
          {days.map((d) => (
            <section key={d.key} aria-label={d.label} className="relative">
              <h3 className={cn("sticky z-[1] -mx-1 mb-1 flex items-center gap-3 px-1 py-1.5 text-caption font-medium text-muted-foreground backdrop-blur-sm", compact ? "top-0 bg-popover/95" : "top-[52px] bg-background/95")}>
                <span className="shrink-0">{d.label}</span>
                <span aria-hidden className="h-px flex-1 bg-border" />
              </h3>
              <ol className="pb-3">
                {d.rows.map((r, i) =>
                  r.type === "views" ? (
                    <ViewRun key={`v${i}`} entries={r.entries} tz={tz} last={i === d.rows.length - 1} />
                  ) : (
                    <Item key={`e${i}`} entry={r.entry} tz={tz} now={now} last={i === d.rows.length - 1} memberName={memberName} />
                  ),
                )}
              </ol>
            </section>
          ))}
          {capped ? <p className="text-caption text-muted-foreground">Showing the most recent 300 page views.</p> : null}
        </div>
      )}
    </div>
  );
}

const ICONS = {
  touchpoint: { icon: MousePointerClickIcon, tone: "bg-fill text-muted-foreground" },
  page_view: { icon: EyeIcon, tone: "bg-fill text-fg-faint" },
  event: { icon: ZapIcon, tone: "bg-fill text-muted-foreground" },
  lead: { icon: FileTextIcon, tone: "bg-brand-soft text-brand-foreground" },
  payment: { icon: BanknoteIcon, tone: "bg-positive-soft text-positive" },
  refund: { icon: Undo2Icon, tone: "bg-negative-soft text-negative" },
  note: { icon: StickyNoteIcon, tone: "bg-warning-soft text-warning-foreground" },
  task: { icon: CircleCheckIcon, tone: "bg-fill text-muted-foreground" },
} as const;

function Rail({ kind, last, children }: { kind: keyof typeof ICONS; last: boolean; children: React.ReactNode }) {
  const { icon: Icon, tone } = ICONS[kind];
  return (
    <li className="relative grid grid-cols-[24px_minmax(0,1fr)] gap-3">
      {!last ? <span aria-hidden className="absolute top-7 bottom-0 left-[11.5px] w-px bg-border" /> : null}
      <span aria-hidden className={cn("relative mt-0.5 flex size-6 items-center justify-center rounded-full", tone)}>
        <Icon className="size-3.5" strokeWidth={1.75} />
      </span>
      <div className={cn("min-w-0", last ? "pb-1" : "pb-4")}>{children}</div>
    </li>
  );
}

function Head({ children, time, aside }: { children: React.ReactNode; time: string; aside?: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-baseline gap-3">
      <div className="min-w-0 flex-1 text-ui font-medium break-words">{children}</div>
      {aside}
      <time className="num shrink-0 text-caption text-fg-faint">{time}</time>
    </div>
  );
}

const pathOf = (url: string | null) => {
  if (!url) return null;
  try {
    return decodeURIComponent(new URL(url).pathname) || "/";
  } catch {
    return null;
  }
};

function Item({ entry: e, tz, now, last, memberName }: { entry: TimelineEntry; tz: string; now: string; last: boolean; memberName: (id: string | null) => string }) {
  const time = clock(e.at, tz);
  switch (e.kind) {
    case "touchpoint": {
      const landing = pathOf(e.landingUrl);
      const path = [e.adGroup, e.ad].filter(Boolean) as string[];
      return (
        <Rail kind="touchpoint" last={last}>
          <Head time={time}>{e.campaign ?? (e.platform ? `${platformLabel(e.platform)} visit` : `${channelLabel(e.channel)} visit`)}</Head>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted-foreground">
            {e.platform ? <PlatformBadge platform={e.platform} /> : <span>{channelLabel(e.channel)}</span>}
            {path.map((p, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-fg-faint" />
                <span className="min-w-0 break-words">{p}</span>
              </span>
            ))}
          </div>
          {landing || e.source ? (
            <p className="mt-1 truncate text-caption text-muted-foreground">
              {landing ? (
                <>
                  Landed on <span className="font-mono text-mono text-foreground/85" translate="no">{landing}</span>
                </>
              ) : null}
              {e.source ? <span className="text-fg-faint">{landing ? " via " : "Via "}{[e.source, e.medium].filter(Boolean).join(" / ")}</span> : null}
            </p>
          ) : null}
        </Rail>
      );
    }
    case "page_view":
      return (
        <Rail kind="page_view" last={last}>
          <Head time={time}>
            <span className="font-normal text-muted-foreground">Viewed </span>
            <span className="font-mono text-mono" translate="no">{e.path}</span>
          </Head>
        </Rail>
      );
    case "event":
      return (
        <Rail kind="event" last={last}>
          <Head time={time}>{e.name}</Head>
        </Rail>
      );
    case "lead":
      return (
        <Rail kind="lead" last={last}>
          <Head time={time}>Became a lead</Head>
          <p className="text-caption text-muted-foreground">
            {e.formName ? (
              <>
                Submitted <span className="text-foreground/85">{e.formName}</span> via {leadSourceLabel(e.source)}
              </>
            ) : (
              <>Captured via {leadSourceLabel(e.source)}</>
            )}
          </p>
        </Rail>
      );
    case "payment":
    case "refund":
      return (
        <Rail kind={e.kind} last={last}>
          <Head
            time={time}
            aside={
              <span className={cn("num shrink-0 text-ui font-medium", e.kind === "refund" ? "text-negative" : "text-positive")}>
                {e.kind === "refund" ? "−" : "+"}
                {money(Math.abs(e.amountMinor), e.currency)}
              </span>
            }
          >
            {e.kind === "payment" ? "Payment received" : "Refund issued"}
          </Head>
        </Rail>
      );
    case "note":
      return (
        <Rail kind="note" last={last}>
          <Head time={time}>
            <span className="font-normal text-muted-foreground">Note from </span>
            {e.note.authorName ?? memberName(e.note.authorUserId)}
          </Head>
          <p className="mt-0.5 line-clamp-4 text-ui whitespace-pre-wrap text-foreground/85">{e.note.body}</p>
        </Rail>
      );
    case "task": {
      const due = e.task.dueAt ? dueLabel(e.task.dueAt, tz, now) : null;
      return (
        <Rail kind="task" last={last}>
          <Head time={time}>
            <span className={cn("inline-flex items-center gap-1.5", e.task.doneAt && "text-muted-foreground line-through decoration-fg-faint")}>
              {e.task.doneAt ? null : <CircleIcon aria-hidden className="size-3 text-fg-faint" />}
              {e.task.title}
            </span>
          </Head>
          <p className="text-caption text-muted-foreground">
            {e.task.doneAt ? "Completed" : "Task"}
            {e.task.assigneeUserId ? ` · ${memberName(e.task.assigneeUserId)}` : ""}
            {due && !e.task.doneAt ? <span className={cn(due.overdue && "text-negative")}> · due {due.text.toLowerCase()}</span> : null}
          </p>
        </Rail>
      );
    }
  }
}

function ViewRun({ entries, tz, last }: { entries: Extract<TimelineEntry, { kind: "page_view" }>[]; tz: string; last: boolean }) {
  const paths = [...new Set(entries.map((e) => e.path))];
  const top = paths.slice(0, 2).join(", ");
  return (
    <Rail kind="page_view" last={last}>
      <details className="group/run">
        <summary className="flex min-h-7 cursor-pointer list-none items-baseline gap-3 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 text-ui">
            <span className="font-medium">{entries.length} page views</span>
            <span className="text-muted-foreground">
              {" "}
              on <span className="font-mono text-mono" translate="no">{top}</span>
              {paths.length > 2 ? ` and ${paths.length - 2} more` : ""}
            </span>
            <ChevronRightIcon aria-hidden className="ml-1 inline size-3.5 text-fg-faint transition-transform duration-150 group-open/run:rotate-90 motion-reduce:transition-none" />
          </span>
          <time className="num shrink-0 text-caption text-fg-faint">
            {clock(entries.at(-1)!.at, tz)}–{clock(entries[0].at, tz)}
          </time>
        </summary>
        <ul className="mt-1 space-y-0.5 border-l pl-3">
          {entries.map((e, i) => (
            <li key={i} className="flex items-baseline gap-3 text-caption">
              <span className="min-w-0 flex-1 truncate font-mono text-mono text-muted-foreground" translate="no">
                {e.path}
              </span>
              <time className="num shrink-0 text-fg-faint">{clock(e.at, tz)}</time>
            </li>
          ))}
        </ul>
      </details>
    </Rail>
  );
}
