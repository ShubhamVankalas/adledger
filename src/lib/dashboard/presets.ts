import type { WidgetSettings, WidgetSize } from "@/lib/widgets/catalog";
import type { Layout, PresetKey, Section, WidgetInstance } from "./types";

// Starting layouts, picked by business type (BRIEF §4.1). Nobody starts from a blank canvas and
// "Reset" is always one click. Widgets from later phases (NC-ROAS, AOV, funnel, goals...) join
// these presets when they ship; until then the closest phase 1 widget stands in.

const w = (type: string, size: WidgetSize = "s", settings?: WidgetSettings): WidgetInstance => ({
  id: type.replace(/^[a-z]+\./, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
  type,
  size,
  ...(settings ? { settings } : {}),
});
// Section ids carry an "s-" prefix so they can never collide with a widget id ("channels").
const section = (id: string, title: string, items: WidgetInstance[]): Section => ({ id: `s-${id}`, title, collapsed: false, items });

export const PRESETS: Record<PresetKey, { label: string; description: string; layout: Layout }> = {
  minimal: {
    label: "Minimal",
    description: "Four headline numbers, the trend and your best campaigns.",
    layout: {
      v: 1,
      pinned: [w("kpi.revenue"), w("kpi.spend"), w("kpi.roas"), w("kpi.customers")],
      sections: [
        section("performance", "Performance", [w("chart.spendRevenue", "xl")]),
        section("campaigns", "Campaigns", [w("list.topCampaigns", "m"), w("utility.insight", "m")]),
      ],
    },
  },
  ecommerce: {
    label: "E-commerce",
    description: "Revenue efficiency first: MER, ROAS and where money is wasted.",
    layout: {
      v: 1,
      pinned: [w("kpi.revenue"), w("kpi.spend"), w("kpi.roas"), w("kpi.mer"), w("kpi.customers"), w("kpi.unattributed")],
      sections: [
        section("performance", "Performance", [w("chart.explorer", "xl", { metric: "revenue" })]),
        section("campaigns", "Campaigns", [w("list.topCampaigns", "m"), w("list.wastedSpend", "m")]),
        section("channels", "Channels and customers", [w("list.platforms", "m"), w("chart.channels", "m"), w("crm.recent", "m"), w("utility.insight", "m")]),
      ],
    },
  },
  leadgen: {
    label: "Lead gen",
    description: "Leads, cost per lead and the people behind them.",
    layout: {
      v: 1,
      pinned: [w("kpi.spend"), w("kpi.leads"), w("kpi.customers"), w("kpi.revenue")],
      sections: [
        section("pipeline", "Leads", [w("crm.recent", "m"), w("list.topCampaigns", "m", { sort: "roas" })]),
        section("trend", "Trend", [w("chart.explorer", "xl", { metric: "leads" })]),
        section("channels", "Channels", [w("chart.channels", "m"), w("list.wastedSpend", "m")]),
      ],
    },
  },
  agency: {
    label: "Agency",
    description: "Platform by platform, with the campaigns to scale or cut.",
    layout: {
      v: 1,
      pinned: [w("kpi.spend"), w("kpi.revenue"), w("kpi.roas"), w("kpi.leads")],
      sections: [
        section("platforms", "Platforms", [w("list.platforms", "m"), w("list.topCampaigns", "m")]),
        section("health", "Spend health", [w("list.wastedSpend", "m"), w("chart.spendRevenue", "m")]),
      ],
    },
  },
};

export const presetLayout = (key: PresetKey): Layout => structuredClone(PRESETS[key].layout);

/** Fresh workspaces start minimal (no wall of zeros); the demo shows the fuller e-commerce board. */
export const defaultPresetFor = (ws: { isDemo: boolean }): PresetKey => (ws.isDemo ? "ecommerce" : "minimal");
