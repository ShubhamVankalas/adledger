import { desc, eq } from "drizzle-orm";
import { AlertTriangleIcon, BotIcon, CheckCircle2Icon, FileTextIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { generateReportAction } from "@/app/actions/settings";
import { ActionButton } from "@/components/action-button";
import { Markdown } from "@/components/markdown";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { getLlmConfig } from "@/lib/ai/report";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { cn } from "@/lib/utils";
import { DeleteReportButton } from "./delete-report-button";

export const metadata = { title: "AI insights" };

// Report sections are separated by a hairline so a long note scans like a document.
const PROSE = "[&_h3:not(:first-child)]:mt-8 [&_h3:not(:first-child)]:border-t [&_h3:not(:first-child)]:pt-7";

const PROVIDER_LABELS: Record<string, string> = {
  ollama: "Ollama",
  lmstudio: "LM Studio",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  custom: "Custom model",
};

type Report = typeof schema.aiReports.$inferSelect;

export default async function InsightsPage({ searchParams }: PageProps<"/insights">) {
  const user = await requireUser();
  const ws = user.workspace;
  const canGenerate = user.can("insights.generate");
  const sp = await searchParams;
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
  const shortFmt = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
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
  const author = (r: Report) => (r.modelName === "template" ? "Rule-based" : r.modelName);
  const latest = reports[0];
  const selected = reports.find((r) => r.id === sp.report) ?? latest;

  const generate = canGenerate ? (
    <ActionButton action={generateReportAction} size="sm" className="h-10 sm:h-7">
      <SparklesIcon /> Generate now
    </ActionButton>
  ) : null;

  const modelCard = (
    <Card size="sm">
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <span
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", llm ? "bg-success/15 text-success" : "bg-primary/10 text-primary")}
          >
            {llm ? <CheckCircle2Icon className="size-4" /> : <BotIcon className="size-4" />}
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{llm ? "AI model connected" : "No AI model connected"}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {llm ? (
                <>
                  Written by <span className="font-medium break-words text-foreground">{PROVIDER_LABELS[llm.provider] ?? llm.provider}</span> ·{" "}
                  <span className="break-all">{llm.model}</span>
                </>
              ) : (
                "Reports are rule-based until you connect one. Local models like Ollama are free and private."
              )}
            </p>
          </div>
        </div>
        <p className="rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Every number is computed by AdLedger in SQL. The model only writes the narrative, and any figure it invents is flagged.
        </p>
        {user.can("workspace.settings") ? (
          <Button variant="outline" className="h-10 w-full sm:h-8" render={<Link href="/settings/workspace/ai" />}>
            {llm ? "Change model" : "Connect a model"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );

  return (
    <>
      <PageHeader title="AI insights" description="A weekly note on what changed, what's wasting money and where to move budget">
        {generate}
      </PageHeader>
      <PageBody>
        <div className="mx-auto grid max-w-6xl items-start gap-4 md:gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0">
            {!selected ? (
              <Empty className="border bg-card">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <SparklesIcon />
                  </EmptyMedia>
                  <EmptyTitle>No reports yet</EmptyTitle>
                  <EmptyDescription>
                    A report is written automatically every week from your spend, leads and revenue.
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
              <article id={`report-${selected.id}`} aria-labelledby="report-title" className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <header className="flex items-start gap-3 border-b bg-gradient-to-b from-primary/[0.05] to-transparent px-5 py-5 sm:px-8 sm:py-6">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-xs font-medium text-primary">Weekly insights</p>
                    <h2 id="report-title" className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight">
                      {period(selected)}
                      {selected.id === latest?.id ? <Badge>Latest</Badge> : <Badge variant="secondary">Earlier report</Badge>}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Generated <span className="whitespace-nowrap">{fmt.format(selected.createdAt)}</span> ·{" "}
                      <span className="[overflow-wrap:anywhere]">{author(selected)}</span>
                    </p>
                  </div>
                  {canGenerate ? <DeleteReportButton id={selected.id} period={period(selected)} /> : null}
                </header>
                <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-8">
                  <Unverified numbers={selected.unverifiedNumbers} />
                  <Markdown source={selected.contentMd} className={cn("max-w-[70ch]", PROSE)} />
                </div>
              </article>
            )}
          </div>

          <aside className="space-y-4 md:space-y-6 lg:sticky lg:top-24">
            {modelCard}
            {reports.length ? (
              <Card size="sm">
                <CardHeader>
                  <CardTitle>Report history</CardTitle>
                  <CardDescription>
                    {reports.length} {reports.length === 1 ? "report" : "reports"}, newest first
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ol className="-mx-2 space-y-0.5">
                    {reports.map((r) => {
                      const active = r.id === selected?.id;
                      return (
                        <li key={r.id}>
                          <Link
                            href={r.id === latest?.id ? "/insights" : `/insights?report=${r.id}`}
                            scroll={false}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted/60",
                              active && "bg-muted text-foreground hover:bg-muted",
                            )}
                          >
                            <FileTextIcon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{period(r)}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {shortFmt.format(r.createdAt)} · {author(r)}
                              </span>
                            </span>
                            {r.unverifiedNumbers.length ? (
                              <AlertTriangleIcon className="size-4 shrink-0 text-warning" aria-label="Has unverified numbers" />
                            ) : null}
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </CardContent>
              </Card>
            ) : null}
          </aside>
        </div>
      </PageBody>
    </>
  );
}

function Unverified({ numbers }: { numbers: string[] }) {
  if (!numbers.length) return null;
  return (
    <div className="flex max-w-[70ch] items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-2.5 text-sm leading-relaxed">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
      <span>
        The model used numbers that aren&apos;t in AdLedger&apos;s data: <strong className="break-words">{numbers.join(", ")}</strong>. Treat those figures with
        caution.
      </span>
    </div>
  );
}
