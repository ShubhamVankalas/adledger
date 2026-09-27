import { useEffect, useRef, useSyncExternalStore } from "react";

// One registry for every keyboard shortcut in the app (no dependency). Components register
// shortcuts with useHotkeys(); the "?" sheet renders straight from the registry, so a shortcut
// that isn't registered can't be advertised.
//
// Key strings: steps separated by a space ("g o" = G then O within 1s), modifiers joined with
// "+" ("mod+k" = ⌘K on a Mac, Ctrl K elsewhere; "shift+x"). Keys match `event.key`, so they
// follow the user's keyboard layout.

export type HotkeyStep = { key: string; mod: boolean; shift: boolean; alt: boolean };

export type HotkeyDef = {
  /** Stable id, unique across the app ("nav.overview"). A later registration with the same id wins. */
  id: string;
  keys: string;
  /** Sentence case, shown in the "?" sheet. */
  label: string;
  /** Heading in the "?" sheet ("General", "Navigation", "Tables"…). */
  group: string;
  /** Return false when nothing was done, so the key press keeps its default behaviour. Omit for a documentation-only entry. */
  run?: (event: KeyboardEvent) => void | false;
  /** Also fire while typing in an input (only sensible with a modifier, e.g. mod+k). */
  allowInInputs?: boolean;
  /** Registered and active, but left out of the "?" sheet. */
  hidden?: boolean;
};

export type KeyEventLike = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export const SEQUENCE_TIMEOUT_MS = 1000;

