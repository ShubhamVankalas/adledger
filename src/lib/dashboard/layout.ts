import { z } from "zod";
import { METRIC_KEYS } from "@/lib/metrics";
import { WIDGET_SIZES, isKpiType, widgetMeta, type WidgetSettings } from "@/lib/widgets/catalog";
import { MAX_PINNED, MAX_SECTION_ITEMS, MAX_SECTIONS, MAX_TITLE, type Layout, type Section, type WidgetInstance } from "./types";

// Layout parsing. Reads are lenient: a bad item is dropped, a bad setting is unset, a size a
// widget doesn't allow snaps to its default, and a widget type this version doesn't know is KEPT
// (it renders a "Widget unavailable" card, so a downgrade never destroys a saved board). Only a
// layout that isn't a v1 object at all falls back to the preset.

/** Each field falls back to "unset" when a stored value is invalid. Unknown keys are stripped. */
export const widgetSettingsSchema = z.object({
  title: z.string().trim().min(1).max(MAX_TITLE).optional().catch(undefined),
  metric: z.enum(METRIC_KEYS).optional().catch(undefined),
  sort: z.enum(["revenue", "roas", "worst"]).optional().catch(undefined),
  interval: z.enum(["day", "week", "month"]).optional().catch(undefined),
  topN: z.number().int().min(3).max(10).optional().catch(undefined),
  target: z.number().positive().max(1e15).optional().catch(undefined),
});

const ID = /^[A-Za-z0-9_-]{1,40}$/;
/** "kpi.roas", "chart.spendRevenue": a lowercase group, a dot, a camelCase name. */
const TYPE = /^[a-z]{2,16}\.[A-Za-z0-9]{2,40}$/;

const instanceSchema = z.object({
  id: z.string().regex(ID),
  type: z.string().regex(TYPE),
  size: z.enum(WIDGET_SIZES).catch("m"),
  settings: z.unknown().optional(),
});

const sectionSchema = z.object({
  id: z.string().regex(ID),
  title: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE))
    .catch(""),
  collapsed: z.boolean().catch(false),
  items: z.array(z.unknown()).catch([]),
});

const layoutSchema = z.object({
  v: z.literal(1),
  pinned: z.array(z.unknown()).catch([]),
  sections: z.array(z.unknown()).catch([]),
});

function cleanSettings(raw: unknown): WidgetSettings | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = widgetSettingsSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const entries = Object.entries(parsed.data).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as WidgetSettings) : undefined;
}

/** Parse one widget instance; null when it can't be salvaged. */
function parseInstance(raw: unknown): WidgetInstance | null {
  const r = instanceSchema.safeParse(raw);
  if (!r.success) return null;
  const meta = widgetMeta(r.data.type);
  const size = meta && !meta.allowedSizes.includes(r.data.size) ? meta.defaultSize : r.data.size;
  const settings = cleanSettings(r.data.settings);
  return { id: r.data.id, type: r.data.type, size, ...(settings ? { settings } : {}) };
}

/**
 * Validate a stored or submitted layout. Returns `fallback` when `raw` is not a v1 layout.
 * Guarantees: unique ids, known single-instance widgets at most once, pinned = KPI tiles only
 * (max 6), at most 12 sections of at most 24 widgets, titles trimmed to 60 characters.
 */
export function parseLayout(raw: unknown, fallback: Layout): Layout {
  const top = layoutSchema.safeParse(raw);
  if (!top.success) return structuredClone(fallback);
  const seenIds = new Set<string>();
  const seenTypes = new Set<string>();
  const accept = (w: WidgetInstance | null): w is WidgetInstance => {
    if (!w || seenIds.has(w.id)) return false;
    const meta = widgetMeta(w.type);
    // Single-instance widgets appear once; unknown types can't be judged, so they're kept.
    if (meta && !meta.multi && seenTypes.has(w.type)) return false;
    seenIds.add(w.id);
    seenTypes.add(w.type);
    return true;
  };

  const take = (list: unknown[], max: number, only?: (w: WidgetInstance) => boolean) => {
    const out: WidgetInstance[] = [];
    for (const raw of list) {
      if (out.length >= max) break;
      const w = parseInstance(raw);
      if (w && (!only || only(w)) && accept(w)) out.push(w);
    }
    return out;
  };

  const pinned = take(top.data.pinned, MAX_PINNED, (w) => isKpiType(w.type)).map((w) => ({ ...w, size: "s" as const }));

  const sections: Section[] = [];
  for (const rawSection of top.data.sections) {
    if (sections.length >= MAX_SECTIONS) break;
    const s = sectionSchema.safeParse(rawSection);
    if (!s.success || seenIds.has(s.data.id)) continue;
    seenIds.add(s.data.id);
    sections.push({ id: s.data.id, title: s.data.title, collapsed: s.data.collapsed, items: take(s.data.items, MAX_SECTION_ITEMS) });
  }
  return { v: 1, pinned, sections };
}

/** True when `raw` would parse without falling back (used to reject garbage on save). */
export const isLayoutShape = (raw: unknown) => layoutSchema.safeParse(raw).success;
