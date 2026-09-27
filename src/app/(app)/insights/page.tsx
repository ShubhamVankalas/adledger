import { and, desc, eq } from "drizzle-orm";
import { SettingsIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { generateReportAction } from "@/app/actions/settings";
import { ActionButton } from "@/components/action-button";
import { ActionCards } from "@/components/insights/action-cards";
import { AlertHistory } from "@/components/insights/alerts/alert-history";
import { AskPanel, type AskMessageView } from "@/components/insights/ask/ask-panel";
import { InsightsTabs, type InsightsTab } from "@/components/insights/insights-tabs";
import { providerLabel, WeeklyReport } from "@/components/insights/weekly-report";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { alertsView } from "@/lib/alerts";
import { askHistory } from "@/lib/ai/ask";
import { getLlmConfig } from "@/lib/ai/report";
import { requireUser, type SessionUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { dateRange, MODEL_LABELS } from "@/lib/format";
import { actionCards } from "@/lib/reports-insights";

export const metadata = { title: "Insights" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function InsightsPage({ searchParams }: PageProps<"/insights">) {
  const user = await requireUser();
  const sp = await searchParams;
  const canAsk = user.can("insights.ask");
  const requested = one(sp.tab);
  const tab: InsightsTab = requested === "ask" && canAsk ? "ask" : requested === "alerts" ? "alerts" : "reports";
  const db = await getDb();
  // Threshold rules currently in breach (the anomaly rule's state only means "fired today").
  const triggered = await db.$count(
    schema.alertRules,
    and(eq(schema.alertRules.workspaceId, user.workspace.id), eq(schema.alertRules.kind, "threshold"), eq(schema.alertRules.enabled, true), eq(schema.alertRules.state, "breached")),
  );

  return (
    <>
      <PageHeader title="Insights" description="What changed, what to do about it, and answers to your questions">
        {tab === "reports" && user.can("insights.generate") ? (
          <ActionButton action={generateReportAction} size="sm" variant="outline" className="max-sm:h-9">
            <SparklesIcon aria-hidden /> Generate report
          </ActionButton>
        ) : null}
      </PageHeader>
      <PageBody>
        <InsightsTabs active={tab} alertCount={triggered} showAsk={canAsk} />
        {tab === "reports" ? (
          <ReportsTab user={user} selectedId={one(sp.report)} />
        ) : tab === "ask" ? (
          <AskTab user={user} />
        ) : (
          <AlertsTab user={user} />
        )}
      </PageBody>
    </>
  );
}

async function ReportsTab({ user, selectedId }: { user: SessionUser; selectedId?: string }) {
  const ws = user.workspace;
  const db = await getDb();
  const [reports, llm] = await Promise.all([
    db.select().from(schema.aiReports).where(eq(schema.aiReports.workspaceId, ws.id)).orderBy(desc(schema.aiReports.createdAt)).limit(20),
    getLlmConfig(ws, db),
  ]);
  return (
    <div className="space-y-8">
      <Suspense fallback={<CardsSkeleton />}>
        <Cards user={user} />
      </Suspense>
      <WeeklyReport
        reports={reports}
        selectedId={selectedId}
        llm={llm}
        timezone={ws.timezone}
        canGenerate={user.can("insights.generate")}
        canConfigure={user.can("workspace.settings")}
      />
    </div>
  );
}

async function Cards({ user }: { user: SessionUser }) {
  const db = await getDb();
  const { period, cards } = await actionCards(db, user.workspace);
  return <ActionCards cards={cards} caption={`${dateRange(period.start, period.end, { year: true })}, ${MODEL_LABELS[period.model] ?? period.model} attribution. Every figure links to its source.`} />;
}

function CardsSkeleton() {
  return (
    <div className="reveal-delayed space-y-3" aria-busy="true" aria-label="Loading recommendations…">
      <Skeleton className="h-6 w-40" />
      <div className="grid gap-3 md:grid-cols-2">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
    </div>
  );
}

async function AskTab({ user }: { user: SessionUser }) {
  const db = await getDb();
  const [history, llm] = await Promise.all([askHistory(db, user.workspace.id, user.id), getLlmConfig(user.workspace, db)]);
  const initial: AskMessageView[] = history.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    tables: m.tables,
    unverifiedNumbers: m.unverifiedNumbers,
    modelName: m.modelName,
    createdAt: m.createdAt.toISOString(),
  }));
  return (
    <AskPanel
      initial={initial}
      modelLabel={llm ? `${providerLabel(llm.provider)}, ${llm.model}` : null}
      canConfigure={user.can("workspace.settings")}
    />
  );
}

async function AlertsTab({ user }: { user: SessionUser }) {
  const db = await getDb();
  const view = await alertsView(db, user.workspace, { historyLimit: 50 });
  const canManage = user.can("alerts.manage");
  const active = view.rules.filter((r) => r.enabled);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="feed-title" className="min-w-0 space-y-3">
        <h2 id="feed-title" className="text-title-sm">
          Alert history
        </h2>
        <AlertHistory
          items={view.history}
          channelNames={view.channelNames}
          emptyHint={active.length || view.anomaly.enabled ? "Your alerts are watching. Anything that fires will show up here." : "Set up an alert and anything that fires will show up here."}
        />
      </section>
      <aside aria-label="What is being watched" className="space-y-3 lg:sticky lg:top-24 lg:mt-9">
        <div className="rounded-xl bg-card p-4 shadow-(--elev-card)">
          <p className="text-ui font-medium">Watching</p>
          {active.length || view.anomaly.enabled ? (
            <ul className="mt-2 space-y-2.5">
              {view.anomaly.enabled ? (
                <li className="text-caption text-muted-foreground">
                  <span className="block text-ui text-foreground">Unusual days</span>
                  Revenue, spend and leads against the last 4 weeks
                </li>
              ) : null}
              {active.map((r) => (
                <li key={r.id} className="text-caption text-muted-foreground">
                  <span className="flex items-center gap-2 text-ui text-foreground">
                    <span className="min-w-0 truncate">{r.name}</span>
                    {r.state === "breached" ? <Badge variant="warning">Triggered</Badge> : null}
                  </span>
                  {r.summary}, {r.scopeLabel === "Whole workspace" ? "whole workspace" : r.scopeLabel}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-caption text-pretty text-muted-foreground">No alerts are on. Get told when CAC climbs, ROAS drops below break-even or a day looks unusual.</p>
          )}
          {canManage ? (
            <Button variant="outline" className="mt-4 w-full max-sm:h-10" render={<Link href="/settings/workspace/alerts" />}>
              <SettingsIcon aria-hidden /> Manage alerts
            </Button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
