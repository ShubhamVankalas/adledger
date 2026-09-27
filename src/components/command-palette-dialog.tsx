"use client";

import { Autocomplete } from "@base-ui/react/autocomplete";
import { Dialog } from "@base-ui/react/dialog";
import {
  BookmarkPlusIcon,
  CalendarRangeIcon,
  ClipboardCopyIcon,
  EyeIcon,
  EyeOffIcon,
  CornerDownLeftIcon,
  GitCompareArrowsIcon,
  HistoryIcon,
  KeyboardIcon,
  ListPlusIcon,
  SquarePenIcon,
  LoaderCircleIcon,
  MoonIcon,
  RefreshCwIcon,
  SearchIcon,
  SparklesIcon,
  SunIcon,
  UserPlusIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { pixelSnippetAction, syncAllNowAction } from "@/app/actions/palette";
import { BrandGlyph } from "@/components/brand-icon";
import { initialsOf } from "@/components/avatars";
import { useLivePref } from "@/components/live/live-prefs";
import { Keycaps, KBD } from "@/components/keycaps";
import { TINT, tintStyle } from "@/lib/avatar-tint";
import { fuzzyScore } from "@/lib/fuzzy";
import type { SearchKind, SearchResult } from "@/lib/search";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  ASK_DRAFT_KEY,
  COMPARE_OPTIONS,
  DATE_PRESETS,
  MODELS,
  NAV,
  isReportPath,
  type PaletteCan,
} from "./command-palette-data";
import { OPEN_SHORTCUTS_EVENT, pushRecent, readRecent, SAVE_VIEW_EVENT, type RecentEntry } from "./command-palette-store";

// The ⌘K palette's dialog (loaded on idle by command-palette.tsx, so the first open is instant).
// Base UI Autocomplete inside a Base UI Dialog: combobox + listbox semantics, the highlighted row
// exposed through aria-activedescendant, Enter to run, Esc to close. Filtering happens here
// (fuzzy, ranked), so the Autocomplete gets `filter={null}`.

type Item = {
  id: string;
  label: string;
  subtitle?: string | null;
  keywords?: readonly string[];
  icon?: LucideIcon;
  platform?: string | null;
  /** Initials avatar instead of an icon (contacts). */
  avatar?: string;
  hotkey?: string;
  hint?: string;
  href?: string;
  run?: () => void | Promise<void>;
  /** Remembered under "Recent" when chosen. */
  recent?: RecentEntry;
  disabled?: boolean;
};

type Group = { value: string; label: string; items: Item[] };

type Remote = { key: string; results: SearchResult[]; status: "loading" | "done" | "error" };

const KIND_LABEL: Record<SearchKind, string> = { contact: "Contact", campaign: "Campaign", ad_group: "Ad set", ad: "Ad" };
const MAX_NAV = 8;
const MAX_ACTIONS = 6;

// Search results keyed by palette session + query: backspacing is instant, and every new open
// asks the server again (so a contact added a minute ago shows up).
const searchCache = new Map<string, SearchResult[]>();

function maskIfEmail(s: string) {
  const at = s.indexOf("@");
  return at > 0 && !s.includes(" ") ? `${s[0]}•••${s.slice(at)}` : s;
}

function resultToItem(r: SearchResult): Item {
  const hint = r.kind === "contact" ? (r.status === "customer" ? "Customer" : "Lead") : KIND_LABEL[r.kind];
  return {
    id: `${r.kind}:${r.id}`,
    label: r.title,
    subtitle: r.subtitle,
    platform: r.kind === "contact" ? null : r.platform,
    avatar: r.kind === "contact" ? r.id : undefined,
    hint,
    href: r.url,
    // Recent lives in this browser's storage: keep a bare email out of it.
    recent: { id: `${r.kind}:${r.id}`, label: r.kind === "contact" ? maskIfEmail(r.title) : r.title, subtitle: r.kind === "contact" ? null : r.subtitle, href: r.url, kind: r.kind, platform: r.platform },
  };
}

