"use client";

import {
  ArrowLeftRightIcon,
  BarChart3Icon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  DownloadIcon,
  DropletsIcon,
  FileTextIcon,
  FilterIcon,
  ImageIcon,
  LayersIcon,
  Loader2Icon,
  PenLineIcon,
  PresentationIcon,
  RotateCcwIcon,
  SearchCheckIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TriangleAlertIcon,
  TrophyIcon,
  Undo2Icon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/native-select";
import { resolveRange, RANGE_PRESETS, type RangeKey } from "@/components/reports-gallery/range";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { DocumentTemplate } from "@/lib/ai/document-prompts";
import { dateRange } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentPreview } from "@/lib/ai/document-preview";
import { generateAiDocumentAction, type IssueNote } from "./actions";
import { DocumentPaper } from "./paper";

const ICONS: Record<DocumentTemplate["icon"], LucideIcon> = {
  "calendar-range": CalendarRangeIcon,
  presentation: PresentationIcon,
  "search-check": SearchCheckIcon,
  "arrow-left-right": ArrowLeftRightIcon,
  layers: LayersIcon,
  filter: FilterIcon,
  users: UsersIcon,
  trophy: TrophyIcon,
  image: ImageIcon,
  "bar-chart-3": BarChart3Icon,
  droplets: DropletsIcon,
  "undo-2": Undo2Icon,
  sparkles: SparklesIcon,
};

const CUSTOM_PLACEHOLDER = "For example: “Make a one-page board update for September focused on Meta vs Google, with one chart and three recommendations.”";
const MAX_PROMPT = 4000;

type Result = {
  url: string;
  filename: string;
  title: string;
  pages: number;
  modelName: string;
  preview: DocumentPreview;
  issues: IssueNote[];
  period: string;
};

type Props = {
  templates: DocumentTemplate[];
  initialTemplateId: string | null;
  /** Latest day with data (presets end here). */
  anchor: string;
  model: string;
  modelReady: boolean;
  modelLabel: string | null;
  canGenerate: boolean;
  canConfigureAi: boolean;
};

function decodePdf(b64: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: "application/pdf" });
}

export function AiDocumentStudio(props: Props) {
  if (!props.canGenerate) {
    return (
      <Notice
        icon={ShieldCheckIcon}
        title="AI documents aren't available for your role"
        body="Writing documents uses the workspace's AI model and creates a PDF, so it needs both the PDF download and AI permissions. Ask an admin if you need them. The built-in reports are still in the report library."
        action={<Button render={<Link href="/reports" />} variant="outline">Open the report library</Button>}
      />
    );
  }
  if (!props.modelReady) return <NoModel {...props} />;
  return <Composer {...props} />;
}

function Notice({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: React.ReactNode }) {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center rounded-xl bg-card px-6 py-10 text-center shadow-(--elev-card)">
      <span aria-hidden className="grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-foreground">
        <Icon className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="mt-4 text-title-sm text-balance">{title}</h2>
      <p className="mt-2 text-ui text-pretty text-muted-foreground">{body}</p>
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </section>
  );
}

