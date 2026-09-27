import { isKpiType, widgetMeta, type WidgetSize } from "@/lib/widgets/catalog";
import { MAX_PINNED, MAX_SECTION_ITEMS, MAX_SECTIONS, MAX_TITLE, type Layout, type Section, type WidgetInstance } from "./types";

// Pure, immutable edits on a layout (edit mode, pinning). Client-safe and unit-tested; the server
// re-validates whatever is saved with parseLayout().

export const PINNED = "pinned";
export type ContainerId = typeof PINNED | string;

export type Located = { container: ContainerId; index: number; item: WidgetInstance };

export function locate(layout: Layout, id: string): Located | null {
  const p = layout.pinned.findIndex((w) => w.id === id);
  if (p !== -1) return { container: PINNED, index: p, item: layout.pinned[p] };
  for (const s of layout.sections) {
    const i = s.items.findIndex((w) => w.id === id);
    if (i !== -1) return { container: s.id, index: i, item: s.items[i] };
  }
  return null;
}

export const itemsOf = (layout: Layout, container: ContainerId): WidgetInstance[] =>
  container === PINNED ? layout.pinned : (layout.sections.find((s) => s.id === container)?.items ?? []);

function withItems(layout: Layout, container: ContainerId, items: WidgetInstance[]): Layout {
  if (container === PINNED) return { ...layout, pinned: items };
  return { ...layout, sections: layout.sections.map((s) => (s.id === container ? { ...s, items } : s)) };
}

export const typesOnBoard = (layout: Layout) => new Set([...layout.pinned, ...layout.sections.flatMap((s) => s.items)].map((w) => w.type));

/** Can this widget go into that container (pinned takes KPI tiles only, up to 6)? */
export function canDrop(layout: Layout, item: WidgetInstance, container: ContainerId): boolean {
  const target = itemsOf(layout, container);
  const already = target.some((w) => w.id === item.id);
  if (container === PINNED) return isKpiType(item.type) && (already || target.length < MAX_PINNED);
  return already || target.length < MAX_SECTION_ITEMS;
}

/** Move a widget to `index` in `container` (another section or the pinned strip). */
export function moveItem(layout: Layout, id: string, container: ContainerId, index: number): Layout {
  const from = locate(layout, id);
  if (!from || !canDrop(layout, from.item, container)) return layout;
  const item = container === PINNED ? { ...from.item, size: "s" as WidgetSize } : from.item;
  const removed = withItems(layout, from.container, itemsOf(layout, from.container).filter((w) => w.id !== id));
  const target = [...itemsOf(removed, container)];
  target.splice(Math.max(0, Math.min(index, target.length)), 0, item);
  return withItems(removed, container, target);
}

/**
 * Move one step earlier (-1) or later (+1) in reading order, crossing into the neighbouring
 * section at the edges (the mobile reorder list and the keyboard "Move up/down" items).
 */
export function moveItemBy(layout: Layout, id: string, delta: -1 | 1): Layout {
  const at = locate(layout, id);
  if (!at) return layout;
  const list = itemsOf(layout, at.container);
  const next = at.index + delta;
  if (next >= 0 && next < list.length) return moveItem(layout, id, at.container, next);
  if (at.container === PINNED) return layout;
  const si = layout.sections.findIndex((s) => s.id === at.container);
  const neighbour = layout.sections[si + delta];
  if (!neighbour) return layout;
  return moveItem(layout, id, neighbour.id, delta === 1 ? 0 : neighbour.items.length);
}

export function removeItem(layout: Layout, id: string): Layout {
  const at = locate(layout, id);
  return at ? withItems(layout, at.container, itemsOf(layout, at.container).filter((w) => w.id !== id)) : layout;
}

export function setItemSize(layout: Layout, id: string, size: WidgetSize): Layout {
  const at = locate(layout, id);
  const meta = at && widgetMeta(at.item.type);
  if (!at || at.container === PINNED || (meta && !meta.allowedSizes.includes(size))) return layout;
  return withItems(
    layout,
    at.container,
    itemsOf(layout, at.container).map((w) => (w.id === id ? { ...w, size } : w)),
  );
}

