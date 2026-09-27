import { Suspense } from "react";
import { Onboarding, Welcome, getSetupStatus, isFreshWorkspace } from "@/components/onboarding";
import { Board } from "@/components/overview/board";
import { Briefing, BriefingSkeleton, CurrencyWarnings } from "@/components/overview/briefing";
import { DashboardProvider } from "@/components/overview/dashboard-context";
import { EditToolbar } from "@/components/overview/edit-toolbar";
import { DashboardHeaderActions, MobileCustomize } from "@/components/overview/header-actions";
import type { WidgetNode } from "@/components/overview/widget-frame";
import { PageBody, PageHeader } from "@/components/page-header";
import { ReportControls } from "@/components/report-controls";
import { getViewer, preloadKpis } from "@/lib/dashboard/data";
import { widgetSig } from "@/lib/dashboard/ops";
import { canEditScope, resolveDashboard } from "@/lib/dashboard/store";
import { getDb } from "@/lib/db";
import { isMetricKey } from "@/lib/metrics";
import { resolvePeriodParams } from "@/lib/period";
import { renderWidget } from "@/lib/widgets/registry";

export const metadata = { title: "Overview" };

// The Overview is a widget board (BRIEF §4.1): a briefing sentence, a pinned KPI strip and named
// sections. Every widget streams in its own <Suspense>; the KPI queries start first.

export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const user = await getViewer();
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const p = await resolvePeriodParams(db, ws, sp);
  preloadKpis(p);
  const [setup, dash] = await Promise.all([getSetupStatus(db, ws), resolveDashboard(db, ws, user.id)]);

  // Brand-new workspace with nothing connected: a welcome beats a board full of zeros.
  if (!ws.isDemo && isFreshWorkspace(setup)) {
    return (
      <>
        <PageHeader title="Overview" description="Which ads actually made you money" />
        <PageBody>
          <Welcome status={setup} name={ws.name} canSetup={user.can("workspace.settings")} />
        </PageBody>
      </>
    );
  }

  const ctx = { p, currency: ws.reportingCurrency };
  const nodes: WidgetNode[] = [...dash.layout.pinned, ...dash.layout.sections.flatMap((s) => s.items)].flatMap((item) => {
    const node = renderWidget(item, ctx);
    return node === undefined ? [] : [{ id: item.id, type: item.type, sig: widgetSig(item), node }];
  });
  const metric = typeof sp.metric === "string" && isMetricKey(sp.metric) ? sp.metric : null;
  const canEdit = user.can("dashboard.edit");

  return (
    <DashboardProvider
      initial={{
        layout: dash.layout,
        preset: dash.preset,
        source: dash.source,
        versions: dash.versions,
        workspaceLayout: dash.workspaceLayout,
        workspacePreset: dash.workspacePreset,
        canEditWorkspace: canEditScope(user.can, "workspace"),
        initialEditing: canEdit && sp.edit === "1",
        initialMetric: metric,
      }}
    >
      <PageHeader title="Overview" description="Which ads actually made you money">
        {canEdit ? <DashboardHeaderActions /> : null}
        <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} />
      </PageHeader>
      <PageBody>
        <EditToolbar />
        {!ws.isDemo && !setup.complete ? <Onboarding status={setup} canSetup={user.can("workspace.settings")} /> : null}
        <Suspense fallback={null}>
          <CurrencyWarnings p={p} />
        </Suspense>
        <Suspense fallback={<BriefingSkeleton />}>
          <Briefing p={p} currency={ws.reportingCurrency} />
        </Suspense>
        <Board nodes={nodes} />
        {canEdit ? <MobileCustomize /> : null}
      </PageBody>
    </DashboardProvider>
  );
}
