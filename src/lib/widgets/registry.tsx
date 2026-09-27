import { Suspense, type ReactNode } from "react";
import { FunnelWidget, HeatmapWidget } from "@/components/analysis/widgets";
import { GoalsWidget } from "@/components/goals/goals-widget";
import { LiveNowWidget } from "@/components/live/live-now-widget";
import { CardSkeleton, KpiSkeleton } from "@/components/overview/skeletons";
import { WidgetErrorBoundary } from "@/components/overview/widget-error-boundary";
import { ChannelsWidget, ExplorerWidget, SpendRevenueWidget } from "@/components/overview/widgets/charts";
import { KpiWidget } from "@/components/overview/widgets/kpi";
import { InsightWidget, PlatformsWidget, RecentWidget, TopCampaignsWidget, WastedSpendWidget } from "@/components/overview/widgets/lists";
import { ProfitWidget, TruthGapWidget } from "@/components/profit/widgets";
import type { DashParams } from "@/lib/dashboard/data";
import type { WidgetInstance } from "@/lib/dashboard/types";
import { METRICS } from "@/lib/metrics";
import { WIDGETS, widgetMeta, type WidgetMeta, type WidgetSettings, type WidgetType } from "./catalog";

// Widget registry (server): catalog metadata + the async server component that renders each type.
// Every widget renders inside its own error boundary and <Suspense> with a same-size skeleton, so
// a slow or failing query never blocks or breaks the rest of the board.

export type WidgetContext = { p: DashParams; currency: string; settings?: WidgetSettings };
export type WidgetEntry = WidgetMeta & { component: (ctx: WidgetContext) => ReactNode; skeleton: () => ReactNode };

const kpi = (meta: WidgetMeta): Pick<WidgetEntry, "component" | "skeleton"> => ({
  component: (ctx) => <KpiWidget metric={meta.metric!} {...ctx} />,
  skeleton: () => <KpiSkeleton label={METRICS[meta.metric!].label} />,
});

const RENDER: Record<WidgetType, (meta: WidgetMeta) => Pick<WidgetEntry, "component" | "skeleton">> = {
  "kpi.revenue": kpi,
  "kpi.spend": kpi,
  "kpi.roas": kpi,
  "kpi.mer": kpi,
  "kpi.leads": kpi,
  "kpi.customers": kpi,
  "kpi.unattributed": kpi,
  "chart.explorer": () => ({ component: (ctx) => <ExplorerWidget {...ctx} />, skeleton: () => <CardSkeleton title="Metric explorer" variant="chart" /> }),
  "chart.spendRevenue": () => ({ component: (ctx) => <SpendRevenueWidget {...ctx} />, skeleton: () => <CardSkeleton title="Spend vs revenue" variant="chart" /> }),
  "chart.channels": () => ({ component: (ctx) => <ChannelsWidget {...ctx} />, skeleton: () => <CardSkeleton title="Revenue by channel" description="Where credited revenue came from" /> }),
  "list.topCampaigns": () => ({ component: (ctx) => <TopCampaignsWidget {...ctx} />, skeleton: () => <CardSkeleton title="Top campaigns" /> }),
  "list.wastedSpend": () => ({ component: (ctx) => <WastedSpendWidget {...ctx} />, skeleton: () => <CardSkeleton title="Wasted spend" description="Real spend with ROAS under 0.5×" /> }),
  "list.platforms": () => ({ component: (ctx) => <PlatformsWidget {...ctx} />, skeleton: () => <CardSkeleton title="Platform scorecard" /> }),
  "crm.recent": () => ({ component: (ctx) => <RecentWidget {...ctx} />, skeleton: () => <CardSkeleton title="Recent leads & customers" /> }),
  "utility.insight": () => ({ component: () => <InsightWidget />, skeleton: () => <CardSkeleton title="This week in one read" variant="text" /> }),
  // Ignores the board's date range: it is always "right now".
  "live.now": () => ({ component: () => <LiveNowWidget />, skeleton: () => <CardSkeleton title="Live now" description="Visitors on your site in the last 5 minutes" /> }),
  "utility.goals": () => ({ component: (ctx) => <GoalsWidget {...ctx} />, skeleton: () => <CardSkeleton title="Goals & pacing" description="Progress against your targets" /> }),
  "list.truthGap": () => ({ component: (ctx) => <TruthGapWidget {...ctx} />, skeleton: () => <CardSkeleton title="Truth gap" description="What platforms claim vs payments you received" /> }),
  "list.profit": () => ({ component: (ctx) => <ProfitWidget {...ctx} />, skeleton: () => <CardSkeleton title="Profit after ads" /> }),
  "chart.funnel": () => ({ component: (ctx) => <FunnelWidget {...ctx} compare={ctx.p.compare} />, skeleton: () => <CardSkeleton title="Funnel" variant="chart" /> }),
  "chart.heatmap": () => ({ component: (ctx) => <HeatmapWidget {...ctx} />, skeleton: () => <CardSkeleton title="Conversions heatmap" variant="chart" /> }),
};

export const WIDGET_REGISTRY: Record<string, WidgetEntry> = Object.fromEntries(WIDGETS.map((w) => [w.type, { ...w, ...RENDER[w.type](w) }]));

/** The streamed body of one widget instance, or undefined for a type this version doesn't know. */
export function renderWidget(item: WidgetInstance, ctx: Omit<WidgetContext, "settings">): ReactNode | undefined {
  const entry = WIDGET_REGISTRY[item.type];
  if (!entry) return undefined;
  const title = item.settings?.title ?? widgetMeta(item.type)?.title ?? "Widget";
  return (
    <WidgetErrorBoundary title={title} compact={entry.category === "kpi"}>
      <Suspense fallback={entry.skeleton()}>{entry.component({ ...ctx, settings: item.settings })}</Suspense>
    </WidgetErrorBoundary>
  );
}
