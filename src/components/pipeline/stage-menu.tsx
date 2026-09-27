"use client";

import { CheckIcon } from "lucide-react";
import type { ReactElement } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Stage } from "@/lib/pipeline-shared";
import { cn } from "@/lib/utils";
import { STAGE_DOT, stageStyle } from "./stage-color";

export type StageOption = Pick<Stage, "id" | "name" | "color" | "kind">;

/** A stage's colour dot. Decorative: the stage name is always next to it. */
export function StageDot({ color, className }: { color: Stage["color"]; className?: string }) {
  return <span aria-hidden style={stageStyle(color)} className={cn("size-2 shrink-0 rounded-full", STAGE_DOT, className)} />;
}

/**
 * "Move to…" menu: every stage, the current one ticked. Used on the board (card menu, bulk bar,
 * phones, where it replaces dragging) and on the contact record page.
 */
export function StageMenu({
  stages,
  current,
  onSelect,
  trigger,
  label = "Move to",
  align = "end",
}: {
  stages: StageOption[];
  /** The stage the contact(s) are in now, or null for a mixed selection. */
  current: string | null;
  onSelect: (stageId: string) => void;
  trigger: ReactElement;
  label?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={trigger} />
      <DropdownMenuContent align={align} className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {stages.map((s) => (
            <DropdownMenuItem key={s.id} disabled={s.id === current} onClick={() => onSelect(s.id)} className="gap-2">
              <StageDot color={s.color} />
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {s.id === current ? <CheckIcon aria-label="Current stage" className="size-3.5 text-muted-foreground" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
