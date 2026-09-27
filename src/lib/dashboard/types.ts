import type { WidgetSettings, WidgetSize } from "@/lib/widgets/catalog";

// Overview layout model (BRIEF §4.1): CSS-grid spans with fixed size presets, never free pixel
// positions. Stored as jsonb in `dashboards.layout` and validated on every read and save.

export type WidgetInstance = {
  /** Stable per board, used as the React key and the drag-and-drop id. */
  id: string;
  /** Widget registry type, e.g. "kpi.roas". Unknown types render a "Widget unavailable" card. */
  type: string;
  size: WidgetSize;
  settings?: WidgetSettings;
};

export type Section = { id: string; title: string; collapsed: boolean; items: WidgetInstance[] };

export type Layout = {
  v: 1;
  /** KPI tiles in the strip at the top. KPI widgets only, at most 6. */
  pinned: WidgetInstance[];
  sections: Section[];
};

export const MAX_PINNED = 6;
export const MAX_SECTIONS = 12;
export const MAX_SECTION_ITEMS = 24;
export const MAX_TITLE = 60;

export const PRESET_KEYS = ["minimal", "ecommerce", "leadgen", "agency"] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

/** Which saved layout a viewer is looking at. */
export type DashboardScope = "personal" | "workspace";
