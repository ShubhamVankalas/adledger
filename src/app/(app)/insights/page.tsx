import { desc, eq } from "drizzle-orm";
import { AlertTriangleIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { deleteReportAction, generateReportAction } from "@/app/actions/settings";
import { ActionButton } from "@/components/action-button";
import { Markdown } from "@/components/markdown";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getLlmConfig } from "@/lib/ai/report";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";

export const metadata = { title: "AI insights" };

export default async function InsightsPage() {
  const { workspace: ws } = await requireUser();
  const db = await getDb();
  const [reports, llm] = await Promise.all([
    db.select().from(schema.aiReports).where(eq(schema.aiReports.workspaceId, ws.id)).orderBy(desc(schema.aiReports.createdAt)).limit(20),
    getLlmConfig(ws, db),
  ]);
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: ws.timezone });

  return (
    <>
      <PageHeader title="AI insights" description="A weekly note on what changed, what's wasting money and where to move budget">
        <ActionButton action={generateReportAction} size="sm">
          <SparklesIcon /> Generate now
        </ActionButton>
      </PageHeader>
      <PageBody>
        <Card className="bg-gradient-to-br from-primary/[0.06] to-card">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <SparklesIcon className="size-4" />
              </span>
              <div>
                <div className="font-medium">{llm ? `Using ${llm.provider} · ${llm.model}` : "No AI model connected — using rule-based reports"}</div>
                <div className="text-muted-foreground">
                  Numbers are always computed by AdLedger in SQL. The model only writes the narrative, and any number it invents is flagged.
                </div>
              </div>
            </div>
            <Link href="/settings/workspace/ai" className="text-sm font-medium text-primary hover:underline">
              {llm ? "Change model" : "Connect a model"} →
            </Link>
          </CardContent>
        </Card>

        {reports.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SparklesIcon />
              </EmptyMedia>
              <EmptyTitle>No reports yet</EmptyTitle>
              <EmptyDescription>A report is generated automatically every week. Click “Generate now” to create one for the last 7 days.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}

        {reports.map((r, i) => (
          <Card key={r.id} className={i === 0 ? "border-primary/30" : undefined}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {r.periodStart} → {r.periodEnd}
                {i === 0 ? <Badge>Latest</Badge> : null}
              </CardTitle>
              <CardDescription>
                Generated {fmt.format(r.createdAt)} · {r.modelName === "template" ? "rule-based" : r.modelName}
              </CardDescription>
              <CardAction>
                <ActionButton action={deleteReportAction.bind(null, r.id)} variant="ghost" size="sm" confirm="Delete this report?">
                  Delete
                </ActionButton>
              </CardAction>
            </CardHeader>
            <CardContent className="space-y-4">
              {r.unverifiedNumbers.length ? (
                <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
                  <span>
                    The model used numbers that aren&apos;t in AdLedger&apos;s data: <strong>{r.unverifiedNumbers.join(", ")}</strong>. Treat those figures with caution.
                  </span>
                </div>
              ) : null}
              <Markdown source={r.contentMd} />
            </CardContent>
          </Card>
        ))}
      </PageBody>
    </>
  );
}
