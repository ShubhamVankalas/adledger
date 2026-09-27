import { CalendarClockIcon, FilterIcon } from "lucide-react";
import { cache } from "react";
import { CardLink, WidgetCard, WidgetEmpty } from "@/components/overview/widget-card";
import { getViewer, type DashParams } from "@/lib/dashboard/data";
import { getDb } from "@/lib/db";
import type { AttributionModel, Platform } from "@/lib/db/schema";
import { comparisonRange, parseCompare } from "@/lib/period-presets";
import { conversionsHeatmap, funnel } from "@/lib/reports-analysis";
import { FunnelChart } from "./funnel";
import { HeatmapGrid } from "./heatmap";

// Overview widgets (catalog #23 Funnel and #24 Conversions heatmap). Same contract as the
// widgets in src/components/overview/widgets: an async server component that receives the
// board's period and renders a fixed-height WidgetCard, streamed inside its own Suspense.

const loadFunnel = cache(async (start: string, end: string, model: AttributionModel, platform: Platform | undefined, compare: string) => {
  const [db, { workspace }] = await Promise.all([getDb(), getViewer()]);
  const cmp = comparisonRange(start, end, parseCompare(compare));
  return funnel(db, workspace, { start, end, model, platform }, { previous: cmp });
});

const loadHeatmap = cache(async (start: string, end: string) => {
  const [db, { workspace }] = await Promise.all([getDb(), getViewer()]);
  return conversionsHeatmap(db, workspace, { start, end });
});

const periodQuery = (p: DashParams) => new URLSearchParams({ range: p.range, ...(p.range === "custom" ? { from: p.start, to: p.end } : {}) }).toString();

/** Visitors → leads → customers → revenue with step rates and the comparison period. */
export async function FunnelWidget({ p, currency, compare = "prev" }: { p: DashParams; currency: string; compare?: string }) {
  const r = await loadFunnel(p.start, p.end, p.model, p.platform, compare);
  return (
    <WidgetCard
      title="Funnel"
      description="From visit to revenue in this period"
      action={
        <CardLink href={`/attribution/paths?${periodQuery(p)}`} label="Open journey paths">
          Paths
        </CardLink>
      }
    >
      {r.visitors === 0 && r.leads === 0 && r.customers === 0 ? (
        <WidgetEmpty icon={FilterIcon} title="No visits or conversions yet">
          Install the pixel and send leads or payments to see where people drop off.
        </WidgetEmpty>
      ) : (
        <FunnelChart report={r} currency={currency} dense />
      )}
    </WidgetCard>
  );
}

/** Leads and payments by weekday × hour in the workspace timezone. */
export async function HeatmapWidget({ p }: { p: DashParams; currency?: string }) {
  const r = await loadHeatmap(p.start, p.end);
  return (
    <WidgetCard
      title="Conversions heatmap"
      description={`When leads and payments happen (${r.timezone})`}
      action={
        <CardLink href={`/attribution/time-to-convert?${periodQuery(p)}#heatmap`} label="Open time to convert">
          Details
        </CardLink>
      }
    >
      {r.totals.leads + r.totals.payments === 0 ? (
        <WidgetEmpty icon={CalendarClockIcon} title="No conversions in this period">
          Leads and payments appear here by the hour they happened.
        </WidgetEmpty>
      ) : (
        <HeatmapGrid data={r} compact />
      )}
    </WidgetCard>
  );
}
