import { AlertTriangleIcon, BotIcon, CheckIcon, FileTextIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { generateReportAction } from "@/app/actions/settings";
import { DeleteReportButton } from "./delete-report-button";
import { ActionButton } from "@/components/action-button";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LlmConfig } from "@/lib/ai/report";
import type { schema } from "@/lib/db";
import { cn } from "@/lib/utils";

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
export const providerLabel = (p: string) => PROVIDER_LABELS[p] ?? p;

type Report = typeof schema.aiReports.$inferSelect;

/** The weekly note as a document, with its history and the model card beside it. */
export function WeeklyReport({
  reports,
  selectedId,
  llm,
  timezone,
  canGenerate,
  canConfigure,
}: {
  reports: Report[];
  selectedId?: string;
  llm: LlmConfig | null;
  timezone: string;
  canGenerate: boolean;
  canConfigure: boolean;
}) {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone });
  const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: timezone });
  const periodFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const period = (r: Report) => {
    const a = new Date(`${r.periodStart}T00:00:00Z`);
    const b = new Date(`${r.periodEnd}T00:00:00Z`);
    return Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) ? `${r.periodStart} to ${r.periodEnd}` : periodFmt.formatRange(a, b);
  };
  const author = (r: Report) => (r.modelName === "template" ? "Rule-based" : r.modelName);
  const latest = reports[0];
  const selected = reports.find((r) => r.id === selectedId) ?? latest;

  return (
    <section aria-labelledby="weekly-title" className="space-y-3">
      <h2 id="weekly-title" className="text-title-sm">
        Weekly report
      </h2>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          {!selected ? (
            <div className="rounded-xl bg-card px-5 py-8 text-center shadow-(--elev-card)">
              <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-fill text-muted-foreground">
                <FileTextIcon aria-hidden className="size-5" />
              </span>
              <p className="mt-3 text-ui font-medium">No reports yet</p>
              <p className="mx-auto mt-1 max-w-sm text-ui text-pretty text-muted-foreground">
                A note on what changed, what’s wasting money and where to move budget is written every Monday.
                {canGenerate ? " Generate one now to see the last 7 days." : " Ask an admin or analyst to generate one."}
              </p>
              {canGenerate ? (
                <ActionButton action={generateReportAction} className="mt-4 max-sm:h-10">
                  <SparklesIcon aria-hidden /> Generate a report
                </ActionButton>
              ) : null}
            </div>
          ) : (
            <article id={`report-${selected.id}`} aria-labelledby="report-title" className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
              <header className="flex items-start gap-3 border-b px-5 py-4 sm:px-8 sm:py-5">
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 id="report-title" className="flex flex-wrap items-center gap-2 text-title text-balance">
                    {period(selected)}
                    {selected.id === latest?.id ? <Badge variant="secondary">Latest</Badge> : <Badge variant="outline">Earlier report</Badge>}
                  </h3>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-muted-foreground">
                    <span>
                      Generated <span className="whitespace-nowrap">{fmt.format(selected.createdAt)}</span>, <span className="[overflow-wrap:anywhere]">{author(selected)}</span>
                    </span>
                    {selected.unverifiedNumbers.length === 0 ? (
                      <Badge variant="positive" title="Every number in this report matches a figure computed by SQL">
                        <ShieldCheckIcon aria-hidden /> All numbers verified
                      </Badge>
                    ) : null}
                  </p>
                </div>
                {canGenerate ? <DeleteReportButton id={selected.id} period={period(selected)} /> : null}
              </header>
              <div className="space-y-6 px-5 py-6 sm:px-8 sm:py-7">
                {selected.unverifiedNumbers.length ? (
                  <p className="flex max-w-[70ch] items-start gap-2.5 rounded-lg bg-warning-soft px-3.5 py-2.5 text-ui leading-relaxed">
                    <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                    <span>
                      The model used numbers that aren’t in AdLedger’s data: <strong className="break-words">{selected.unverifiedNumbers.join(", ")}</strong>. Treat those figures with caution.
                    </span>
                  </p>
                ) : null}
                <Markdown source={selected.contentMd} className={cn("max-w-[70ch]", PROSE)} />
              </div>
            </article>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24">
          <div className="space-y-3 rounded-xl bg-card p-4 shadow-(--elev-card)">
            <div className="flex items-start gap-3">
              <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", llm ? "bg-positive-soft text-positive" : "bg-fill text-muted-foreground")}>
                {llm ? <CheckIcon aria-hidden className="size-4" /> : <BotIcon aria-hidden className="size-4" />}
              </span>
              <div className="min-w-0 space-y-0.5">
                <p className="text-ui font-medium">{llm ? "AI model connected" : "No AI model connected"}</p>
                <p className="text-caption text-pretty text-muted-foreground">
                  {llm ? (
                    <>
                      {providerLabel(llm.provider)},{" "}
                      <span className="break-all" translate="no">
                        {llm.model}
                      </span>
                    </>
                  ) : (
                    "Reports and answers are rule-based until you connect one. Local models like Ollama are free and private."
                  )}
                </p>
              </div>
            </div>
            <p className="rounded-lg bg-fill px-3 py-2 text-caption text-pretty text-muted-foreground">
              Every number is computed by AdLedger in SQL. The model only writes the words, and any figure it invents is flagged.
            </p>
            {canConfigure ? (
              <Button variant="outline" className="w-full max-sm:h-10" render={<Link href="/settings/workspace/ai" />}>
                {llm ? "Change model" : "Connect a model"}
              </Button>
            ) : null}
          </div>

          {reports.length ? (
            <nav aria-label="Report history" className="rounded-xl bg-card p-2 shadow-(--elev-card)">
              <p className="px-2 pt-1 pb-1.5 text-caption font-medium text-muted-foreground">History</p>
              <ol className="space-y-0.5">
                {reports.map((r) => {
                  const active = r.id === selected?.id;
                  return (
                    <li key={r.id}>
                      <Link
                        href={r.id === latest?.id ? "/insights" : `/insights?report=${r.id}`}
                        scroll={false}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex min-h-10 items-center gap-2.5 rounded-md px-2 py-1.5 text-ui transition-colors duration-100 outline-none hover:bg-fill focus-visible:outline-2 focus-visible:outline-ring",
                          active && "bg-fill-active hover:bg-fill-active",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className={cn("block truncate", active && "font-medium")}>{period(r)}</span>
                          <span className="block truncate text-caption text-muted-foreground">
                            {shortFmt.format(r.createdAt)}, {author(r)}
                          </span>
                        </span>
                        {r.unverifiedNumbers.length ? (
                          <>
                            <AlertTriangleIcon aria-hidden className="size-4 shrink-0 text-warning-foreground" />
                            <span className="sr-only">Has unverified numbers</span>
                          </>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </nav>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