const NAMED: Record<string, string> = { esc: "escape", space: " ", return: "enter", up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright" };
// What US-layout Shift turns a key into, so "shift+[" matches the "{" that event.key reports.
const SHIFTED: Record<string, string> = { "[": "{", "]": "}", "/": "?", ",": "<", ".": ">", ";": ":", "'": '"', "-": "_", "=": "+", "`": "~", "\\": "|" };

/** "g o" → [{key:"g"}, {key:"o"}]; "mod+shift+k" → [{key:"k", mod, shift}]. Throws on an empty or malformed string. */
export function parseHotkey(keys: string): HotkeyStep[] {
  const steps = keys.trim().split(/\s+/).filter(Boolean);
  if (steps.length === 0) throw new Error("Empty hotkey");
  return steps.map((step) => {
    // Split on "+" but keep a literal "+" key ("mod++" or "+").
    const parts = step === "+" ? ["+"] : step.endsWith("++") ? [...step.slice(0, -2).split("+"), "+"] : step.split("+");
    const key = parts.pop()?.toLowerCase();
    if (!key) throw new Error(`Malformed hotkey: ${keys}`);
    const mods = new Set(parts.map((p) => p.toLowerCase()));
    for (const m of mods) if (!["mod", "shift", "alt"].includes(m)) throw new Error(`Unknown modifier "${m}" in ${keys}`);
    return { key: NAMED[key] ?? key, mod: mods.has("mod"), shift: mods.has("shift"), alt: mods.has("alt") };
  });
}

const isLetter = (k: string) => k.length === 1 && k.toLowerCase() !== k.toUpperCase();

/** Whether one key press satisfies one step. */
export function matchesStep(step: HotkeyStep, e: KeyEventLike): boolean {
  if (step.mod !== (e.metaKey || e.ctrlKey)) return false;
  if (step.alt !== e.altKey) return false;
  const key = e.key.toLowerCase();
  if (isLetter(step.key) || step.key.length > 1) {
    // Letters and named keys: Shift must match exactly ("x" ≠ "shift+x").
    return key === step.key && step.shift === e.shiftKey;
  }
  // Symbols: the layout decides whether Shift is needed to type "?", so ignore it unless asked for.
  if (step.shift) return key === (SHIFTED[step.key] ?? step.key) || (key === step.key && e.shiftKey);
  return key === step.key;
}

/**
 * Pure matcher: feed it key presses (with a timestamp) and it answers which shortcut fired.
 * A key that starts a sequence waits for the next key; a single-key shortcut on the same key
 * is not supported (keep prefixes like "g" free).
 */
export function createMatcher(getDefs: () => readonly { id: string; steps: HotkeyStep[] }[]) {
  let pending: { steps: HotkeyStep[]; at: number } | null = null;
  return {
    press(e: KeyEventLike, now: number): { match: string | null; waiting: boolean } {
      const defs = getDefs();
      if (pending && now - pending.at > SEQUENCE_TIMEOUT_MS) pending = null;
      if (pending) {
        const prefix = pending.steps;
        const n = prefix.length;
        const candidates = defs.filter((d) => d.steps.length > n && prefix.every((s, i) => sameStep(s, d.steps[i])));
        const hit = candidates.find((d) => matchesStep(d.steps[n], e));
        if (hit) {
          if (hit.steps.length === n + 1) {
            pending = null;
            return { match: hit.id, waiting: false };
          }
          pending = { steps: hit.steps.slice(0, n + 1), at: now };
          return { match: null, waiting: true };
        }
        pending = null; // wrong second key: drop the sequence and treat this press on its own
      }
      const starts = defs.find((d) => d.steps.length > 1 && matchesStep(d.steps[0], e));
      if (starts) {
        pending = { steps: starts.steps.slice(0, 1), at: now };
        return { match: null, waiting: true };
      }
      const single = defs.find((d) => d.steps.length === 1 && matchesStep(d.steps[0], e));
      return { match: single?.id ?? null, waiting: false };
    },
    reset() {
      pending = null;
    },
  };
}

const sameStep = (a: HotkeyStep, b: HotkeyStep) => a.key === b.key && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt;

/**
 * True when the key press belongs to a text field or to a widget with keys of its own (menus and
 * listboxes type-ahead on letters; an open dialog owns the keyboard until it closes).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const el = target as HTMLElement;
  if (el.isContentEditable) return true;
  return Boolean(
    el.closest(
      "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='menu'], [role='menubar'], [role='listbox'], [role='combobox'], [role='textbox'], [role='dialog'], [role='alertdialog']",
    ),
  );
}

// ---------------------------------------------------------------- registry (client)

type Entry = HotkeyDef & { steps: HotkeyStep[]; order: number };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let snapshot: readonly HotkeyDef[] = [];
let counter = 0;

function emit() {
  snapshot = [...entries.values()].sort((a, b) => a.order - b.order);
  for (const l of listeners) l();
}

const matcher = createMatcher(() => [...entries.values()].filter((e) => e.run));

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing || e.key === "Process" || !e.key) return;
  if (["Shift", "Control", "Meta", "Alt", "CapsLock"].includes(e.key)) return;
  const typing = isTypingTarget(e.target);
  // While typing, only shortcuts that opt in (with a modifier) are considered, and no sequence starts.
  if (typing && !(e.metaKey || e.ctrlKey || e.altKey)) {
    matcher.reset();
    return;
  }
  const { match, waiting } = matcher.press(e, e.timeStamp || performance.now());
  if (waiting) return;
  if (!match) return;
  const entry = entries.get(match);
  if (!entry?.run || (typing && !entry.allowInInputs)) return;
  if (entry.run(e) !== false) e.preventDefault();
}

let installed = false;
function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", onKeyDown);
}

/** Register shortcuts imperatively; returns the unregister function. */
export function registerHotkeys(defs: HotkeyDef[]): () => void {
  install();
  const added = defs.map((d) => {
    const entry: Entry = { ...d, steps: parseHotkey(d.keys), order: counter++ };
    entries.set(d.id, entry);
    return entry;
  });
  emit();
  return () => {
    let changed = false;
    for (const e of added) {
      if (entries.get(e.id) === e) {
        entries.delete(e.id);
        changed = true;
      }
    }
    if (changed) emit();
  };
}

/**
 * Register shortcuts for as long as the calling component is mounted (page-scoped shortcuts
 * disappear from the sheet when the page unmounts). Handlers may change every render; only a
 * change in ids, keys or labels re-registers.
 */
export function useHotkeys(defs: HotkeyDef[]) {
  const latest = useRef(defs);
  useEffect(() => {
    latest.current = defs;
  });
  const signature = defs.map((d) => `${d.id}\u0000${d.keys}\u0000${d.label}\u0000${d.group}\u0000${d.hidden ? 1 : 0}\u0000${d.run ? 1 : 0}`).join("\u0001");
  useEffect(() => {
    const current = latest.current;
    return registerHotkeys(
      current.map((d, i) => ({
        ...d,
        run: d.run ? (e: KeyboardEvent) => (latest.current[i]?.run ?? d.run)!(e) : undefined,
      })),
    );
  }, [signature]);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => snapshot;
const EMPTY: readonly HotkeyDef[] = [];

/** Every registered shortcut, in registration order (for the "?" sheet). */
export function useHotkeyList(): readonly HotkeyDef[] {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

// ---------------------------------------------------------------- display

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent);
}

const LABELS: Record<string, string> = { escape: "Esc", enter: "Enter", " ": "Space", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→", backspace: "⌫", tab: "Tab" };

/**
 * Keycaps for display: "g o" → [["G"], ["O"]] (one array per step); "mod+k" → [["⌘", "K"]] on
 * Apple platforms and [["Ctrl", "K"]] elsewhere.
 */
export function hotkeyKeycaps(keys: string, apple = isApplePlatform()): string[][] {
  return parseHotkey(keys).map((s) => {
    const caps: string[] = [];
    if (s.mod) caps.push(apple ? "⌘" : "Ctrl");
    if (s.alt) caps.push(apple ? "⌥" : "Alt");
    if (s.shift) caps.push(apple ? "⇧" : "Shift");
    caps.push(LABELS[s.key] ?? (s.key.length === 1 ? s.key.toUpperCase() : s.key[0].toUpperCase() + s.key.slice(1)));
    return caps;
  });
}

/** Plain-text version for aria-keyshortcuts-style hints ("G then O", "Ctrl K"). */
export function hotkeyText(keys: string, apple = isApplePlatform()): string {
  return hotkeyKeycaps(keys, apple)
    .map((caps) => caps.join(apple ? "" : " "))
    .join(" then ");
}