function recordsLabel(items: Item[]) {
  const people = items.filter((i) => i.avatar).length;
  return people === items.length ? "Contacts" : people === 0 ? "Campaigns & ads" : "Contacts & ads";
}

function recentToItem(r: RecentEntry): Item {
  const nav = r.kind === "page" ? NAV.find((n) => n.href === r.href) : undefined;
  return {
    id: `recent:${r.id}`,
    label: r.label,
    subtitle: r.subtitle,
    icon: nav?.icon ?? (r.kind === "page" ? HistoryIcon : undefined),
    platform: r.kind === "page" || r.kind === "contact" ? null : r.platform,
    avatar: r.kind === "contact" ? r.id : undefined,
    hint: r.kind === "page" ? undefined : KIND_LABEL[r.kind],
    href: r.href,
    recent: r,
  };
}

function useRemoteSearch(term: string, enabled: boolean, session: number): Remote | null {
  const q = term.trim();
  const key = `${session}\u0000${q.toLowerCase()}`;
  const active = enabled && q.length >= 2;
  const cached = active ? searchCache.get(key) : undefined;
  const [remote, setRemote] = useState<Remote | null>(null);

  useEffect(() => {
    if (!active || cached) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      setRemote((prev) => ({ key, results: prev?.results ?? [], status: "loading" }));
      try {
        const res = await fetch("/api/v1/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q }),
          signal: ctrl.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { results: SearchResult[] };
        if (searchCache.size > 50) searchCache.clear();
        searchCache.set(key, data.results);
        setRemote({ key, results: data.results, status: "done" });
      } catch {
        if (!ctrl.signal.aborted) setRemote({ key, results: [], status: "error" });
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [active, cached, key, q]);

  if (!active) return null;
  if (cached) return { key, results: cached, status: "done" };
  // Waiting for the debounce or the response: results for an earlier query in this session stay
  // available (the caller keeps only those that still match).
  if (!remote || remote.key !== key) {
    const sameSession = remote?.key.startsWith(`${session}\u0000`) ?? false;
    return { key, results: sameSession ? remote!.results : [], status: "loading" };
  }
  return remote;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Keyboard opens appear instantly; pointer opens get a short fade. */
  via: "keyboard" | "pointer";
  initialQuery: string;
  /** Bumps on every open: resets the query and the search cache. */
  session: number;
  workspaceId: string;
  can: PaletteCan;
};

export function PaletteDialog({ open, onOpenChange, via, initialQuery, session, workspaceId, can }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const inputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();
  const [query, setQuery] = useState(initialQuery);
  const [recent, setRecent] = useState<RecentEntry[]>(() => readRecent(workspaceId));
  const [lastSession, setLastSession] = useState(session);

  // A new open: start from the given query and re-read Recent (adjusting state during render, not in an effect).
  if (session !== lastSession) {
    setLastSession(session);
    setQuery(initialQuery);
    setRecent(readRecent(workspaceId));
  }

  const mode = query.startsWith(">") ? "actions" : query.startsWith("?") ? "ask" : "all";
  const term = (mode === "all" ? query : query.slice(1)).trim();
  const remote = useRemoteSearch(term, open && mode === "all", session);
  const dark = resolvedTheme === "dark";
  const [streamer, setStreamer] = useLivePref("streamer");

  const nav = useMemo(() => NAV.filter((n) => !n.show || n.show(can)), [can]);

  const actions = useMemo<(Item & { top?: boolean })[]>(() => {
    const applyParams = (patch: Record<string, string | null>) => {
      const here = new URL(window.location.href);
      const target = isReportPath(here.pathname) ? here : new URL("/", here.origin);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) target.searchParams.delete(k);
        else target.searchParams.set(k, v);
      }
      const qs = target.searchParams.toString();
      router.push(`${target.pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    };
    const list: (Item & { top?: boolean })[] = [
      { id: "overview.edit", label: "Customize Overview", keywords: ["edit layout", "widgets", "rearrange", "dashboard", "add widget"], icon: SquarePenIcon, href: "/?edit=1", top: true },
      {
        id: "theme",
        label: dark ? "Switch to light theme" : "Switch to dark theme",
        keywords: ["toggle theme", "dark mode", "light mode", "appearance", "night"],
        icon: dark ? SunIcon : MoonIcon,
        run: () => setTheme(dark ? "light" : "dark"),
        top: true,
      },
      ...DATE_PRESETS.map((p) => ({
        id: `date.${p.range}`,
        label: `Date range: ${p.label.toLowerCase()}`,
        keywords: ["period", "date", "range", p.range, p.label],
        icon: CalendarRangeIcon,
        run: () => applyParams({ range: p.range, from: null, to: null }),
      })),
      ...COMPARE_OPTIONS.map((c) => ({ id: `compare.${c.value}`, label: c.label, keywords: c.keywords, icon: GitCompareArrowsIcon, run: () => applyParams({ compare: c.value }) })),
      ...MODELS.map((m) => ({
        id: `model.${m.value}`,
        label: `Attribution model: ${m.label}`,
        keywords: ["attribution", "model", m.label],
        icon: WaypointsIcon,
        run: () => applyParams({ model: m.value }),
      })),
    ];
    if (can.settings) {
      list.push({
        id: "sync",
        label: "Sync ad accounts now",
        keywords: ["sync now", "refresh", "pull", "update data", "meta", "google ads"],
        icon: RefreshCwIcon,
        top: true,
        run: async () => {
          const id = toast.loading("Syncing ad accounts…");
          const r = await syncAllNowAction();
          if (r.ok) {
            toast.success(r.message ?? "Synced.", { id });
            router.refresh();
          } else toast.error(r.message ?? "Sync failed.", { id });
        },
      });
      list.push({
        id: "pixel.copy",
        label: "Copy pixel snippet",
        keywords: ["tracking code", "install pixel", "script", "website", "snippet"],
        icon: ClipboardCopyIcon,
        run: async () => {
          const openTracking = { label: "Open tracking", onClick: () => router.push("/settings/workspace/tracking") };
          const r = await pixelSnippetAction();
          const data = r.data as { origin?: string; publicKey?: string; site?: string } | undefined;
          if (!r.ok || !data?.origin || !data.publicKey) {
            toast.error(r.message ?? "Couldn’t load the snippet.", { action: openTracking });
            return;
          }
          const { snippetFor } = await import("@/components/settings/tracking-section");
          try {
            await navigator.clipboard.writeText(snippetFor(data.origin, data.publicKey));
            toast.success(`Pixel snippet for ${data.site ?? "your website"} copied`, { description: "Paste it into the <head> of every page." });
          } catch {
            toast.error("Your browser blocked the clipboard. Copy the snippet from Tracking & forms.", { action: openTracking });
          }
        },
      });
    }
    list.push({
      id: "streamer",
      label: streamer ? "Turn off streamer mode" : "Turn on streamer mode",
      keywords: ["hide money", "hide revenue", "screen share", "presentation", "privacy", "live"],
      icon: streamer ? EyeIcon : EyeOffIcon,
      run: () => {
        setStreamer(!streamer);
        toast.success(streamer ? "Streamer mode off: amounts are visible again" : "Streamer mode on: amounts are hidden on Live and in the sidebar");
      },
    });
    if (pathname === "/performance") {
      list.push({
        id: "view.save",
        label: "Save view…",
        keywords: ["saved view", "bookmark", "pin view", "save filters", "save columns"],
        icon: BookmarkPlusIcon,
        top: true,
        run: () => {
          window.dispatchEvent(new Event(SAVE_VIEW_EVENT));
        },
      });
    }
    if (can.editContacts) {
      list.push({
        id: "task.new",
        label: "New task",
        keywords: ["add task", "todo", "reminder", "follow up"],
        icon: ListPlusIcon,
        run: () => {
          if (pathname === "/tasks") document.getElementById("my-task-input")?.focus();
          else router.push("/tasks?new=1");
        },
      });
    }
    if (can.members) list.push({ id: "invite", label: "Invite teammate", keywords: ["add member", "team", "invite user", "share access"], icon: UserPlusIcon, href: "/settings/organization/members?invite=1" });
    list.push({
      id: "shortcuts",
      label: "Keyboard shortcuts",
      keywords: ["hotkeys", "keys", "help"],
      icon: KeyboardIcon,
      hotkey: "?",
      top: true,
      run: () => {
        window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
      },
    });
    return list;
  }, [can, dark, pathname, router, setStreamer, setTheme, streamer]);

  const groups = useMemo<Group[]>(() => {
    const askItem = (question: string): Item => ({
      id: "ask",
      label: question ? `Ask AI: “${question}”` : "Type a question for AI insights",
      icon: SparklesIcon,
      disabled: !question,
      hint: question ? "Insights" : undefined,
      run: () => {
        try {
          sessionStorage.setItem(ASK_DRAFT_KEY, question);
        } catch {
          // storage blocked: Insights opens without the draft
        }
        router.push("/insights?tab=ask");
        window.dispatchEvent(new CustomEvent("adledger:ask", { detail: { question } }));
      },
    });
    if (mode === "ask") return [{ value: "ask", label: "Ask AI", items: [askItem(term)] }];

    const score = (item: Item) => fuzzyScore(term, item.label, [...(item.keywords ?? []), item.subtitle ?? ""]);
    const ranked = (items: Item[], max: number) =>
      items
        .map((item) => ({ item, score: score(item) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max);

    if (mode === "actions") {
      const items = term ? ranked(actions, 20).map((x) => x.item) : actions;
      return items.length ? [{ value: "actions", label: "Actions", items }] : [];
    }

    const navItems: Item[] = nav.map((n) => ({
      id: n.id,
      label: n.label,
      subtitle: n.section,
      keywords: n.keywords,
      icon: n.icon,
      hotkey: n.hotkey,
      href: n.href,
      recent: { id: n.id, label: n.label, subtitle: n.section ?? null, href: n.href, kind: "page" },
    }));
    if (!term) {
      const out: Group[] = [];
      const here = recent.filter((r) => r.href !== pathname);
      if (here.length) out.push({ value: "recent", label: "Recent", items: here.map(recentToItem) });
      out.push({ value: "navigate", label: "Go to", items: navItems.filter((n) => NAV.find((x) => x.id === n.id)?.top) });
      out.push({ value: "actions", label: "Actions", items: actions.filter((a) => a.top) });
      return out;
    }

    // Records the server found. While a newer search is in flight, keep the earlier results that
    // still match on screen instead of blanking the list.
    const found = (remote?.results ?? []).map(resultToItem);
    const records = remote?.status === "loading" ? found.filter((i) => score(i) > 0) : found;
    // Groups are ordered by their best match, so "pri" puts Priya above "Workspace settings"
    // (a keyword hit on "privacy"). Records get a head start on record pages and for emails.
    const recordsBias = term.includes("@") || /^\/(contacts|pipeline|performance)/.test(pathname) ? 40 : 0;
    const navRanked = ranked(navItems, MAX_NAV);
    const actionRanked = ranked(actions, MAX_ACTIONS);
    const candidates: { group: Group; best: number }[] = [
      { group: { value: "navigate", label: "Go to", items: navRanked.map((x) => x.item) }, best: (navRanked[0]?.score ?? 0) + 5 },
      { group: { value: "search", label: recordsLabel(records), items: records },best: Math.max(50, ...records.map(score)) + recordsBias },
      { group: { value: "actions", label: "Actions", items: actionRanked.map((x) => x.item) }, best: (actionRanked[0]?.score ?? 0) - 5 },
    ];
    const out = candidates
      .filter((c) => c.group.items.length > 0)
      .sort((a, b) => b.best - a.best)
      .map((c) => c.group);
    if (out.length === 0 && remote?.status !== "loading") out.push({ value: "ask", label: "Ask AI", items: [askItem(term)] });
    return out;
  }, [actions, mode, nav, pathname, recent, remote, router, term]);

  const closeRef = useRef(onOpenChange);
  useEffect(() => {
    closeRef.current = onOpenChange;
  });
  // Stable, so memoised rows don't re-render on every keystroke.
  const choose = useCallback(
    (item: Item, event?: { metaKey?: boolean; ctrlKey?: boolean }) => {
      if (item.disabled) return;
      if (item.href) {
        if (item.recent) setRecent(pushRecent(workspaceId, item.recent));
        if (event?.metaKey || event?.ctrlKey) window.open(item.href, "_blank", "noopener");
        else router.push(item.href);
        closeRef.current(false);
        return;
      }
      closeRef.current(false);
      // After the palette has closed and handed focus back, so a dialog the action opens keeps it.
      window.setTimeout(() => void item.run?.(), 0);
    },
    [router, workspaceId],
  );

  const searching = remote?.status === "loading";
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const animate = via === "pointer";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop
          data-animate={animate || undefined}
          className="fixed inset-0 z-50 bg-[oklch(0.2_0.01_165/0.28)] data-animate:transition-opacity data-animate:duration-150 data-starting-style:data-animate:opacity-0 max-sm:hidden dark:bg-black/55"
        />
        <Dialog.Popup
          aria-label="Command palette"
          initialFocus={inputRef}
          data-animate={animate || undefined}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-popover text-popover-foreground outline-none",
            // Phones: the whole screen, clear of the notch and the home indicator.
            "max-sm:inset-0 max-sm:pt-[env(safe-area-inset-top)] max-sm:pb-[env(safe-area-inset-bottom)]",
            // Larger screens: a floating panel high on the page, so results grow downwards.
            "sm:top-[12vh] sm:left-1/2 sm:max-h-[min(34rem,calc(100dvh-16vh))] sm:w-[min(40rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-xl sm:shadow-[0_0_0_1px_oklch(0.2_0.02_165/0.08),0_8px_16px_-4px_oklch(0.2_0.02_165/0.08),0_24px_48px_-8px_oklch(0.2_0.02_165/0.18)] sm:dark:shadow-[0_0_0_1px_oklch(1_0_0/0.1),0_16px_48px_oklch(0_0_0/0.5)]",
            "data-animate:transition-[opacity,scale] data-animate:duration-150 data-animate:ease-[cubic-bezier(0.23,1,0.32,1)] data-starting-style:data-animate:opacity-0 data-starting-style:data-animate:scale-[0.98] motion-reduce:data-starting-style:scale-100",
          )}
        >
          <Autocomplete.Root
            open
            inline
            items={groups}
            filter={null}
            value={query}
            onValueChange={(v, details) => {
              if (details.reason !== "item-press") setQuery(v);
            }}
            itemToStringValue={(item: Item) => item.label}
            autoHighlight="always"
            keepHighlight
            onItemHighlighted={(item: Item | undefined, details) => {
              // Warm the route while the row is highlighted from the keyboard.
              if (item?.href && details.reason === "keyboard") router.prefetch(item.href);
            }}
          >
            <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4 max-sm:h-14 max-sm:pr-2">
              {searching ? (
                <LoaderCircleIcon aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" strokeWidth={1.75} />
              ) : (
                <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
              )}
              <Autocomplete.Input
                ref={inputRef}
                aria-label="Search pages, contacts, campaigns and actions"
                aria-describedby={`palette-help-${session}`}
                placeholder={isMobile ? "Search pages, contacts, ads…" : "Search pages, contacts, campaigns and actions…"}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground/80 max-sm:text-base"
              />
              <Dialog.Close className="hidden h-11 shrink-0 items-center rounded-md px-3 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:inline-flex">
                Cancel
              </Dialog.Close>
              <kbd aria-hidden className={cn(KBD, "max-sm:hidden")}>
                Esc
              </kbd>
            </div>

            <Autocomplete.List
              aria-label="Results"
              aria-busy={searching || undefined}
              className={cn(
                "min-h-0 flex-1 scroll-py-1.5 overflow-y-auto overscroll-contain p-1.5 outline-none sm:max-h-[26rem]",
                count === 0 && "hidden",
              )}
            >
              {(group: Group) => (
                <Autocomplete.Group key={group.value} items={group.items} className="not-last:mb-1">
                  <Autocomplete.GroupLabel className="flex h-7 items-end px-2.5 pb-1 text-[11px] leading-4 font-medium tracking-[0.04em] text-muted-foreground/80 uppercase select-none">
                    {group.label}
                  </Autocomplete.GroupLabel>
                  <Autocomplete.Collection>{(item: Item) => <Row key={item.id} item={item} onChoose={choose} />}</Autocomplete.Collection>
                </Autocomplete.Group>
              )}
            </Autocomplete.List>

            {count === 0 ? (
              <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-1 px-6 py-10 text-center">
                {searching ? (
                  <p className="text-sm text-muted-foreground">Searching…</p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-foreground">No matches for “{term}”</p>
                    <p className="text-[13px] text-pretty text-muted-foreground">Try a page, a contact’s name or email, or a campaign.</p>
                  </>
                )}
              </div>
            ) : null}

            {remote?.status === "error" ? (
              <p role="alert" className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                Couldn’t search contacts and ads. Check your connection and try again.
              </p>
            ) : null}

            <Autocomplete.Status className="sr-only">
              {searching ? "Searching…" : term ? `${count} ${count === 1 ? "result" : "results"}` : ""}
            </Autocomplete.Status>

            <div
              id={`palette-help-${session}`}
              className="flex h-10 shrink-0 items-center gap-4 border-t border-border px-4 text-xs text-muted-foreground max-sm:hidden"
            >
              <span className="inline-flex items-center gap-1.5">
                <kbd aria-hidden className={KBD}>↑</kbd>
                <kbd aria-hidden className={KBD}>↓</kbd>
                <span>to move</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd aria-hidden className={KBD}>
                  <CornerDownLeftIcon className="size-3" strokeWidth={2} />
                </kbd>
                <span>to open</span>
              </span>
              <span className="ml-auto inline-flex items-center gap-1.5">
                <span>Type</span>
                <kbd aria-hidden className={KBD}>&gt;</kbd>
                <span>for actions,</span>
                <kbd aria-hidden className={KBD}>?</kbd>
                <span>to ask AI</span>
              </span>
            </div>
          </Autocomplete.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const Row = memo(function Row({ item, onChoose }: { item: Item; onChoose: (item: Item, event?: { metaKey?: boolean; ctrlKey?: boolean }) => void }) {
  return (
    <Autocomplete.Item
      value={item}
      disabled={item.disabled}
      onClick={(e) => onChoose(item, e)}
      className="group/row flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 text-[13px] outline-none select-none [scroll-margin-block:0.375rem] data-disabled:opacity-60 data-highlighted:bg-foreground/[0.06] max-sm:h-11 dark:data-highlighted:bg-foreground/[0.08]"
    >
      <RowIcon item={item} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-foreground">{item.label}</span>
        {item.subtitle ? <span className="min-w-0 truncate text-xs text-muted-foreground">{item.subtitle}</span> : null}
      </span>
      {item.hotkey ? (
        <Keycaps keys={item.hotkey} className="max-sm:hidden" />
      ) : item.hint ? (
        <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>
      ) : null}
    </Autocomplete.Item>
  );
});

function RowIcon({ item }: { item: Item }) {
  if (item.avatar) {
    return (
      <span aria-hidden style={tintStyle(item.avatar)} className={cn(TINT, "flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-semibold tracking-tight")}>
        {initialsOf(item.label)}
      </span>
    );
  }
  if (item.platform) {
    return (
      <span aria-hidden className="flex size-5 shrink-0 items-center justify-center">
        <BrandGlyph id={item.platform} className="size-3.5" />
      </span>
    );
  }
  const Icon = item.icon ?? SearchIcon;
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center text-muted-foreground group-data-highlighted/row:text-foreground">
      <Icon className="size-4" strokeWidth={1.75} />
    </span>
  );
}
