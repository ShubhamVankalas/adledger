"use client";

import { ChevronDownIcon, Loader2Icon, PlusIcon, RotateCcwIcon, RowsIcon } from "lucide-react";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { addSection } from "@/lib/dashboard/ops";
import { PRESETS } from "@/lib/dashboard/presets";
import { PRESET_KEYS, type DashboardScope } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { AddWidgetSheet } from "./add-widget-sheet";
import { useDashboard } from "./dashboard-context";

// Sticky ink toolbar shown while customizing: scope, add widget, add section, reset, cancel, save.

const INK = "bg-[color:var(--ink,var(--foreground))] text-[color:var(--ink-fg,var(--background))]";
const ghost =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-current/20 px-2.5 text-[13px] font-medium whitespace-nowrap transition-[background-color,transform] duration-100 hover:bg-current/10 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-[color:var(--chart-revenue,var(--chart-1))] focus-visible:outline-none disabled:opacity-50 pointer-coarse:h-10 [&_svg]:size-3.5 [&_svg]:opacity-80";

export function EditToolbar() {
  const { editing, scope, setScope, canEditWorkspace, cancelEditing, save, saving, dirty, setDraft, resetDraft } = useDashboard();
  const [addOpen, setAddOpen] = useState(false);
  if (!editing) return null;

  const onAddSection = () => {
    let id: string | null = null;
    setDraft((l) => {
      const r = addSection(l);
      id = r.id;
      return r.layout;
    });
    // Focus the new section's name once it has rendered.
    requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-section-title="${id}"]`)?.select()));
  };

  return (
    <div
      role="toolbar"
      aria-label="Customize the overview"
      className={cn(
        INK,
        "sticky top-[calc(env(safe-area-inset-top)+4.25rem)] z-10 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl py-2 pr-2 pl-3.5 shadow-lg md:top-[calc(env(safe-area-inset-top)+4.75rem)]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <span className="text-[13px] font-medium whitespace-nowrap">Editing</span>
        {canEditWorkspace ? (
          <ScopeSwitch value={scope} onChange={setScope} />
        ) : (
          <span className="text-[13px] whitespace-nowrap opacity-75">Personal view</span>
        )}
        <span className="hidden truncate text-xs opacity-60 xl:inline">
          {scope === "personal" ? "Only you see this layout. Your team keeps the workspace default." : "Everyone without a personal view sees this layout."}
        </span>
      </div>
      <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
        <button type="button" className={ghost} onClick={() => setAddOpen(true)}>
          <PlusIcon aria-hidden /> Add widget
        </button>
        <button type="button" className={ghost} onClick={onAddSection}>
          <RowsIcon aria-hidden /> <span className="sm:hidden">Section</span>
          <span className="max-sm:hidden">Add section</span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" className={ghost} />}>
            <RotateCcwIcon aria-hidden /> Reset <ChevronDownIcon aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {scope === "personal" ? (
              <>
                <DropdownMenuItem onClick={() => resetDraft("workspace")} className="flex-col items-start gap-0">
                  <span>Workspace default</span>
                  <span className="text-xs text-muted-foreground">The layout your team sees</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel>Presets</DropdownMenuLabel>
              {PRESET_KEYS.map((k) => (
                <DropdownMenuItem key={k} onClick={() => resetDraft(k)} className="flex-col items-start gap-0">
                  <span>{PRESETS[k].label}</span>
                  <span className="text-xs text-pretty text-muted-foreground">{PRESETS[k].description}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-current/20 sm:block" />
        <button type="button" className={cn(ghost, "ml-auto border-transparent sm:ml-0")} onClick={cancelEditing} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={cn(
            ghost,
            "border-transparent bg-[color:var(--ink-fg,var(--background))] px-3 text-[color:var(--ink,var(--foreground))] hover:bg-[color:var(--ink-fg,var(--background))] hover:opacity-90",
          )}
        >
          {saving ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
          {saving ? "Saving…" : "Save layout"}
          {dirty && !saving ? <span className="sr-only"> (unsaved changes)</span> : null}
        </button>
      </div>
      <AddWidgetSheet open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function ScopeSwitch({ value, onChange }: { value: DashboardScope; onChange: (s: DashboardScope) => void }) {
  const options: [DashboardScope, string][] = [
    ["workspace", "Workspace default"],
    ["personal", "Personal view"],
  ];
  return (
    <div role="radiogroup" aria-label="Save changes to" className="flex h-7 shrink-0 items-center rounded-md bg-current/10 p-0.5 pointer-coarse:h-9">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
              e.preventDefault();
              onChange(value === "personal" ? "workspace" : "personal");
            }
          }}
          tabIndex={value === k ? 0 : -1}
          className={cn(
            "h-full rounded-[5px] px-2 text-xs font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[color:var(--chart-revenue,var(--chart-1))] focus-visible:outline-none",
            value === k ? "bg-[color:var(--ink-fg,var(--background))] text-[color:var(--ink,var(--foreground))]" : "opacity-70 hover:opacity-100",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
