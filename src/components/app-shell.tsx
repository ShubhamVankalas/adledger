"use client";

import { FlaskConicalIcon, SearchIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { createContext, use, useEffect, useState, useSyncExternalStore } from "react";
import { DEMO_PILL_COOKIE } from "@/components/shell-constants";
import { cn } from "@/lib/utils";

/** Window events the shell dispatches; the command palette and the shortcut sheet listen for them. */
export const OPEN_PALETTE_EVENT = "adledger:open-palette";
export const OPEN_SHORTCUTS_EVENT = "adledger:open-shortcuts";
export const openPalette = () => window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT));
export const openShortcuts = () => window.dispatchEvent(new CustomEvent(OPEN_SHORTCUTS_EVENT));


type Shell = {
  workspaceId: string;
  isDemo: boolean;
  /** The viewer may clear demo data (workspace.data). */
  canUseRealData: boolean;
  demoPillHidden: boolean;
};

const ShellContext = createContext<Shell | null>(null);

/** Workspace facts the page header needs without every page fetching them (set once in the (app) layout). */
export function ShellProvider({ value, children }: { value: Shell; children: React.ReactNode }) {
  return <ShellContext value={value}>{children}</ShellContext>;
}

export function useShell() {
  return use(ShellContext);
}

/* ------------------------------------------------------------------------------------------------
 * Pending navigation: a 2px brand line along the bottom of the page header while a navigation or
 * filter transition is in flight. Sources register by name so a filter change and a link click
 * don't cancel each other.
 * --------------------------------------------------------------------------------------------- */

const sources = new Set<string>();
const listeners = new Set<() => void>();
let timeout: ReturnType<typeof setTimeout> | undefined;

function emit() {
  for (const l of listeners) l();
}

export const navProgress = {
  start(source = "nav") {
    if (sources.has(source)) return;
    sources.add(source);
    // Never spin forever if a navigation is abandoned (e.g. the server redirected elsewhere).
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      sources.clear();
      emit();
    }, 12_000);
    emit();
  },
  done(source = "nav") {
    if (!sources.delete(source)) return;
    if (sources.size === 0) clearTimeout(timeout);
    emit();
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const isPending = () => sources.size > 0;

/** An internal link click that will change the page (not a new tab, download or same-page hash). */
function navigatesAway(e: MouseEvent): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const a = (e.target as Element | null)?.closest?.("a[href]");
  if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download")) return false;
  const url = new URL(a.href, location.href);
  if (url.origin !== location.origin) return false;
  return url.pathname !== location.pathname || url.search !== location.search;
}

export function PendingBar() {
  const pending = useSyncExternalStore(subscribe, isPending, () => false);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (navigatesAway(e)) navProgress.start("nav");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // The route (or its query) changed: that navigation has landed.
  useEffect(() => {
    navProgress.done("nav");
  }, [pathname, search]);

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -bottom-px h-0.5 overflow-hidden">
      {pending ? (
        <div className="pending-line h-full w-full bg-brand" />
      ) : null}
    </div>
  );
}

/** Mobile header search button (the sidebar holds the desktop one). */
export function HeaderSearchButton() {
  return (
    <button
      type="button"
      onClick={openPalette}
      aria-label="Search"
      className="-mr-1.5 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:hidden"
    >
      <SearchIcon aria-hidden className="size-[18px]" strokeWidth={1.75} />
    </button>
  );
}

/** "Sample data" pill in the page header of a demo workspace. Dismissible; remembered per workspace. */
export function DemoPill() {
  const shell = useShell();
  const [hidden, setHidden] = useState(false);
  if (!shell?.isDemo || shell.demoPillHidden || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    document.cookie = `${DEMO_PILL_COOKIE}=${shell.workspaceId}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  };

  return (
    <span
      role="note"
      className="hidden h-6 shrink-0 items-center gap-1.5 rounded-full bg-brand-soft pr-0.5 pl-2 text-micro text-brand-foreground sm:inline-flex"
    >
      <FlaskConicalIcon aria-hidden className="size-3" strokeWidth={2} />
      <span className="whitespace-nowrap">Sample data</span>
      {shell.canUseRealData ? (
        <>
          <span aria-hidden className="opacity-50">
            ·
          </span>
          <Link
            href="/settings/workspace"
            className="rounded-sm whitespace-nowrap underline decoration-current/30 underline-offset-2 outline-none hover:decoration-current focus-visible:outline-2 focus-visible:outline-ring"
          >
            Use real data
          </Link>
        </>
      ) : null}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Hide the sample data notice"
        className={cn(
          "ml-0.5 inline-flex size-5 items-center justify-center rounded-full outline-none",
          "transition-colors duration-100 hover:bg-brand/15 focus-visible:outline-2 focus-visible:outline-ring",
        )}
      >
        <XIcon aria-hidden className="size-3" strokeWidth={2} />
      </button>
    </span>
  );
}
