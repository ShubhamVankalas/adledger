import type { SavedViewPage } from "./db/schema";

// Saved views: a named snapshot of a report page's URL state. Shared views (user_id null) are
// visible to everyone in the workspace; personal views only to their owner. Only whitelisted,
// non-PII query keys are ever stored, so a view can't smuggle arbitrary data into a URL.
// This file is the client-safe half (no database imports); storage lives in views.ts.

export type SavedView = {
  id: string;
  page: SavedViewPage;
  name: string;
  params: Record<string, string>;
  pinned: boolean;
  position: number;
  shared: boolean;
  /** True when the viewer owns this personal view. */
  mine: boolean;
  /** Link that reopens the view (see viewHref). */
  href: string;
};

export const VIEW_PAGES: Record<SavedViewPage, { path: string; label: string; keys: readonly string[] }> = {
  performance: {
    path: "/performance",
    label: "Performance",
    keys: ["range", "from", "to", "model", "platform", "compare", "level", "parent", "q", "preset", "cols", "density", "sort", "dir", "mode"],
  },
};

export const VIEW_NAME_MAX = 60;
export const VIEWS_PER_PAGE_MAX = 50;
/** The sidebar shows at most this many pinned views. */
export const PINNED_VIEWS_MAX = 8;
const VALUE_MAX = 300;

export function isViewPage(v: unknown): v is SavedViewPage {
  return typeof v === "string" && Object.hasOwn(VIEW_PAGES, v);
}

/** Keep only the page's whitelisted keys with short, printable string values. */
export function sanitizeViewParams(page: SavedViewPage, input: unknown): Record<string, string> {
  const keys = VIEW_PAGES[page].keys;
  const entries: [string, unknown][] =
    input instanceof URLSearchParams
      ? [...input.entries()]
      : typeof input === "string"
        ? [...new URLSearchParams(input).entries()]
        : input && typeof input === "object"
          ? Object.entries(input)
          : [];
  const out: Record<string, string> = {};
  for (const [k, raw] of entries) {
    if (!keys.includes(k) || typeof raw !== "string") continue;
    // Control characters never belong in a query value.
    // eslint-disable-next-line no-control-regex
    const v = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, VALUE_MAX);
    if (v) out[k] = v;
  }
  return out;
}

export function cleanViewName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const v = name.replace(/\s+/g, " ").trim().slice(0, VIEW_NAME_MAX);
  return v || null;
}

/**
 * Link that reopens a view: its params in the page's canonical key order (jsonb doesn't keep
 * insertion order) plus `view=<id>` so the page can show it as active.
 */
export function viewHref(v: { id: string; page: SavedViewPage; params: Record<string, string> }): string {
  const qs = new URLSearchParams();
  for (const k of VIEW_PAGES[v.page].keys) if (v.params[k]) qs.set(k, v.params[k]);
  qs.set("view", v.id);
  return `${VIEW_PAGES[v.page].path}?${qs}`;
}

/** True when two param sets hold the same whitelisted values (order and unknown keys ignored). */
export function sameViewParams(page: SavedViewPage, a: unknown, b: unknown): boolean {
  const x = sanitizeViewParams(page, a);
  const y = sanitizeViewParams(page, b);
  return VIEW_PAGES[page].keys.every((k) => (x[k] ?? "") === (y[k] ?? ""));
}