let counter = 0;
/** Short id unique within the layout ("roas-k3x9"). */
export function newId(layout: Layout, type: string): string {
  const taken = new Set([...layout.pinned, ...layout.sections.flatMap((s) => [s, ...s.items])].map((x) => x.id));
  const base = type.replace(/^[a-z]+\./, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).slice(0, 28);
  for (;;) {
    const id = `${base}-${(Date.now() + counter++).toString(36).slice(-4)}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Add a widget: KPI tiles join the pinned strip while it has room, everything else goes to the
 * end of `sectionId` (default: the first section; a section is created when there is none).
 */
export function addWidget(layout: Layout, type: string, sectionId?: string): { layout: Layout; id: string | null } {
  const meta = widgetMeta(type);
  if (!meta) return { layout, id: null };
  if (!meta.multi && typesOnBoard(layout).has(type)) return { layout, id: null };
  const id = newId(layout, type);
  const item: WidgetInstance = { id, type, size: meta.defaultSize };
  if (meta.category === "kpi" && layout.pinned.length < MAX_PINNED && !sectionId) return { layout: { ...layout, pinned: [...layout.pinned, item] }, id };
  let next = layout;
  let target = sectionId ?? layout.sections[0]?.id;
  if (!target) {
    next = addSection(layout, "Widgets").layout;
    target = next.sections[0].id;
  }
  if (itemsOf(next, target).length >= MAX_SECTION_ITEMS) return { layout, id: null };
  return { layout: withItems(next, target, [...itemsOf(next, target), item]), id };
}

/**
 * Pin or unpin a KPI tile. Unpinning removes it from the strip; pinning moves it from a section
 * into the strip (or adds a fresh tile of that type when it isn't on the board).
 */
export function togglePin(layout: Layout, type: string): { layout: Layout; pinned: boolean } | null {
  if (!isKpiType(type) || !widgetMeta(type)) return null;
  const inStrip = layout.pinned.find((w) => w.type === type);
  if (inStrip) return { layout: { ...layout, pinned: layout.pinned.filter((w) => w.id !== inStrip.id) }, pinned: false };
  if (layout.pinned.length >= MAX_PINNED) return null;
  const elsewhere = layout.sections.flatMap((s) => s.items).find((w) => w.type === type);
  if (elsewhere) return { layout: moveItem(layout, elsewhere.id, PINNED, layout.pinned.length), pinned: true };
  return { layout: { ...layout, pinned: [...layout.pinned, { id: newId(layout, type), type, size: "s" }] }, pinned: true };
}

// ---------------------------------------------------------------- sections

export function addSection(layout: Layout, title = "New section"): { layout: Layout; id: string | null } {
  if (layout.sections.length >= MAX_SECTIONS) return { layout, id: null };
  const id = newId(layout, "section.s");
  const section: Section = { id, title: title.slice(0, MAX_TITLE), collapsed: false, items: [] };
  return { layout: { ...layout, sections: [...layout.sections, section] }, id };
}

export function renameSection(layout: Layout, id: string, title: string): Layout {
  const clean = title.replace(/\s+/g, " ").trimStart().slice(0, MAX_TITLE);
  return { ...layout, sections: layout.sections.map((s) => (s.id === id ? { ...s, title: clean } : s)) };
}

export function moveSection(layout: Layout, id: string, delta: -1 | 1): Layout {
  const i = layout.sections.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= layout.sections.length) return layout;
  const sections = [...layout.sections];
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return { ...layout, sections };
}

/** Delete a section and the widgets in it. */
export function deleteSection(layout: Layout, id: string): Layout {
  return { ...layout, sections: layout.sections.filter((s) => s.id !== id) };
}

export function setSectionCollapsed(layout: Layout, id: string, collapsed: boolean): Layout {
  return { ...layout, sections: layout.sections.map((s) => (s.id === id ? { ...s, collapsed } : s)) };
}

/** Same type and settings render the same body (lets "Reset to preset" reuse what's on screen). */
export const widgetSig = (item: Pick<WidgetInstance, "type" | "settings">) => `${item.type}|${JSON.stringify(item.settings ?? {})}`;

/** Stable comparison for "unsaved changes" (layouts are small plain JSON). */
export const sameLayout = (a: Layout, b: Layout) => JSON.stringify(a) === JSON.stringify(b);