function NoModel({ templates, canConfigureAi }: Props) {
  return (
    <div className="space-y-8">
      <section aria-labelledby="no-model-title" className="relative overflow-hidden rounded-xl bg-card px-5 py-8 shadow-(--elev-card) sm:px-8">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand-gradient" />
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl">
            <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-foreground">
              <SparklesIcon className="size-5" strokeWidth={1.75} />
            </span>
            <h2 id="no-model-title" className="mt-4 text-title text-balance">
              Connect an AI model to write custom documents
            </h2>
            <p className="mt-2 text-body text-pretty text-muted-foreground">
              Ask for any document in plain English (a board update, a client report, a post-mortem) and your model writes it from your ledger. Any model works: OpenAI, Anthropic, Gemini, or a local one through Ollama or LM Studio. No PDF-capable model is needed: AdLedger draws the charts and tables itself.
            </p>
            <ul className="mt-4 grid gap-1.5 text-ui text-muted-foreground">
              <li className="flex gap-2">
                <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-foreground" />
                The model sees aggregated figures only, never contacts, emails or names of people.
              </li>
              <li className="flex gap-2">
                <CheckCircle2Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-foreground" />
                Every number in the PDF comes from SQL; sentences with numbers that aren&apos;t in your data are removed.
              </li>
            </ul>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row md:flex-col">
            {canConfigureAi ? (
              <Button render={<Link href="/settings/workspace/ai" />} size="lg">
                <SparklesIcon aria-hidden />
                Set up an AI model
              </Button>
            ) : (
              <p className="max-w-60 text-ui text-muted-foreground">Ask a workspace admin to connect a model in Settings → AI model.</p>
            )}
            <Button render={<Link href="/reports" />} variant="outline" size="lg">
              Open the report library
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="library-preview" className="space-y-3">
        <h2 id="library-preview" className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
          Ready-made requests you&apos;ll be able to use
        </h2>
        <ul role="list" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => {
            const Icon = ICONS[t.icon] ?? FileTextIcon;
            return (
              <li key={t.id} className="flex gap-3 rounded-lg bg-card p-3 shadow-(--elev-card)">
                <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-fill text-muted-foreground">
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <p className="text-ui font-medium">{t.name}</p>
                  <p className="mt-0.5 text-caption text-pretty text-muted-foreground">{t.description}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** Arrow keys move between (and select) templates, like native radio buttons. */
function onRadioKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  const radios = Array.from(e.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
  const i = radios.indexOf(e.currentTarget);
  if (i === -1) return;
  e.preventDefault();
  const next = radios[(i + step + radios.length) % radios.length];
  next.focus();
  next.click();
}

const STEPS = ["Gathering your figures", "Writing the document", "Checking every number", "Laying out the PDF"];

function Composer({ templates, initialTemplateId, anchor, model, modelLabel }: Props) {
  const id = useId();
  const initial = templates.find((t) => t.id === initialTemplateId) ?? templates[0];
  const [templateId, setTemplateId] = useState<string | null>(initial?.id ?? null);
  const template = templates.find((t) => t.id === templateId) ?? null;
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [range, setRange] = useState<RangeKey>((initial?.range as RangeKey) ?? "30d");
  const first = resolveRange(range, anchor);
  const [custom, setCustom] = useState({ from: first.start, to: first.end });
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const customInvalid = range === "custom" && (!custom.from || !custom.to || custom.from > custom.to);
  const period = resolveRange(range, anchor, custom);
  const edited = template !== null && prompt.trim() !== template.prompt.trim();
  const tooShort = prompt.trim().length < 10;

  // Progress copy while the model writes (the server doesn't stream, so this only paces the words).
  useEffect(() => {
    if (!pending) return;
    const timers = [2500, 9000, 26000].map((ms, i) => window.setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [pending]);

  // Free the previous PDF when a new one replaces it or the page closes.
  useEffect(() => () => (result ? URL.revokeObjectURL(result.url) : undefined), [result]);

  const pick = (t: DocumentTemplate | null) => {
    setTemplateId(t?.id ?? null);
    setPrompt(t?.prompt ?? "");
    if (t) {
      setRange(t.range as RangeKey);
      const r = resolveRange(t.range as RangeKey, anchor);
      setCustom({ from: r.start, to: r.end });
    }
  };

  const generate = () => {
    if (pending || customInvalid || tooShort) return;
    setError(null);
    setStep(0);
    startTransition(async () => {
      const res = await generateAiDocumentAction({ templateId, prompt, start: period.start, end: period.end, model });
      if (!res.ok || !res.data) {
        setError(res.message ?? "Couldn’t write that document. Try again.");
        return;
      }
      const d = res.data as { pdf: string; filename: string; title: string; pages: number; modelName: string; preview: DocumentPreview; issues: IssueNote[] };
      const url = URL.createObjectURL(decodePdf(d.pdf));
      setResult({ url, filename: d.filename, title: d.title, pages: d.pages, modelName: d.modelName, preview: d.preview, issues: d.issues, period: dateRange(period.start, period.end, { year: true }) });
      toast.success("Document ready", { description: d.title });
      if (window.matchMedia("(max-width: 1023px)").matches) previewRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    });
  };

  const download = () => {
    if (!result) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };


  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <form
        className="grid gap-6"
        onSubmit={(e) => {
          e.preventDefault();
          generate();
        }}
        aria-describedby={`${id}-privacy`}
      >
        <fieldset className="grid gap-2.5">
          <legend className="mb-2.5 text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">1 · Start from</legend>
          <div role="radiogroup" aria-label="Document template" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <TemplateOption label="Your own request" hint="Write it from scratch" icon={PenLineIcon} selected={templateId === null} onSelect={() => pick(null)} />
            {templates.map((t) => (
              <TemplateOption key={t.id} label={t.name} hint={`${t.audience} · ${RANGE_PRESETS[t.range as RangeKey]}`} icon={ICONS[t.icon] ?? FileTextIcon} selected={templateId === t.id} onSelect={() => pick(t)} />
            ))}
          </div>
        </fieldset>

        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={`${id}-prompt`} className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
              2 · Your request
            </Label>
            {edited ? (
              <button type="button" onClick={() => setPrompt(template!.prompt)} className="inline-flex items-center gap-1 rounded-sm text-caption text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <RotateCcwIcon aria-hidden className="size-3" />
                Reset to template
              </button>
            ) : null}
          </div>
          {template ? <p className="text-caption text-pretty text-muted-foreground">{template.description} Edit anything before you send it.</p> : null}
          <Textarea
            id={`${id}-prompt`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, MAX_PROMPT))}
            placeholder={CUSTOM_PLACEHOLDER}
            rows={9}
            className="max-h-[22rem] min-h-40 leading-relaxed"
            aria-invalid={(prompt.length > 0 && tooShort) || undefined}
            aria-describedby={`${id}-count`}
          />
          <p id={`${id}-count`} className="text-right text-caption text-fg-faint tabular-nums">
            {prompt.length.toLocaleString("en-US")} / {MAX_PROMPT.toLocaleString("en-US")}
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor={`${id}-range`} className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">
            3 · Period
          </Label>
          <NativeSelect id={`${id}-range`} value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
            {Object.entries(RANGE_PRESETS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
                {template && template.range === k ? " (recommended)" : ""}
              </option>
            ))}
          </NativeSelect>
          {range === "custom" ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">
                  From
                </Label>
                <Input id={`${id}-from`} type="date" value={custom.from} max={custom.to || undefined} aria-invalid={customInvalid || undefined} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="h-10 md:h-9" />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">
                  To
                </Label>
                <Input id={`${id}-to`} type="date" value={custom.to} min={custom.from || undefined} aria-invalid={customInvalid || undefined} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="h-10 md:h-9" />
              </div>
              {customInvalid ? (
                <p role="alert" className="col-span-2 text-caption text-destructive">
                  Pick a start date on or before the end date.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
              {dateRange(period.start, period.end, { year: true })} · compared with the period before
            </p>
          )}
        </div>

        <div className="grid gap-2.5">
          <Button type="submit" size="lg" className="h-11 md:h-10" disabled={pending || customInvalid || tooShort} aria-busy={pending || undefined}>
            {pending ? <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" /> : <SparklesIcon aria-hidden />}
            {pending ? "Writing your document…" : result ? "Write a new version" : "Write the document"}
          </Button>
          <p id={`${id}-privacy`} className="flex gap-2 text-caption text-pretty text-muted-foreground">
            <ShieldCheckIcon aria-hidden className="mt-px size-3.5 shrink-0" />
            <span>
              Sent to <span className="font-medium text-foreground">{modelLabel ?? "your AI model"}</span>: your request and aggregated figures for the period. Never contacts, emails or names of people.
            </span>
          </p>
        </div>
      </form>

      <div ref={previewRef} className="min-w-0 scroll-mt-20 lg:sticky lg:top-20">
        <Preview pending={pending} step={step} result={result} error={error} onDownload={download} onRetry={generate} />
      </div>
    </div>
  );
}

function TemplateOption({ label, hint, icon: Icon, selected, onSelect }: { label: string; hint: string; icon: LucideIcon; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onRadioKeyDown}
      className={cn(
        "group/opt flex min-h-14 items-start gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-[border-color,background-color,box-shadow] duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 motion-reduce:transition-none",
        selected ? "border-brand bg-brand-soft shadow-(--elev-sm)" : "border-border hover:border-border-strong hover:bg-fill/60",
      )}
    >
      <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-md transition-colors", selected ? "bg-brand-gradient text-ink-foreground" : "bg-fill text-muted-foreground group-hover/opt:text-foreground")}>
        <Icon className="size-3.5" strokeWidth={2} />
      </span>
      <span className="min-w-0">
        <span className="block text-ui leading-5 font-medium">{label}</span>
        <span className="block truncate text-caption text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}

function Preview({ pending, step, result, error, onDownload, onRetry }: { pending: boolean; step: number; result: Result | null; error: string | null; onDownload: () => void; onRetry: () => void }) {
  if (pending) {
    return (
      <section aria-label="Writing the document" className="rounded-xl bg-card p-6 shadow-(--elev-card)">
        <div className="mx-auto aspect-[1/1.2] max-w-md rounded-md border bg-surface p-6 sm:aspect-[1/1.414]" aria-hidden>
          <div className="h-2 w-8 rounded-full bg-brand" />
          <div className="mt-4 h-2.5 w-24 animate-pulse rounded bg-fill motion-reduce:animate-none" />
          <div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-fill motion-reduce:animate-none" />
          <div className="mt-6 grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-fill motion-reduce:animate-none" style={{ animationDelay: `${i * 120}ms` }} />
            ))}
          </div>
          <div className="mt-5 h-24 animate-pulse rounded bg-fill/70 motion-reduce:animate-none" />
          <div className="mt-5 space-y-2">
            {[92, 84, 88, 60].map((w, i) => (
              <div key={i} className="h-2 animate-pulse rounded bg-fill motion-reduce:animate-none" style={{ width: `${w}%` }} />
            ))}
          </div>
        </div>
        <ol className="mx-auto mt-6 grid max-w-md gap-2" aria-live="polite">
          {STEPS.map((label, i) => (
            <li key={label} className={cn("flex items-center gap-2.5 text-ui", i <= step ? "text-foreground" : "text-fg-faint")}>
              {i < step ? (
                <CheckCircle2Icon aria-hidden className="size-4 text-brand-foreground" />
              ) : i === step ? (
                <Loader2Icon aria-hidden className="size-4 animate-spin text-brand-foreground motion-reduce:animate-none" />
              ) : (
                <span aria-hidden className="grid size-4 place-items-center">
                  <span className="size-1.5 rounded-full bg-current" />
                </span>
              )}
              <span>
                {label}
                {i === step ? <span className="sr-only"> (in progress)</span> : null}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-center text-caption text-muted-foreground">Usually 15 to 60 seconds, depending on your model.</p>
      </section>
    );
  }

  if (error) {
    return (
      <section role="alert" className="rounded-xl bg-card p-6 shadow-(--elev-card)">
        <div className="flex gap-3">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <h2 className="text-title-sm">The document couldn&apos;t be written</h2>
            <p className="mt-1 text-ui text-pretty break-words text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
              <RotateCcwIcon aria-hidden />
              Try again
            </Button>
          </div>
        </div>
      </section>
    );
  }

  if (result) {
    const removed = result.issues.filter((i) => i.kind === "unverified_number").length;
    return (
      <section aria-labelledby="doc-title" className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
        <header className="flex flex-col gap-3 border-b border-foreground/[0.06] p-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 id="doc-title" className="text-title-sm text-balance">
              {result.title}
            </h2>
            <p className="mt-0.5 text-caption text-muted-foreground tabular-nums">
              {result.period} · {result.pages} {result.pages === 1 ? "page" : "pages"} · written by {result.modelName}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" onClick={onDownload} className="h-10 md:h-8">
              <DownloadIcon aria-hidden />
              Download PDF
            </Button>
          </div>
        </header>

        <div className={cn("flex gap-2.5 border-b border-foreground/[0.06] px-4 py-3 text-ui", removed ? "bg-warning-soft/60" : "bg-brand-soft")}>
          {removed ? <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" /> : <ShieldCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-brand-foreground" />}
          <div className="min-w-0">
            <p className="font-medium">{removed ? `${removed} ${removed === 1 ? "sentence was" : "sentences were"} removed because ${removed === 1 ? "it" : "they"} quoted numbers that aren’t in your data` : "Every number in the text matches your data"}</p>
            <p className="text-caption text-muted-foreground">KPI tiles, tables and charts are drawn from SQL, not written by the model.</p>
            {result.issues.length ? (
              <details className="mt-1.5 text-caption">
                <summary className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                  What AdLedger changed ({result.issues.length})
                </summary>
                <ul className="mt-1.5 grid gap-1 text-muted-foreground">
                  {result.issues.map((i, n) => (
                    <li key={n} className="break-words">
                      {i.text}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>

        <div className="bg-muted/50 p-2 sm:p-4">
          <DocumentPaper preview={result.preview} />
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="how-title" className="rounded-xl border border-dashed bg-card/60 p-6 sm:p-8">
      <div className="mx-auto max-w-md text-center">
        <span aria-hidden className="mx-auto grid size-11 place-items-center rounded-xl bg-brand-soft text-brand-foreground">
          <FileTextIcon className="size-5" strokeWidth={1.75} />
        </span>
        <h2 id="how-title" className="mt-4 text-title-sm">
          Your document appears here
        </h2>
        <p className="mt-1.5 text-ui text-pretty text-muted-foreground">Pick a template or write your own request, choose the period and send it. You get a branded PDF to preview and download.</p>
      </div>
      <ol className="mx-auto mt-6 grid max-w-lg gap-3 sm:grid-cols-3">
        {[
          ["Your model writes", "A structured outline, prose and which figures to show."],
          ["AdLedger checks", "Unknown figures and invented numbers are removed."],
          ["You get a PDF", "Your logo and colours, charts and tables from SQL."],
        ].map(([t, d], i) => (
          <li key={t} className="rounded-lg bg-card p-3 shadow-(--elev-card)">
            <span className="text-caption font-medium text-brand-foreground tabular-nums">0{i + 1}</span>
            <p className="mt-1 text-ui font-medium">{t}</p>
            <p className="mt-0.5 text-caption text-pretty text-muted-foreground">{d}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
