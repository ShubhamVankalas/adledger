"use client";

import { CheckIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { addWidget, typesOnBoard } from "@/lib/dashboard/ops";
import { MAX_PINNED } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, WIDGET_CATEGORIES, WIDGETS, type WidgetMeta } from "@/lib/widgets/catalog";
import { useDashboard } from "./dashboard-context";
import { widgetIcon } from "./widget-icons";

// "Add widget" drawer: searchable, grouped by category, with what each widget shows. Widgets
// already on the board are marked, except the ones that can appear more than once.

export function AddWidgetSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { layout, setDraft } = useDashboard();
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const onBoard = typesOnBoard(layout);
  const matches = (w: WidgetMeta) => !q || `${w.title} ${w.description} ${CATEGORY_LABELS[w.category]}`.toLowerCase().includes(q);
  const groups = WIDGET_CATEGORIES.map((c) => ({ category: c, items: (WIDGETS as readonly WidgetMeta[]).filter((w) => w.category === c && matches(w)) })).filter((g) => g.items.length);

  const add = (w: WidgetMeta) => {
    let added: string | null = null;
    setDraft((l) => {
      const r = addWidget(l, w.type);
      added = r.id;
      return r.layout;
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!added) return;
        const el = document.querySelector<HTMLElement>(`[data-widget-id="${added}"]`);
        el?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }),
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[400px]">
        <SheetHeader className="border-b px-5 pt-5 pb-4">
          <SheetTitle className="text-base font-semibold">Add widget</SheetTitle>
          <SheetDescription className="text-[13px]">Number tiles join the pinned strip while it has room ({MAX_PINNED} max). Everything else goes into your first section.</SheetDescription>
          <label className="relative mt-3 block">
            <span className="sr-only">Search widgets</span>
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              name="widget-search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search, e.g. “ROAS” or “leads”…"
              className="h-9 w-full rounded-md border border-input bg-background pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40"
            />
          </label>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pt-2 pb-6">
          {groups.length === 0 ? <p className="px-2 py-8 text-center text-sm text-muted-foreground">No widgets match “{query}”.</p> : null}
          {groups.map((g) => (
            <section key={g.category} aria-label={CATEGORY_LABELS[g.category]} className="pt-3">
              <h3 className="px-2 pb-1.5 text-[11px] font-medium tracking-[0.04em] text-muted-foreground/80 uppercase">{CATEGORY_LABELS[g.category]}</h3>
              <ul className="flex flex-col">
                {g.items.map((w) => {
                  const present = onBoard.has(w.type) && !w.multi;
                  const Icon = widgetIcon(w.type);
                  return (
                    <li key={w.type}>
                      <button
                        type="button"
                        disabled={present}
                        onClick={() => add(w)}
                        className={cn(
                          "group flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                          present && "cursor-default hover:bg-transparent",
                        )}
                      >
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-foreground/[0.06]", present && "opacity-50")}>
                          <Icon aria-hidden className="size-4" strokeWidth={1.75} />
                        </span>
                        <span className={cn("min-w-0 flex-1", present && "opacity-55")}>
                          <span className="block text-[13px] font-medium">{w.title}</span>
                          <span className="block text-xs leading-snug text-pretty text-muted-foreground">{w.description}</span>
                        </span>
                        <span className="mt-0.5 flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-muted-foreground group-hover:text-foreground">
                          {present ? (
                            <>
                              <CheckIcon aria-hidden className="size-3.5" /> On board
                            </>
                          ) : (
                            <>
                              <PlusIcon aria-hidden className="size-3.5" /> Add
                            </>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
