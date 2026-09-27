"use client";

import { ArrowDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { moveItemBy, removeItem } from "@/lib/dashboard/ops";
import type { WidgetInstance } from "@/lib/dashboard/types";
import { MAX_PINNED } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, widgetMeta } from "@/lib/widgets/catalog";
import { useDashboard } from "./dashboard-context";
import { SectionEditHeader } from "./section-edit-header";

// Edit mode on phones: a plain reorder list with ↑ / ↓ and remove. No dragging, no resizing.

const rowButton =
  "grid size-11 place-items-center rounded-lg text-muted-foreground transition-colors active:bg-muted disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function MobileEditList() {
  const { layout } = useDashboard();
  const lastSection = layout.sections.length - 1;
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Pinned metrics" className="flex flex-col gap-2">
        <div className="flex items-center gap-2 px-1">
          <h2 className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">Pinned</h2>
          <span className="text-xs text-muted-foreground/80 tabular-nums">
            {layout.pinned.length} of {MAX_PINNED}
          </span>
        </div>
        {/* Pinned tiles reorder within the strip only. */}
        <List items={layout.pinned} upDisabled={(j) => j === 0} downDisabled={(j) => j === layout.pinned.length - 1} />
      </section>
      {layout.sections.map((s, i) => (
        <section key={s.id} aria-label={s.title || "Untitled section"} className="flex flex-col gap-2">
          <SectionEditHeader section={s} index={i} count={layout.sections.length} />
          {/* Section widgets flow into the neighbouring section at the edges. */}
          <List items={s.items} upDisabled={(j) => i === 0 && j === 0} downDisabled={(j) => i === lastSection && j === s.items.length - 1} />
        </section>
      ))}
    </div>
  );
}

function List({ items, upDisabled, downDisabled }: { items: WidgetInstance[]; upDisabled: (i: number) => boolean; downDisabled: (i: number) => boolean }) {
  const { setDraft } = useDashboard();
  if (items.length === 0) return <p className="rounded-xl border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">Nothing here yet.</p>;
  return (
    <ul className="divide-y overflow-hidden rounded-xl bg-card ring-1 ring-foreground/[0.07]">
      {items.map((w, i) => {
        const meta = widgetMeta(w.type);
        const title = w.settings?.title ?? meta?.title ?? "Widget unavailable";
        return (
          <li key={w.id} className="flex min-h-14 items-center gap-1 py-1 pr-1 pl-4">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{title}</span>
              <span className="block truncate text-xs text-muted-foreground">{meta ? CATEGORY_LABELS[meta.category] : w.type}</span>
            </span>
            <button type="button" className={rowButton} disabled={upDisabled(i)} aria-label={`Move ${title} up`} onClick={() => setDraft((l) => moveItemBy(l, w.id, -1))}>
              <ArrowUpIcon aria-hidden className="size-4" />
            </button>
            <button type="button" className={rowButton} disabled={downDisabled(i)} aria-label={`Move ${title} down`} onClick={() => setDraft((l) => moveItemBy(l, w.id, 1))}>
              <ArrowDownIcon aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              className={cn(rowButton, "active:text-[color:var(--negative,var(--destructive))]")}
              aria-label={`Remove ${title}`}
              onClick={() => setDraft((l) => removeItem(l, w.id))}
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
