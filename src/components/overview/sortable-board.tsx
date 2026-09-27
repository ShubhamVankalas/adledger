"use client";

import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { useState } from "react";
import { canDrop, itemsOf, locate, moveItem, PINNED, type ContainerId } from "@/lib/dashboard/ops";
import type { Layout, WidgetInstance } from "@/lib/dashboard/types";
import { MAX_PINNED } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { widgetMeta } from "@/lib/widgets/catalog";
import { PINNED_GRID, pinnedStyle, SECTION_GRID, type NodeLookup } from "./board";
import { useDashboard } from "./dashboard-context";
import { SectionEditHeader } from "./section-edit-header";
import { DragHandle, WidgetFrame } from "./widget-frame";

// Edit mode on desktop: drag widgets within and between sections (and KPI tiles into the pinned
// strip) with the pointer or the keyboard (focus a handle, Space to lift, arrows to move, Space to
// drop, Esc to cancel). Loaded lazily, so @dnd-kit ships only to people who customize.

const titleOf = (layout: Layout, id: UniqueIdentifier) => {
  const at = locate(layout, String(id));
  return at ? (at.item.settings?.title ?? widgetMeta(at.item.type)?.title ?? "Widget") : "Widget";
};
const containerTitle = (layout: Layout, c: ContainerId) => (c === PINNED ? "the pinned strip" : `“${layout.sections.find((s) => s.id === c)?.title || "Untitled section"}”`);

export function SortableBoard({ lookup }: { lookup: NodeLookup }) {
  const { layout, setDraft } = useDashboard();
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (id: UniqueIdentifier): ContainerId | null => {
    const s = String(id);
    if (s === PINNED || layout.sections.some((x) => x.id === s)) return s;
    return locate(layout, s)?.container ?? null;
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  // Crossing into another container moves the item there immediately, so the grid makes room.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = containerOf(active.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    setDraft((l) => {
      const at = locate(l, String(active.id));
      if (!at || !canDrop(l, at.item, to)) return l;
      const target = itemsOf(l, to);
      const overIndex = target.findIndex((w) => w.id === String(over.id));
      return moveItem(l, String(active.id), to, overIndex === -1 ? target.length : overIndex);
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;
    const to = containerOf(over.id);
    if (!to) return;
    setDraft((l) => {
      const target = itemsOf(l, to);
      const overIndex = target.findIndex((w) => w.id === String(over.id));
      const at = locate(l, String(active.id));
      if (!at || at.container !== to || overIndex === -1 || overIndex === at.index) return l;
      return moveItem(l, String(active.id), to, overIndex);
    });
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(layout, active.id)}. Use the arrow keys to move it, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(layout, active.id)} is over ${containerTitle(layout, containerOf(over.id) ?? PINNED)}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Dropped ${titleOf(layout, active.id)} in ${containerTitle(layout, containerOf(over.id) ?? PINNED)}.` : `Dropped ${titleOf(layout, active.id)}.`),
    onDragCancel: ({ active }) => `Moving ${titleOf(layout, active.id)} was cancelled.`,
  };

  const activeItem = activeId ? locate(layout, activeId)?.item : undefined;
  const pinnedFull = layout.pinned.length >= MAX_PINNED;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: "To move a widget, press Space or Enter, then use the arrow keys. Press Space or Enter again to drop it, or Escape to cancel." },
      }}
    >
      <div className="flex flex-col gap-7 md:gap-8">
        <section aria-label="Pinned metrics" className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <h2 className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">Pinned</h2>
            <span className="text-xs text-muted-foreground/80 tabular-nums">
              {layout.pinned.length} of {MAX_PINNED}
            </span>
            <span aria-hidden className="h-px flex-1 bg-border" />
          </div>
          <Container
            id={PINNED}
            items={layout.pinned}
            className={PINNED_GRID}
            style={pinnedStyle(Math.max(layout.pinned.length, 1))}
            empty="Drag number tiles here to pin them to the top."
            highlight={!!activeItem && widgetMeta(activeItem.type)?.category === "kpi" && !pinnedFull}
          >
            {layout.pinned.map((w) => (
              <SortableItem key={w.id} item={w} container={PINNED} lookup={lookup} />
            ))}
          </Container>
        </section>

        {layout.sections.map((s, i) => (
          <section key={s.id} aria-label={s.title || "Untitled section"} className="flex flex-col gap-3">
            <SectionEditHeader section={s} index={i} count={layout.sections.length} />
            <Container id={s.id} items={s.items} className={SECTION_GRID} empty="Empty section. Drag widgets here or add one." highlight={!!activeItem}>
              {s.items.map((w) => (
                <SortableItem key={w.id} item={w} container={s.id} lookup={lookup} />
              ))}
            </Container>
          </section>
        ))}
      </div>
    </DndContext>
  );
}

function Container({
  id,
  items,
  className,
  style,
  empty,
  highlight,
  children,
}: {
  id: ContainerId;
  items: WidgetInstance[];
  className: string;
  style?: React.CSSProperties;
  empty: string;
  highlight: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext id={id} items={items.map((w) => w.id)} strategy={rectSortingStrategy}>
      <div
        ref={setNodeRef}
        style={style}
        className={cn(className, "min-h-24 rounded-xl transition-[background-color] duration-150", highlight && isOver && "bg-foreground/[0.025]")}
      >
        {children}
        {items.length === 0 ? (
          <p className="col-span-full grid min-h-24 place-items-center rounded-xl border border-dashed px-4 text-center text-[13px] text-muted-foreground">{empty}</p>
        ) : null}
      </div>
    </SortableContext>
  );
}

function SortableItem({ item, container, lookup }: { item: WidgetInstance; container: ContainerId; lookup: NodeLookup }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const title = item.settings?.title ?? widgetMeta(item.type)?.title ?? "Widget";
  return (
    <WidgetFrame
      ref={setNodeRef}
      item={item}
      container={container}
      node={lookup(item)}
      dragging={isDragging}
      style={{ transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      handle={<DragHandle ref={setActivatorNodeRef} title={title} {...attributes} {...listeners} />}
    />
  );
}
