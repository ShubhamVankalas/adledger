"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GripVerticalIcon, PlusIcon, XIcon } from "lucide-react";
import { COLUMN_BY_KEY, COLUMNS, type ColumnDef, type ColumnKey } from "./columns";
import { cn } from "@/lib/utils";

// Column chooser inside the Display popover: drag (or Space + arrow keys) to reorder the visible
// columns, × to hide one, + to add a hidden one. Loaded on demand so @dnd-kit only ships to people
// who customise the table.

const labelOf = (id: unknown) => COLUMN_BY_KEY.get(String(id) as ColumnKey)?.label ?? "Column";

const announcements: Announcements = {
  onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
  onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)} is over ${labelOf(over.id)}.` : `${labelOf(active.id)} is no longer over a column.`),
  onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)} dropped in place of ${labelOf(over.id)}.` : `${labelOf(active.id)} dropped.`),
  onDragCancel: ({ active }) => `Moving ${labelOf(active.id)} was cancelled.`,
};

export default function ColumnChooser({ columns, onChange }: { columns: ColumnKey[]; onChange: (cols: ColumnKey[]) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const hidden = COLUMNS.filter((c) => !columns.includes(c.key));
  const groups = [...new Set(hidden.map((c) => c.group))];

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = columns.indexOf(active.id as ColumnKey);
    const to = columns.indexOf(over.id as ColumnKey);
    if (from !== -1 && to !== -1) onChange(arrayMove(columns, from, to));
  };

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={{ announcements }}>
        <SortableContext items={columns} strategy={verticalListSortingStrategy}>
          <ul aria-label="Visible columns" className="space-y-0.5">
            {columns.map((k) => (
              <SortableColumn key={k} col={COLUMN_BY_KEY.get(k)!} canHide={columns.length > 1} onHide={() => onChange(columns.filter((c) => c !== k))} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {hidden.length ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-caption text-muted-foreground">Add a column</p>
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1 text-micro font-medium tracking-[0.04em] text-fg-faint uppercase">{g}</p>
              <ul className="flex flex-wrap gap-1">
                {hidden
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <li key={c.key}>
                      <button
                        type="button"
                        title={c.hint}
                        onClick={() => onChange([...columns, c.key])}
                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-surface pr-2 pl-1.5 text-ui outline-none transition-colors duration-100 hover:border-border-strong hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
                      >
                        <PlusIcon aria-hidden className="size-3.5 text-muted-foreground" />
                        {c.label}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SortableColumn({ col, canHide, onHide }: { col: ColumnDef; canHide: boolean; onHide: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: col.key });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      className={cn(
        "group/col flex h-8 items-center gap-1 rounded-md bg-popover pr-1 text-ui",
        isDragging ? "relative z-10 shadow-md ring-1 ring-border select-none" : "hover:bg-fill",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${col.label}`}
        className="flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-fg-faint outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      <span className="min-w-0 flex-1 truncate" title={col.hint}>
        {col.label}
      </span>
      <button
        type="button"
        onClick={onHide}
        disabled={!canHide}
        aria-label={`Hide ${col.label}`}
        className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint opacity-0 outline-none transition-opacity duration-100 group-hover/col:opacity-100 pointer-coarse:opacity-100 hover:bg-fill-hover hover:text-foreground focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring disabled:hidden"
      >
        <XIcon className="size-3.5" />
      </button>
    </li>
  );
}
