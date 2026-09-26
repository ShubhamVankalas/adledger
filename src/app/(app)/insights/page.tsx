import { desc, eq } from "drizzle-orm";
import { AlertTriangleIcon, ChevronDownIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { generateReportAction } from "@/app/actions/settings";
import { ActionButton } from "@/components/action-button";
import { Markdown } from "@/components/markdown";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getLlmConfig } from "@/lib/ai/report";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { DeleteReportButton } from "./delete-report-button";

export const metadata = { title: "AI insights" };

// Report prose: a comfortable measure and line height, with a divider between sections.
const PROSE =
  "max-w-[72ch] text-[15px] leading-7 sm:text-sm sm:leading-relaxed [&_h3:not(:first-child)]:mt-6 [&_h3:not(:first-child)]:border-t [&_h3:not(:first-child)]:pt-5 [&_li]:pl-0.5 [&_ol]:space-y-2 [&_ul]:space-y-2";

type Report = typeof schema.aiReports.$inferSelect;

export default async function InsightsPage() {
  const user = await requireUser();
  const ws = user.workspace;
  const canGenerate = user.can("insights.generate");
  const db = await getDb();
  const [reports, llm] = await Promise.all([
    db.select().from(schema.aiReports).where(eq(schema.aiReports.workspaceId, ws.id)).orderBy(desc(schema.aiReports.createdAt)).limit(20),
    getLlmConfig(ws, db),
  ]);
  const fmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ws.timezone,
  });
  const periodFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const period = (r: Report) => {
    const a = new Date(`${r.periodStart}T00:00:00Z`);
    const b = new Date(`${r.periodEnd}T00:00:00Z`);
    return Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) ? `${r.periodStart} – ${r.periodEnd}` : periodFmt.formatRange(a, b);
  };
  const meta = (r: Report) => (
    <>
      Generated <span className="whitespace-nowrap">{fmt.format(r.createdAt)}</span> ·{" "}
      <span className="break-all">{r.modelName === "template" ? "rule-based" : r.modelName}</span>
    </>
  );
  const [latest, ...older] = reports;

  const generate = canGenerate ? (
    <ActionButton action={generateReportAction} size="sm" className="h-10 sm:h-7">
      <SparklesIcon /> Generate now
    </ActionButton>
  ) : null;

  return (
    <>
      <PageHeader title="AI insights" description="A weekly note on what changed, what's wasting money and where to move budget">
        {generate}
      </PageHeader>
      <PageBody>
        <div className="mx-auto grid max-w-3xl items-start gap-4 md:gap-6 xl:max-w-none xl:grid-cols-[minmax(0,48rem)_18rem] xl:justify-center">
          {/* Model status: a banner on phones/tablets, a side rail on wide screens. */}
          <aside className="xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1">
            <Card size="sm" className="bg-gradient-to-br from-primary/[0.07] to-card">
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center xl:flex-col xl:items-stretch">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <SparklesIcon className="size-4" />
                  </span>
                  <div className="min-w-0 space-y-0.5">
                    <div className="font-medium break-words">{llm ? `Using ${llm.provider} · ${llm.model}` : "No AI model connected"}</div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {llm ? "" : "Reports are rule-based until you connect one. "}
                      Numbers are always computed by AdLedger in SQL — the model only writes the narrative, and any number it invents is flagged.
                    </p>
                  </div>
                </div>
                {user.can("workspace.settings") ? (
                  <Button variant="outline" size="sm" className="h-10 shrink-0 sm:h-8" render={<Link href="/settings/workspace/ai" />}>
                    {llm ? "Change model" : "Connect a model"}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </aside>

          <div className="min-w-0 space-y-4 xl:col-start-1 xl:row-start-1">
            {!latest ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SparklesIcon />
                  </EmptyMedia>
                  <EmptyTitle>No reports yet</EmptyTitle>
                  <EmptyDescription>
                    A report is generated automatically every week.
                    {canGenerate ? " Generate one now to see the last 7 days." : " Ask an admin or analyst to generate one."}
                  </EmptyDescription>
                </EmptyHeader>
                {canGenerate ? (
                  <EmptyContent>
                    <ActionButton action={generateReportAction} className="h-10 sm:h-8">
                      <SparklesIcon /> Generate a report
                    </ActionButton>
                  </EmptyContent>
                ) : null}
              </Empty>
            ) : (
              <Card id={`report-${latest.id}`} className="scroll-mt-20 ring-primary/30">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    {period(latest)}
                    <Badge>Latest</Badge>
                  </CardTitle>
                  <CardDescription>{meta(latest)}</CardDescription>
                  {canGenerate ? (
                    <CardAction>
                      <DeleteReportButton id={latest.id} period={period(latest)} />
                    </CardAction>
                  ) : null}
                </CardHeader>
                <CardContent className="space-y-4">
                  <Unverified numbers={latest.unverifiedNumbers} />
                  <Markdown source={latest.contentMd} className={PROSE} />
                </CardContent>
              </Card>
            )}

            {older.length ? (
              <section className="space-y-3 pt-2" aria-labelledby="earlier-reports">
                <h2 id="earlier-reports" className="text-sm font-medium text-muted-foreground">
                  Earlier reports
                </h2>
                {older.map((r) => (
                  <details key={r.id} id={`report-${r.id}`} className="group scroll-mt-20 overflow-hidden rounded-xl bg-card text-sm ring-1 ring-foreground/10">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors select-none hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{period(r)}</div>
                        <div className="text-xs text-muted-foreground">{meta(r)}</div>
                      </div>
                      {r.unverifiedNumbers.length ? <AlertTriangleIcon className="size-4 shrink-0 text-warning" aria-label="Has unverified numbers" /> : null}
                      <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="space-y-4 border-t px-4 pt-4 pb-3">
                      <Unverified numbers={r.unverifiedNumbers} />
                      <Markdown source={r.contentMd} className={PROSE} />
                      {canGenerate ? (
                        <div className="flex justify-end border-t pt-3">
                          <DeleteReportButton id={r.id} period={period(r)} withLabel />
                        </div>
                      ) : null}
                    </div>
                  </details>
                ))}
              </section>
            ) : null}
          </div>
        </div>
      </PageBody>
    </>
  );
}

function Unverified({ numbers }: { numbers: string[] }) {
  if (!numbers.length) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs leading-relaxed">
      <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span>
        The model used numbers that aren&apos;t in AdLedger&apos;s data: <strong className="break-words">{numbers.join(", ")}</strong>. Treat those figures with caution.
      </span>
    </div>
  );
}
