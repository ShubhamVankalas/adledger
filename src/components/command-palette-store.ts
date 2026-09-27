import type { SearchKind } from "@/lib/search";

// Browser-side state shared by the palette shell and its dialog: window events other components
// dispatch to open the palette or the shortcuts sheet, and "Recent" (per workspace, this browser only).

/** window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail: { query?: string } })) opens ⌘K. */
export const OPEN_PALETTE_EVENT = "adledger:open-palette";
/** window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT)) opens the "?" sheet. */
export const OPEN_SHORTCUTS_EVENT = "adledger:open-shortcuts";

export function openCommandPalette(detail: { query?: string } = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_PALETTE_EVENT, { detail }));
}

export function openShortcutsSheet() {
  window.dispatchEvent(new Event(OPEN_SHORTCUTS_EVENT));
}

export type RecentEntry = {
  id: string;
  label: string;
  subtitle?: string | null;
  href: string;
  kind: "page" | SearchKind;
  platform?: string | null;
};

const MAX_RECENT = 5;
const KINDS = new Set(["page", "contact", "campaign", "ad_group", "ad"]);
const key = (workspaceId: string) => `adledger:palette-recent:v1:${workspaceId}`;

function valid(e: unknown): e is RecentEntry {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.label === "string" &&
    typeof r.kind === "string" &&
    KINDS.has(r.kind) &&
    typeof r.href === "string" &&
    // Only same-site paths: storage is editable, and router.push must never get another origin.
    r.href.startsWith("/") &&
    !r.href.startsWith("//") &&
    !r.href.includes("\\")
  );
}

export function readRecent(workspaceId: string): RecentEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key(workspaceId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

/** Put `entry` first (deduplicated) and return the new list. Storage failures are ignored. */
export function pushRecent(workspaceId: string, entry: RecentEntry): RecentEntry[] {
  const list = [entry, ...readRecent(workspaceId).filter((r) => r.id !== entry.id)].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(key(workspaceId), JSON.stringify(list));
  } catch {
    // private mode or quota: Recent just won't persist
  }
  return list;
}
