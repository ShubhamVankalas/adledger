import type { WidgetSettings, WidgetSize } from "@/lib/widgets/catalog";
import type { Layout, PresetKey, Section, WidgetInstance } from "./types";

// Starting layouts, picked by business type (BRIEF §4.1). Nobody starts from a blank canvas and
// "Reset" is always one click. KPI tiles that don't exist yet (NC-ROAS, AOV, Profit) are stood in
// for by the closest shipped tile; the money-truth widgets (profit, truth gap) fill that role below.

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
    description: "Revenue efficiency first: MER, ROAS, profit after ads and where money is wasted.",
    layout: {
      v: 1,
      pinned: [w("kpi.revenue"), w("kpi.spend"), w("kpi.roas"), w("kpi.mer"), w("kpi.customers"), w("kpi.unattributed")],
      sections: [
        section("performance", "Performance", [w("chart.explorer", "xl", { metric: "revenue" })]),
        section("campaigns", "Campaigns", [w("list.topCampaigns", "m"), w("list.wastedSpend", "m")]),
        section("money", "Money truth", [w("list.profit", "m"), w("list.truthGap", "m")]),
        section("channels", "Channels", [w("list.platforms", "m"), w("chart.channels", "m")]),
        section("today", "Today", [w("live.now", "m"), w("utility.insight", "m")]),
      ],
    },
  },
  leadgen: {
    label: "Lead gen",
    description: "Leads, cost per lead, where people drop off and whether the month is on pace.",
    layout: {
      v: 1,
      pinned: [w("kpi.spend"), w("kpi.leads"), w("kpi.customers"), w("kpi.revenue")],
      sections: [
        section("funnel", "Funnel", [w("chart.funnel", "xl")]),
        section("pipeline", "Leads", [w("crm.recent", "m"), w("utility.goals", "m")]),
        section("campaigns", "Campaigns", [w("list.topCampaigns", "m", { sort: "roas" }), w("chart.heatmap", "m")]),
        section("trend", "Trend", [w("chart.explorer", "xl", { metric: "leads" })]),
      ],
    },
  },
  saas: {
    label: "SaaS",
    description: "Sign-ups to paying customers, with the trend and the channels behind them.",
    layout: {
      v: 1,
      pinned: [w("kpi.spend"), w("kpi.leads"), w("kpi.customers"), w("kpi.revenue"), w("kpi.roas")],
      sections: [
        section("funnel", "Funnel", [w("chart.funnel", "xl")]),
        section("trend", "Trend", [w("chart.explorer", "xl", { metric: "customers" })]),
        section("channels", "Channels", [w("chart.channels", "m"), w("utility.insight", "m")]),
      ],
    },
  },
  agency: {
    label: "Agency",
    description: "Platform by platform, what each one claims, and the campaigns to scale or cut.",
    layout: {
      v: 1,
      pinned: [w("kpi.spend"), w("kpi.revenue"), w("kpi.roas"), w("kpi.leads")],
      sections: [
        section("platforms", "Platforms", [w("list.platforms", "m"), w("list.truthGap", "m")]),
        section("campaigns", "Campaigns", [w("list.topCampaigns", "m"), w("list.wastedSpend", "m")]),
        section("health", "Pacing and spend", [w("utility.goals", "m"), w("chart.spendRevenue", "m")]),
      ],
    },
  },
};

export const presetLayout = (key: PresetKey): Layout => structuredClone(PRESETS[key].layout);

/** Fresh workspaces start minimal (no wall of zeros); the demo shows the fuller e-commerce board. */
export const defaultPresetFor = (ws: { isDemo: boolean }): PresetKey => (ws.isDemo ? "ecommerce" : "minimal");
