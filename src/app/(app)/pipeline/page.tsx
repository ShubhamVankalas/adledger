import { KanbanIcon, Settings2Icon, UploadIcon } from "lucide-react";
import Link from "next/link";
import { PageBody, PageHeader } from "@/components/page-header";
import { PipelineBoard } from "@/components/pipeline/board";
import { CostPerStageCard, StageFunnelCard } from "@/components/pipeline/funnel";
import { PipelineSummaryRow } from "@/components/pipeline/summary";
import { ReportControls } from "@/components/report-controls";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { dateRange } from "@/lib/format";
import { resolvePeriodParams } from "@/lib/period";
import { costPerStage, pipelineBoard, pipelineSummary, stageFunnel, type CostPerStageLevel } from "@/lib/reports-pipeline";
import { cn } from "@/lib/utils";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Pipeline" };

const LEVELS = ["campaign", "ad_group", "ad"] as const;

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const denied = await gatePage("page.pipeline");
  if (denied) return denied;
  const user = await requireUser();
  const ws = user.workspace;
  const sp = await searchParams;
  const view = sp.view === "funnel" ? "funnel" : "board";
  const canConfigure = user.can("workspace.settings");
  const db = await getDb();

  const tabs = (
    <nav aria-label="Pipeline views" className="flex h-8 items-center gap-1">
      {(
        [
          ["board", "Board", "/pipeline"],
          ["funnel", "Funnel & cost", "/pipeline?view=funnel"],
        ] as const
      ).map(([id, label, href]) => (
        <Link
          key={id}
          href={href}
          aria-current={view === id ? "page" : undefined}
          className={cn(
            "flex h-7 items-center rounded-md px-2.5 text-ui font-medium text-muted-foreground transition-colors duration-100 hover:bg-fill-hover hover:text-foreground",
            view === id && "bg-fill-active text-foreground hover:bg-fill-active",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
  const stagesLink = canConfigure ? (
    <Button variant="outline" size="sm" render={<Link href="/settings/workspace/pipeline" />}>
      <Settings2Icon /> <span className="max-sm:sr-only">Edit stages</span>
    </Button>
  ) : null;

  if (view === "funnel") {
    // Stage progress needs time: default to the last 90 days.
    const p = await resolvePeriodParams(db, ws, sp.range || sp.from ? sp : { ...sp, range: "90d" });
    const rawLevel = typeof sp.level === "string" ? sp.level : "";
    const level: CostPerStageLevel = (LEVELS as readonly string[]).includes(rawLevel) ? (rawLevel as CostPerStageLevel) : "campaign";
    const [funnel, cost] = await Promise.all([
      stageFunnel(db, ws, { start: p.start, end: p.end }),
      costPerStage(db, ws, { start: p.start, end: p.end, level, platform: p.platform }),
    ]);
    const levelHref = (l: CostPerStageLevel) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && k !== "level") q.set(k, v);
      if (l !== "campaign") q.set("level", l);
      return `/pipeline?${q}`;
    };
    return (
      <>
        <PageHeader title="Pipeline" description="How far leads get, and what each stage costs per ad">
          <ReportControls start={p.start} end={p.end} range={p.range} model={p.model} platform={p.platform} showModel={false} showCompare={false} />
        </PageHeader>
        <PageBody>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {tabs}
            <p className="text-caption text-muted-foreground">Contacts first seen {dateRange(p.start, p.end, { year: true })}</p>
          </div>
          <StageFunnelCard funnel={funnel} />
          <CostPerStageCard rows={cost.rows} stages={cost.stages} currency={cost.currency} level={level} levelHref={levelHref} />
        </PageBody>
      </>
    );
  }

  const board = await pipelineBoard(db, ws);
  const summary = pipelineSummary(board);
  const total = board.columns.reduce((s, c) => s + c.count, 0);

  return (
    <>
      <PageHeader title="Pipeline" description="Every lead from first click to paid">
        {stagesLink}
      </PageHeader>
      <PageBody>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <PipelineSummaryRow summary={summary} currency={board.currency} />
          {tabs}
        </div>
        {total === 0 ? (
          <Empty className="border bg-card py-12 sm:py-16">
            <EmptyHeader className="max-w-md">
              <EmptyMedia variant="icon">
                <KanbanIcon />
              </EmptyMedia>
              <EmptyTitle>No leads in the pipeline yet</EmptyTitle>
              <EmptyDescription>
                New contacts from your pixel, forms and imports start in the first stage. A payment moves them to Won on its own.
              </EmptyDescription>
            </EmptyHeader>
            {canConfigure ? (
              <EmptyContent className="flex-row flex-wrap justify-center gap-2">
                <Button size="sm" render={<Link href="/settings/workspace/tracking" />}>
                  Set up tracking
                </Button>
                <Button size="sm" variant="outline" render={<Link href="/settings/workspace/import" />}>
                  <UploadIcon /> Import contacts
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        ) : (
          <PipelineBoard board={board} canMove={user.can("pipeline.move")} />
        )}
      </PageBody>
    </>
  );
}
