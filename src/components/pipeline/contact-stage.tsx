"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { moveContactsAction, undoMoveAction } from "@/app/actions/pipeline";
import type { MovedContact } from "@/lib/pipeline-shared";
import { cn } from "@/lib/utils";
import { StageDot, StageMenu, type StageOption } from "./stage-menu";

/**
 * The contact's pipeline stage as a pill (record page, preview sheet). With `canMove` it opens the
 * "Move to" menu: the change shows at once, is saved in the background and offers Undo.
 * Server side, get the props from `contactStage()` in lib/pipeline.ts.
 */
export function ContactStagePill({
  contactId,
  label,
  stageId,
  stages,
  canMove,
  className,
}: {
  contactId: string;
  /** The contact's display name, for the toast ("Moved Priya to Qualified"). */
  label: string;
  stageId: string;
  stages: StageOption[];
  canMove: boolean;
  className?: string;
}) {
  const [current, setCurrent] = useState(stageId);
  const [pending, start] = useTransition();
  const stage = stages.find((s) => s.id === current) ?? stages[0];
  if (!stage) return null;

  const pill = (
    <span className="flex min-w-0 items-center gap-1.5">
      <StageDot color={stage.color} />
      <span className="truncate">{stage.name}</span>
    </span>
  );
  const base = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-md bg-fill px-2.5 text-ui font-medium text-foreground";
  if (!canMove) return <span className={cn(base, className)}>{pill}</span>;

  const move = (to: string) => {
    const from = current;
    setCurrent(to);
    start(async () => {
      const r = await moveContactsAction([contactId], to);
      if (!r.ok) {
        setCurrent(from);
        toast.error(r.message ?? "Could not change the stage. Try again.");
        return;
      }
      const entries = (r.data?.moved ?? []) as MovedContact[];
      if (!entries.length) return;
      toast(`Moved ${label} to ${String(r.data?.stageName ?? "")}`, {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () =>
            start(async () => {
              setCurrent(from);
              const u = await undoMoveAction(to, entries);
              if (!u.ok) {
                setCurrent(to);
                toast.error(u.message ?? "That move can no longer be undone.");
              }
            }),
        },
      });
    });
  };

  return (
    <StageMenu
      stages={stages}
      current={current}
      onSelect={move}
      align="start"
      label="Stage"
      trigger={
        <button
          type="button"
          aria-label={`Stage: ${stage.name}. Change stage`}
          aria-busy={pending || undefined}
          className={cn(
            base,
            "outline-none transition-colors duration-100 hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-expanded:bg-fill-active",
            className,
          )}
        >
          {pill}
          <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      }
    />
  );
}
