"use client";

import { AlertTriangleIcon, ArrowUpIcon, DatabaseIcon, Loader2Icon, RotateCcwIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { askAction, clearAskHistoryAction } from "@/app/actions/ask";
import { ASK_DRAFT_KEY } from "@/components/command-palette-data";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { AskTable } from "@/lib/db/schema";
import { useHotkeys } from "@/lib/hotkeys";
import { AnswerTable } from "./answer-table";

export type AskMessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tables: AskTable[];
  unverifiedNumbers: string[];
  modelName: string | null;
  createdAt: string;
};

const SUGGESTIONS = [
  "Which campaign had the best ROAS in the last 30 days?",
  "Where am I wasting ad spend?",
  "How does this period compare with the previous one?",
  "Meta or Google: which platform works better?",
];

/**
 * Insights → Ask. The answer's figures are tables straight from the SQL-backed tools; the model
 * (or, without one, a rule-based router) only writes the sentence around them.
 */
export function AskPanel({
  initial,
  modelLabel,
  canConfigure,
}: {
  initial: AskMessageView[];
  /** "Ollama · llama3.1", or null when no model is connected. */
  modelLabel: string | null;
  canConfigure: boolean;
}) {
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [clearing, startClear] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);

  useHotkeys([{ id: "insights.ask.focus", keys: "a", label: "Ask a question", group: "Insights", run: () => input.current?.focus() }]);

  // Scroll the window itself (scrollIntoView would also nudge clipped ancestors like the sidebar inset).
  const scrollToEnd = (smooth = true) =>
    requestAnimationFrame(() =>
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" }),
    );

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const temp: AskMessageView = { id: `pending-${Date.now()}`, role: "user", content: q, tables: [], unverifiedNumbers: [], modelName: null, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, temp]);
    setDraft("");
    scrollToEnd();
    start(async () => {
      const r = await askAction(q);
      if (!r.ok) {
        setMessages((m) => m.filter((x) => x.id !== temp.id));
        setDraft(q);
        toast.error(r.message ?? "Couldn’t answer that. Try again.");
        return;
      }
      const answer = r.data?.message as AskMessageView;
      setMessages((m) => [...m, answer]);
      if (r.data?.error) toast.warning("The model didn’t answer, so a direct lookup was used instead.");
      scrollToEnd();
    });
  };

  // The command palette's "Ask AI" (typing "?") hands the question over through sessionStorage, never
  // the URL: it arrives either on mount (navigated here) or as an event (already on this tab).
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const take = () => {
      try {
        const q = sessionStorage.getItem(ASK_DRAFT_KEY);
        if (q) sessionStorage.removeItem(ASK_DRAFT_KEY);
        return q;
      } catch {
        return null;
      }
    };
    const draft = take();
    if (draft) sendRef.current(draft);
    const onAsk = (e: Event) => {
      take();
      const q = (e as CustomEvent<{ question?: string }>).detail?.question;
      if (q) sendRef.current(q);
    };
    window.addEventListener("adledger:ask", onAsk);
    return () => window.removeEventListener("adledger:ask", onAsk);
  }, []);

  useEffect(() => {
    if (initial.length) scrollToEnd(false);
    // Only on first paint: later messages scroll in send().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clear = () =>
    startClear(async () => {
      const r = await clearAskHistoryAction();
      if (r.ok) setMessages([]);
      else toast.error(r.message ?? "Couldn’t clear the conversation.");
    });

  return (
    <div className="flex w-full max-w-4xl flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-4">
        <p className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
          <DatabaseIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="min-w-0">
            Numbers come straight from your ledger (SQL).{" "}
            {modelLabel ? (
              <>
                Sentences by <span className="font-medium text-foreground">{modelLabel}</span>.
              </>
            ) : (
              <>
                No model connected, so answers use built-in lookups.
                {canConfigure ? (
                  <>
                    {" "}
                    <Link href="/settings/workspace/ai" className="font-medium text-foreground underline underline-offset-2">
                      Connect one
                    </Link>{" "}
                    for open questions.
                  </>
                ) : null}
              </>
            )}
          </span>
        </p>
        {messages.length ? (
          <Button variant="ghost" size="sm" onClick={clear} disabled={clearing || pending} className="text-muted-foreground max-sm:h-9">
            {clearing ? <Loader2Icon aria-hidden className="animate-spin" /> : <RotateCcwIcon aria-hidden />}
            New conversation
          </Button>
        ) : null}
      </div>

      {messages.length === 0 && !pending ? (
        <div className="rounded-xl bg-card px-5 py-8 text-center shadow-(--elev-card) md:px-8 md:py-10">
          <span className="mx-auto flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand-foreground">
            <SparklesIcon aria-hidden className="size-5" />
          </span>
          <h2 className="mt-4 text-title-sm text-balance">Ask about your ads, leads and revenue</h2>
          <p className="mx-auto mt-1 max-w-md text-ui text-pretty text-muted-foreground">
            Every answer shows the table it was read from, with a link to the same view in the dashboard. It can’t see individual people or change anything.
          </p>
          <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                className="rounded-lg border bg-surface px-3.5 py-2.5 text-left text-ui text-pretty transition-[border-color,background-color] duration-100 outline-none hover:border-border-strong hover:bg-fill/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol aria-label="Conversation" aria-live="polite" aria-busy={pending} className="space-y-6">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-xl rounded-br-sm bg-fill-active px-3.5 py-2 text-body text-pretty whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <span className="sr-only">You asked: </span>
                  {m.content}
                </p>
              </li>
            ) : (
              <li key={m.id} className="space-y-3">
                <Markdown source={m.content} className="max-w-[70ch] text-body leading-6 text-foreground sm:text-body sm:leading-6" />
                {m.unverifiedNumbers.length ? (
                  <p className="flex max-w-[70ch] items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-ui text-pretty">
                    <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-foreground" />
                    <span>
                      The sentence above mentions {m.unverifiedNumbers.length === 1 ? "a number" : "numbers"} that no table contains ({m.unverifiedNumbers.join(", ")}). Trust the tables.
                    </span>
                  </p>
                ) : null}
                {m.tables.map((t, i) => (
                  <AnswerTable key={i} table={t} />
                ))}
                <p className="text-caption text-muted-foreground">{m.modelName === "rules" || !m.modelName ? "Direct lookup" : m.modelName}</p>
              </li>
            ),
          )}
          {pending ? (
            <li className="space-y-3" aria-label="Looking up the numbers">
              <p className="flex items-center gap-2 text-ui text-muted-foreground">
                <Loader2Icon aria-hidden className="size-4 animate-spin" />
                Looking up the numbers…
              </p>
              <div aria-hidden className="h-28 animate-pulse rounded-xl bg-fill motion-reduce:animate-none" />
            </li>
          ) : null}
        </ol>
      )}
      <div aria-hidden className="h-4" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        // Phones: the bottom padding is the tab bar's space, so the composer never floats over content when the bar hides.
        className="sticky bottom-0 z-10 bg-gradient-to-t from-background from-80% to-transparent pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pt-4 md:pb-6"
      >
        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <div className="flex items-end gap-2 rounded-xl border border-border-strong bg-surface p-1.5 pl-3 shadow-sm transition-[border-color,box-shadow] duration-100 focus-within:border-brand focus-within:ring-3 focus-within:ring-ring/40">
          <textarea
            id="ask-input"
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
            rows={1}
            maxLength={1000}
            autoComplete="off"
            placeholder="Ask about spend, revenue, ROAS, leads or campaigns…"
            className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-base outline-none placeholder:text-fg-faint md:text-body"
          />
          <Button type="submit" size="icon" disabled={pending || !draft.trim()} aria-label="Send question" className="shrink-0 pointer-coarse:size-10">
            {pending ? <Loader2Icon aria-hidden className="animate-spin" /> : <ArrowUpIcon aria-hidden />}
          </Button>
        </div>
        <p className="mt-1.5 hidden px-1 text-caption text-muted-foreground md:block">
          <kbd className="kbd">Enter</kbd> to send, <kbd className="kbd">Shift</kbd> <kbd className="kbd">Enter</kbd> for a new line
        </p>
      </form>
    </div>
  );
}
