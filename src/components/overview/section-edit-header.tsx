"use client";

import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { deleteSection, moveSection, renameSection } from "@/lib/dashboard/ops";
import { toast } from "sonner";
import { MAX_TITLE, type Layout, type Section } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { useDashboard } from "./dashboard-context";

const iconButton =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-10";

/** Section title as an inline text field, with reorder and delete (edit mode). */
export function SectionEditHeader({ section, index, count }: { section: Section; index: number; count: number }) {
  const { setDraft } = useDashboard();
  const widgets = section.items.length;
  return (
    <div className="flex items-center gap-2">
      <input
        name={`section-${section.id}`}
        aria-label="Section name"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_TITLE}
        value={section.title}
        placeholder="Untitled section…"
        onChange={(e) => setDraft((l) => renameSection(l, section.id, e.target.value))}
        data-section-title={section.id}
        className={cn(
          "h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-xs font-medium tracking-[0.04em] uppercase outline-none",
          "text-foreground placeholder:text-muted-foreground/60 hover:border-border focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 md:max-w-sm",
        )}
      />
      <span aria-hidden className="hidden h-px flex-1 bg-border md:block" />
      <div className="flex items-center gap-0.5">
        <button type="button" className={iconButton} disabled={index === 0} aria-label={`Move section ${section.title || "Untitled"} up`} onClick={() => setDraft((l) => moveSection(l, section.id, -1))}>
          <ArrowUpIcon aria-hidden className="size-3.5" />
        </button>
        <button type="button" className={iconButton} disabled={index === count - 1} aria-label={`Move section ${section.title || "Untitled"} down`} onClick={() => setDraft((l) => moveSection(l, section.id, 1))}>
          <ArrowDownIcon aria-hidden className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(iconButton, "hover:text-[color:var(--negative,var(--destructive))]")}
          aria-label={`Delete section ${section.title || "Untitled"}${widgets ? ` and its ${widgets} widget${widgets === 1 ? "" : "s"}` : ""}`}
          title={widgets ? `Delete section and its ${widgets} widget${widgets === 1 ? "" : "s"}` : "Delete section"}
          onClick={() => {
            let before: Layout | null = null;
            setDraft((l) => {
              before = l;
              return deleteSection(l, section.id);
            });
            toast(`Deleted ${section.title ? `“${section.title}”` : "the section"}`, {
              action: { label: "Undo", onClick: () => before && setDraft(() => before!) },
            });
          }}
        >
          <Trash2Icon aria-hidden className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
