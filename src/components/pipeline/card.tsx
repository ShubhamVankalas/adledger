"use client";

import { useDraggable } from "@dnd-kit/core";
import { CheckIcon, ClockAlertIcon, GripVerticalIcon, MoreHorizontalIcon } from "lucide-react";
import Link from "next/link";
import { memo } from "react";
import { UserAvatar } from "@/components/avatars";
import { BrandGlyph } from "@/components/brand-icon";
import { channelLabel, moneyShort, platformLabel } from "@/lib/format";
import type { Stage } from "@/lib/pipeline-shared";
import type { PipelineCard } from "@/lib/reports-pipeline";
import { cn } from "@/lib/utils";
import { StageMenu, type StageOption } from "./stage-menu";

// One contact on the board: avatar (a checkbox while selecting), name, value, the ad that first
// brought them in and how long they have been in the stage (red once past the stage's rot limit).

export function daysLabel(days: number) {
  return days === 0 ? "<1d" : `${days}d`;
}

function sourceOf(card: PipelineCard) {
  const s = card.source;
  if (!s) return { text: "Direct or unknown", title: "No tracked visit before they became a lead", platform: null };
  const text = s.campaign ?? channelLabel(s.channel);
  const parts = [s.platform ? platformLabel(s.platform) : channelLabel(s.channel), s.campaign, s.ad].filter(Boolean);
  return { text, title: `First touch: ${parts.join(" › ")}`, platform: s.platform };
}

type BodyProps = {
  card: PipelineCard;
  stage: Pick<Stage, "kind" | "rotDays">;
  currency: string;
  selected?: boolean;
  selecting?: boolean;
  onToggleSelect?: (id: string, range: boolean) => void;
};

/** The card's content, shared by the board and the drag overlay. */
export function CardBody({ card, stage, currency, selected, selecting, onToggleSelect }: BodyProps) {
  const src = sourceOf(card);
  const rotting = card.rotting;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="relative mt-px shrink-0">
        <UserAvatar id={card.id} name={card.label} email={card.label} size="sm" className={cn(onToggleSelect && "transition-opacity duration-100", (selecting || selected) && onToggleSelect && "opacity-0", onToggleSelect && "group-hover/card:opacity-0 group-focus-within/card:opacity-0")} />
        {onToggleSelect ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${card.label}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(card.id, e.shiftKey);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            className={cn(
              "absolute inset-0 grid place-items-center rounded-full border transition-[opacity,background-color,border-color] duration-100 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              selected ? "border-transparent bg-brand text-ink-foreground opacity-100" : "border-border-strong bg-surface text-transparent",
              !selected && !selecting && "opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100",
            )}
          >
            <CheckIcon aria-hidden className="size-3.5" strokeWidth={2.5} />
          </button>
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <Link
            href={`/contacts/${card.id}`}
            prefetch={false}
            draggable={false}
            className="min-w-0 flex-1 truncate rounded-sm text-ui font-medium text-foreground outline-none hover:underline hover:decoration-border-strong hover:underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {card.label}
          </Link>
          {card.valueMinor !== 0 ? <span className="num shrink-0 text-ui font-medium">{moneyShort(card.valueMinor, currency)}</span> : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
          <span className="flex min-w-0 flex-1 items-center gap-1.5" title={src.title}>
            {src.platform ? (
              <span aria-hidden className="contents">
                <BrandGlyph id={src.platform} className="size-3 shrink-0" />
              </span>
            ) : null}
            <span className="truncate">{src.text}</span>
          </span>
          <span
            className={cn("num inline-flex shrink-0 items-center gap-1", rotting && "font-medium text-negative")}
            title={rotting && stage.rotDays !== null ? `In this stage for ${card.daysInStage} days (it rots after ${stage.rotDays})` : `In this stage for ${card.daysInStage} day${card.daysInStage === 1 ? "" : "s"}`}
          >
            {rotting ? <ClockAlertIcon aria-hidden className="size-3" /> : null}
            {daysLabel(card.daysInStage)}
            {rotting ? <span className="sr-only">, rotting</span> : null}
          </span>
        </div>
      </div>
    </div>
  );
}

export const BoardCard = memo(function BoardCard({
  card,
  stage,
  currency,
  selected,
  selecting,
  canMove,
  dragEnabled,
  dimmed,
  stages,
  onToggleSelect,
  onMove,
}: BodyProps & {
  stage: Stage;
  canMove: boolean;
  /** False on phones: moving happens through the menu there. */
  dragEnabled: boolean;
  /** Being dragged (the overlay shows the lifted copy). */
  dimmed: boolean;
  stages: StageOption[];
  onMove: (ids: string[], stageId: string) => void;
}) {
  const { setNodeRef, setActivatorNodeRef, listeners, attributes } = useDraggable({ id: card.id, data: { stageId: stage.id }, disabled: !canMove || !dragEnabled });
  const draggable = canMove && dragEnabled;
  // Pointer/touch listeners go on the whole card; the keyboard listener only on the handle button.
  const on = (listeners ?? {}) as Partial<{
    onMouseDown: React.MouseEventHandler;
    onTouchStart: React.TouchEventHandler;
    onKeyDown: React.KeyboardEventHandler;
  }>;
  return (
    <li
      ref={setNodeRef}
      data-card-id={card.id}
      onMouseDown={draggable ? on.onMouseDown : undefined}
      onTouchStart={draggable ? on.onTouchStart : undefined}
      onClick={(e) => {
        if ((e.shiftKey || e.metaKey || e.ctrlKey) && onToggleSelect) {
          e.preventDefault();
          onToggleSelect(card.id, e.shiftKey);
        }
      }}
      className={cn(
        "group/card relative list-none rounded-lg bg-surface p-2.5 pr-2 shadow-sm max-md:pr-11 transition-[box-shadow,background-color,opacity] duration-100 [content-visibility:auto] [contain-intrinsic-size:auto_60px]",
        draggable && "cursor-grab touch-manipulation active:cursor-grabbing",
        selected ? "bg-brand-soft shadow-[inset_2px_0_0_var(--brand),var(--elev-sm)]" : "hover:shadow-[0_0_0_1px_var(--border-strong)]",
        dimmed && "opacity-40",
      )}
    >
      <CardBody card={card} stage={stage} currency={currency} selected={selected} selecting={selecting} onToggleSelect={canMove ? onToggleSelect : undefined} />
      {canMove ? (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 has-aria-expanded:opacity-100 max-md:top-1/2 max-md:right-1 max-md:-translate-y-1/2 max-md:opacity-100">
          <StageMenu
            stages={stages}
            current={stage.id}
            onSelect={(to) => onMove([card.id], to)}
            trigger={
              <button
                type="button"
                aria-label={`Move ${card.label}`}
                onMouseDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                className="grid size-6 place-items-center rounded-md bg-surface text-muted-foreground shadow-sm outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:size-9 max-md:shadow-none"
              >
                <MoreHorizontalIcon aria-hidden className="size-4" />
              </button>
            }
          />
          {draggable ? (
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              onKeyDown={on.onKeyDown}
              aria-label={`Drag ${card.label}. Press Space, then the left and right arrows to change stage.`}
              aria-roledescription="draggable contact"
              className="grid size-6 cursor-grab place-items-center rounded-md bg-surface text-muted-foreground shadow-sm outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <GripVerticalIcon aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
});
