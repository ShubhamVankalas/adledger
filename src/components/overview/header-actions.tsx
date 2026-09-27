"use client";

import { LayoutGridIcon, UserRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDashboard } from "./dashboard-context";

// Page-header controls for the board: the personal-view badge and the Customize button.

/** Warm the drag-and-drop chunk on intent so edit mode opens without a loading flash. */
const preloadEditor = () => void import("./sortable-board");

export function DashboardHeaderActions() {
  const { editing, startEditing, saved, resetPersonal, saving } = useDashboard();
  if (editing) return null;
  return (
    <div className="flex items-center gap-2">
      {saved.source === "personal" ? (
        <span className="hidden h-7 items-center gap-1.5 rounded-full bg-muted pr-1 pl-2.5 text-xs text-muted-foreground ring-1 ring-foreground/[0.06] md:inline-flex">
          <UserRoundIcon aria-hidden className="size-3" />
          Personal view
          <button
            type="button"
            onClick={resetPersonal}
            disabled={saving}
            className="h-5 rounded-full px-2 font-medium text-foreground transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
            title="Go back to the workspace default layout"
          >
            Reset
          </button>
        </span>
      ) : null}
      <Button variant="outline" onClick={startEditing} onPointerEnter={preloadEditor} onFocus={preloadEditor} className="max-md:hidden" aria-keyshortcuts="E">
        <LayoutGridIcon aria-hidden className="text-muted-foreground" />
        Customize
        <kbd className="ml-0.5 rounded-[4px] bg-muted px-1.5 font-sans text-[11px] leading-4 font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">E</kbd>
      </Button>
    </div>
  );
}

/** Phones: Customize sits at the bottom of the board instead of the crowded header. */
export function MobileCustomize() {
  const { editing, startEditing, saved, resetPersonal } = useDashboard();
  if (editing) return null;
  return (
    <div className="flex items-center justify-center gap-2 pt-2 md:hidden">
      <Button variant="outline" className="h-11 rounded-full px-4" onClick={startEditing}>
        <LayoutGridIcon aria-hidden className="text-muted-foreground" />
        Customize overview
      </Button>
      {saved.source === "personal" ? (
        <Button variant="ghost" className="h-11 rounded-full px-4 text-muted-foreground" onClick={resetPersonal}>
          Reset to default
        </Button>
      ) : null}
    </div>
  );
}
