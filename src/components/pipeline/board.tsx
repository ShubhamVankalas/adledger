"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { ChevronsLeftRightIcon, ChevronsRightLeftIcon, ClockAlertIcon, Loader2Icon, XIcon } from "lucide-react";
import { useCallback, useMemo, useOptimistic, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { loadStageCardsAction, moveContactsAction, undoMoveAction } from "@/app/actions/pipeline";
import { Button } from "@/components/ui/button";
import { moneyShort, num } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import { MAX_MOVE, UNDO_WINDOW_MS, type MovedContact, type Stage } from "@/lib/pipeline-shared";
import type { PipelineBoard as BoardData, PipelineCard, PipelineColumn } from "@/lib/reports-pipeline";
import { cn } from "@/lib/utils";
import { BoardCard, CardBody } from "./card";
import { StageDot, StageMenu, type StageOption } from "./stage-menu";

// The kanban. Server data comes in as props; moves are optimistic (useOptimistic) and settle when
// the action's revalidation delivers the new board. Drag with the mouse, a long press on touch
// screens, or the keyboard (focus a card's handle, Space, ← →, Space). Phones show one stage at a
// time with a tab strip and move contacts through the card menu instead of dragging.

type Move = { id: string; to: string };
type LastMove = { toStageId: string; entries: MovedContact[]; at: number; label: string };

const COLLAPSED_KEY = "adledger.pipeline.collapsed";
const colId = (stageId: string) => `col:${stageId}`;
const stageOfCol = (id: UniqueIdentifier | null | undefined) => (typeof id === "string" && id.startsWith("col:") ? id.slice(4) : null);

// ---------------------------------------------------------------- media + storage helpers

const phoneQuery = "(max-width: 767px)";
function subscribePhone(cb: () => void) {
  const m = window.matchMedia(phoneQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
/** True on phones. False during SSR and hydration, so the markup never mismatches. */
function useIsPhone() {
  return useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);
}

// Collapsed columns: a per-browser preference, read through useSyncExternalStore so the server
// render (Lost collapsed) and the first client render agree.
const collapsedListeners = new Set<() => void>();
function subscribeCollapsed(cb: () => void) {
  collapsedListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    collapsedListeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}
function readCollapsedRaw(): string | null {
  try {
    return localStorage.getItem(COLLAPSED_KEY);
  } catch {
    return null;
  }
}
function parseCollapsed(raw: string | null): string[] | null {
  try {
    const v = raw ? JSON.parse(raw) : null;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}
function writeCollapsed(ids: string[]) {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // Private windows: nothing to remember.
  }
  for (const l of collapsedListeners) l();
}

// ---------------------------------------------------------------- optimistic board maths

/** What one card adds to its column's weighted value (same rule as the SQL). */
const weightOf = (card: PipelineCard, stage: Stage, avg: number) => ((card.valueMinor > 0 ? card.valueMinor : avg) * stage.probability) / 100;

function applyMoves(columns: PipelineColumn[], moves: Move[], avg: number): PipelineColumn[] {
  const byId = new Map(moves.map((m) => [m.id, m.to]));
  const moving: { card: PipelineCard; to: string }[] = [];
  const now = new Date().toISOString();
  const next = columns.map((col) => {
    const keep: PipelineCard[] = [];
    let count = col.count;
    let value = col.valueMinor;
    let weighted = col.weightedMinor;
    let rotting = col.rotting;
    for (const c of col.cards) {
      const to = byId.get(c.id);
      if (to && to !== col.id) {
        moving.push({ card: c, to });
        count--;
        value -= c.valueMinor;
        weighted -= weightOf(c, col, avg);
        if (c.rotting) rotting--;
      } else keep.push(c);
    }
    return { ...col, cards: keep, count, valueMinor: value, weightedMinor: Math.round(weighted), rotting };
  });
  return next.map((col) => {
    const incoming = moving.filter((m) => m.to === col.id).map((m) => ({ ...m.card, stageId: col.id, enteredAt: now, daysInStage: 0, rotting: false }));
    if (!incoming.length) return col;
    return {
      ...col,
      cards: [...incoming, ...col.cards],
      count: col.count + incoming.length,
      valueMinor: col.valueMinor + incoming.reduce((s, c) => s + c.valueMinor, 0),
      weightedMinor: Math.round(col.weightedMinor + incoming.reduce((s, c) => s + weightOf(c, col, avg), 0)),
    };
  });
}

// ---------------------------------------------------------------- keyboard dragging

/** ← → jump the lifted card to the centre of the previous / next column. */
const columnCoordinates: KeyboardCoordinateGetter = (event, { context: { active, collisionRect, droppableRects, droppableContainers, over } }) => {
  const dir = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  if (event.code === "ArrowUp" || event.code === "ArrowDown") {
    event.preventDefault();
    return undefined;
  }
  if (!dir || !collisionRect || !active) return undefined;
  event.preventDefault();
  const cols = droppableContainers
    .getEnabled()
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((c): c is { id: UniqueIdentifier; rect: ClientRect } => Boolean(c.rect))
    .sort((a, b) => a.rect.left - b.rect.left);
  const from = over?.id ?? colId(String(active.data.current?.stageId));
  const next = cols[cols.findIndex((c) => c.id === from) + dir];
  if (!next) return undefined;
  return { x: next.rect.left + (next.rect.width - collisionRect.width) / 2, y: next.rect.top + 56 };
};

/** Pointer: the column under the pointer. Keyboard (no pointer): the column the card overlaps most. */
const collision: CollisionDetection = (args) => {
  const hit = pointerWithin(args);
  return hit.length ? hit : rectIntersection(args);
};

// ---------------------------------------------------------------- board

export function PipelineBoard({ board, canMove }: { board: BoardData; canMove: boolean }) {
  const phone = useIsPhone();
  const [extra, setExtra] = useState<Record<string, PipelineCard[]>>({});
  const [loadingMore, setLoadingMore] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mobileStage, setMobileStage] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const lastMove = useRef<LastMove | null>(null);
  const anchor = useRef<string | null>(null);

  const collapsedRaw = useSyncExternalStore(subscribeCollapsed, readCollapsedRaw, () => null);
  const collapsed = useMemo(() => parseCollapsed(collapsedRaw) ?? board.columns.filter((c) => c.kind === "lost").map((c) => c.id), [collapsedRaw, board.columns]);

  // Server columns + cards loaded with "Show more" (a card the server now lists wins).
  const merged = useMemo(() => {
    const listed = new Set(board.columns.flatMap((c) => c.cards.map((x) => x.id)));
    return board.columns.map((c) => ({ ...c, cards: [...c.cards, ...(extra[c.id] ?? []).filter((x) => !listed.has(x.id))] }));
  }, [board.columns, extra]);
  const [columns, addOptimistic] = useOptimistic(merged, (cols: PipelineColumn[], moves: Move[]) => applyMoves(cols, moves, board.avgValueMinor));

  const stages: StageOption[] = useMemo(() => board.columns.map(({ id, name, color, kind }) => ({ id, name, color, kind })), [board.columns]);
  const cardIndex = useMemo(() => {
    const m = new Map<string, { card: PipelineCard; stage: PipelineColumn }>();
    for (const col of columns) for (const card of col.cards) m.set(card.id, { card, stage: col });
    return m;
  }, [columns]);
  const nameOf = useCallback((stageId: string | null) => board.columns.find((c) => c.id === stageId)?.name ?? "a stage", [board.columns]);

  // Drop selections whose cards left the board.
  const visibleSelected = useMemo(() => [...selected].filter((id) => cardIndex.has(id)), [selected, cardIndex]);

  const undo = useCallback(
    (m: LastMove) => {
      if (Date.now() - m.at > UNDO_WINDOW_MS) {
        toast.error("That move can no longer be undone.");
        return;
      }
      if (lastMove.current === m) lastMove.current = null;
      startTransition(async () => {
        addOptimistic(m.entries.map((e) => ({ id: e.contactId, to: e.fromStageId })));
        const r = await undoMoveAction(m.toStageId, m.entries);
        if (!r.ok) toast.error(r.message ?? "That move can no longer be undone.");
        else toast.success(`Moved ${m.label} back.`);
      });
    },
    [addOptimistic],
  );

  const move = useCallback(
    (ids: string[], to: string) => {
      const moving = ids.filter((id) => cardIndex.get(id)?.stage.id !== to).slice(0, MAX_MOVE);
      if (!moving.length) return;
      const label = moving.length === 1 ? (cardIndex.get(moving[0])?.card.label ?? "1 contact") : `${moving.length} contacts`;
      setSelected(new Set());
      startTransition(async () => {
        addOptimistic(moving.map((id) => ({ id, to })));
        const r = await moveContactsAction(moving, to);
        if (!r.ok) {
          toast.error(r.message ?? "Those contacts could not be moved. Try again.");
          return;
        }
        const entries = (r.data?.moved ?? []) as MovedContact[];
        if (!entries.length) return;
        const m: LastMove = { toStageId: to, entries, at: Date.now(), label };
        lastMove.current = m;
        toast(`Moved ${label} to ${String(r.data?.stageName ?? nameOf(to))}`, {
          action: { label: "Undo", onClick: () => undo(m) },
          duration: 8000,
        });
      });
    },
    [cardIndex, addOptimistic, nameOf, undo],
  );

  const toggleSelect = useCallback(
    (id: string, range: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const from = anchor.current ? cardIndex.get(anchor.current) : null;
        const here = cardIndex.get(id);
        // Shift: select the run of cards between the last clicked card and this one, in one column.
        if (range && from && here && from.stage.id === here.stage.id) {
          const list = here.stage.cards.map((c) => c.id);
          const [a, b] = [list.indexOf(anchor.current!), list.indexOf(id)].sort((x, y) => x - y);
          for (const x of list.slice(a, b + 1)) next.add(x);
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      anchor.current = id;
    },
    [cardIndex],
  );

  const loadMore = async (col: PipelineColumn) => {
    setLoadingMore(col.id);
    const r = await loadStageCardsAction(col.id, col.cards.length);
    setLoadingMore(null);
    if (!r.ok) {
      toast.error(r.message ?? "Could not load more contacts.");
      return;
    }
    const cards = (r.data?.cards ?? []) as PipelineCard[];
    setExtra((prev) => ({ ...prev, [col.id]: [...(prev[col.id] ?? []), ...cards] }));
  };

  const toggleCollapsed = (id: string) => writeCollapsed(collapsed.includes(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);

  useHotkeys([
    {
      id: "pipeline.select",
      keys: "x",
      label: "Select the focused contact",
      group: "Pipeline",
      run: () => {
        const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
        if (!id || !canMove) return false;
        toggleSelect(id, false);
      },
    },
    {
      id: "pipeline.clear",
      keys: "escape",
      label: "Clear the selection",
      group: "Pipeline",
      run: () => {
        if (!visibleSelected.length) return false;
        setSelected(new Set());
      },
    },
    {
      id: "pipeline.undo",
      keys: "mod+z",
      label: "Undo the last move",
      group: "Pipeline",
      run: () => {
        const m = lastMove.current;
        if (!m) return false;
        undo(m);
      },
    },
  ]);

  // ---- drag and drop
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  );
  const dragIds = (id: string) => (selected.has(id) ? visibleSelected : [id]);
  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    if (!selected.has(String(e.active.id))) setSelected(new Set());
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const to = stageOfCol(e.over?.id);
    if (to) move(dragIds(String(e.active.id)), to);
  };
  const who = (id: UniqueIdentifier) => {
    const n = selected.has(String(id)) ? visibleSelected.length : 1;
    return n > 1 ? `${n} contacts` : (cardIndex.get(String(id))?.card.label ?? "Contact");
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${who(active.id)} in ${nameOf(String(active.data.current?.stageId))}. Use the left and right arrows to choose a stage, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${who(active.id)} is over ${nameOf(stageOfCol(over.id))}.` : undefined),
    onDragEnd: ({ active, over }) => (over ? `Moved ${who(active.id)} to ${nameOf(stageOfCol(over.id))}.` : `${who(active.id)} was not moved.`),
    onDragCancel: ({ active }) => `Moving ${who(active.id)} was cancelled.`,
  };

  const active = activeId ? cardIndex.get(activeId) : undefined;
  const dragCount = activeId ? dragIds(activeId).length : 0;
  const shownStage = mobileStage && columns.some((c) => c.id === mobileStage) ? mobileStage : (columns.find((c) => c.kind === "open") ?? columns[0])?.id;
  const selecting = visibleSelected.length > 0;
  const collapsedSet = new Set(collapsed);

  return (
    <DndContext
      // A fixed id keeps dnd-kit's aria-describedby ids identical on the server and the client.
      id="pipeline-board"
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable: "To move a contact, press Space or Enter on its handle, use the left and right arrows to pick a stage, then press Space or Enter to drop it. Press Escape to cancel.",
        },
      }}
    >
      {/* Phones: one stage at a time. */}
      <nav aria-label="Stages" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:hidden">
        <div className="flex w-max gap-1 pb-1">
          {columns.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={c.id === shownStage}
              onClick={() => setMobileStage(c.id)}
              className={cn(
                "flex h-9 items-center gap-2 rounded-md px-3 text-ui font-medium whitespace-nowrap text-muted-foreground transition-colors duration-100",
                c.id === shownStage ? "bg-fill-active text-foreground" : "hover:bg-fill-hover",
              )}
            >
              <StageDot color={c.color} />
              {c.name}
              <span className="num text-caption text-muted-foreground">{num(c.count)}</span>
            </button>
          ))}
        </div>
      </nav>

      <div
        role="region"
        aria-label="Pipeline board"
        className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6 [scrollbar-gutter:stable]"
      >
        {columns.map((col) => (
          <Column
            key={col.id}
            col={col}
            currency={board.currency}
            collapsed={collapsedSet.has(col.id) && !phone}
            hiddenOnPhone={col.id !== shownStage}
            onToggleCollapsed={() => toggleCollapsed(col.id)}
            loadingMore={loadingMore === col.id}
            onLoadMore={() => loadMore(col)}
            dragging={Boolean(activeId)}
          >
            {col.cards.map((card) => (
              <BoardCard
                key={card.id}
                card={card}
                stage={col}
                currency={board.currency}
                selected={selected.has(card.id)}
                selecting={selecting}
                canMove={canMove}
                dragEnabled={!phone}
                dimmed={Boolean(activeId) && (activeId === card.id || (selected.has(activeId!) && selected.has(card.id)))}
                stages={stages}
                onToggleSelect={toggleSelect}
                onMove={move}
              />
            ))}
          </Column>
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.23, 1, 0.32, 1)" }}>
        {active ? (
          <div className="relative w-[17rem] rotate-[1.5deg] rounded-lg bg-surface p-2.5 shadow-lg motion-reduce:rotate-0">
            <CardBody card={active.card} stage={active.stage} currency={board.currency} />
            {dragCount > 1 ? (
              <span className="num absolute -top-2 -right-2 grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1.5 text-micro text-ink-foreground">{dragCount}</span>
            ) : null}
          </div>
        ) : null}
      </DragOverlay>

      {canMove && selecting ? (
        <div
          role="toolbar"
          aria-label="Selected contacts"
          className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-xl bg-ink py-1.5 pr-1.5 pl-3.5 text-ui text-ink-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 duration-200 max-md:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]"
        >
          <span className="num pr-1.5 font-medium whitespace-nowrap" aria-live="polite">
            {visibleSelected.length} selected
          </span>
          <StageMenu
            stages={stages}
            current={null}
            align="center"
            label={`Move ${visibleSelected.length} to`}
            onSelect={(to) => move(visibleSelected, to)}
            trigger={
              <Button size="sm" variant="ghost" className="border border-ink-foreground/20 text-ink-foreground hover:bg-ink-foreground/12 aria-expanded:bg-ink-foreground/12">
                Move to…
              </Button>
            }
          />
          <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={() => setSelected(new Set())} className="text-ink-foreground hover:bg-ink-foreground/12">
            <XIcon />
          </Button>
        </div>
      ) : null}
    </DndContext>
  );
}

// ---------------------------------------------------------------- column

function Column({
  col,
  currency,
  collapsed,
  hiddenOnPhone,
  onToggleCollapsed,
  loadingMore,
  onLoadMore,
  dragging,
  children,
}: {
  col: PipelineColumn;
  currency: string;
  collapsed: boolean;
  hiddenOnPhone: boolean;
  onToggleCollapsed: () => void;
  loadingMore: boolean;
  onLoadMore: () => void;
  dragging: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: colId(col.id) });
  const left = col.count - col.cards.length;
  const headingId = `stage-${col.id}`;

  if (collapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-labelledby={headingId}
        className={cn(
          "flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl bg-bg-subtle py-2 transition-[background-color,box-shadow] duration-150 max-md:hidden",
          isOver && "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--brand)]",
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={`Expand ${col.name}`}
          className="grid size-7 place-items-center rounded-md text-muted-foreground outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronsLeftRightIcon aria-hidden className="size-4" />
        </button>
        <StageDot color={col.color} />
        <h2 id={headingId} className="flex items-center gap-2 text-ui font-medium [writing-mode:vertical-rl]">
          {col.name}
          <span className="num text-caption font-normal text-muted-foreground">{num(col.count)}</span>
        </h2>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-labelledby={headingId}
      className={cn(
        "flex w-[17.5rem] shrink-0 snap-start flex-col rounded-xl bg-bg-subtle transition-[background-color,box-shadow] duration-150 max-md:w-full",
        hiddenOnPhone && "max-md:hidden",
        isOver && "bg-brand-soft shadow-[inset_0_0_0_1.5px_var(--brand)]",
      )}
    >
      <header className="flex flex-col gap-0.5 px-3 pt-2.5 pb-2">
        <div className="flex h-7 items-center gap-2">
          <StageDot color={col.color} />
          <h2 id={headingId} className="min-w-0 truncate text-ui font-medium">
            {col.name}
          </h2>
          <span className="num text-caption text-muted-foreground">{num(col.count)}</span>
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={`Collapse ${col.name}`}
            className="ml-auto grid size-7 place-items-center rounded-md text-fg-faint outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:hidden"
          >
            <ChevronsRightLeftIcon aria-hidden className="size-3.5" />
          </button>
        </div>
        <ColumnTotals col={col} currency={currency} />
      </header>
      <ol
        aria-label={`Contacts in ${col.name}`}
        className="flex max-h-[calc(100dvh-17rem)] min-h-24 flex-col gap-1.5 overflow-y-auto overscroll-contain px-2 pb-2 max-md:max-h-none"
      >
        {children}
        {col.count === 0 ? (
          <li
            className={cn(
              "grid min-h-20 list-none place-items-center rounded-lg border border-dashed border-border-strong px-4 text-center text-caption text-muted-foreground transition-colors duration-150",
              dragging && "border-brand/50 text-foreground",
            )}
          >
            {dragging ? "Drop here" : col.kind === "won" ? "Paying customers land here automatically" : "No contacts in this stage"}
          </li>
        ) : null}
        {left > 0 ? (
          <li className="list-none pt-0.5">
            <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2Icon className="animate-spin" /> : null}
              {loadingMore ? "Loading…" : `Show ${num(Math.min(left, 50))} more`}
              {!loadingMore && left > 50 ? <span className="num font-normal text-fg-faint">of {num(left)}</span> : null}
            </Button>
          </li>
        ) : null}
      </ol>
    </section>
  );
}

function ColumnTotals({ col, currency }: { col: PipelineColumn; currency: string }) {
  const parts: React.ReactNode[] = [];
  if (col.kind === "open") {
    parts.push(
      <span key="w" title={`Weighted value: each contact's revenue (or the average customer value) × ${col.probability}% win probability`}>
        <span className="num text-foreground">{moneyShort(col.weightedMinor, currency)}</span> weighted
      </span>,
    );
    if (col.valueMinor > 0) {
      parts.push(
        <span key="v" title="Revenue already received from these contacts">
          <span className="num">{moneyShort(col.valueMinor, currency)}</span> paid
        </span>,
      );
    }
  } else if (col.valueMinor !== 0 || col.kind === "won") {
    parts.push(
      <span key="v" title="Revenue received from these contacts, net of refunds">
        <span className="num text-foreground">{moneyShort(col.valueMinor, currency)}</span> revenue
      </span>,
    );
  }
  return (
    <div className="flex min-h-4 items-center gap-3 pl-4 text-caption text-muted-foreground">
      {parts}
      {col.rotting > 0 ? (
        <span className="ml-auto inline-flex items-center gap-1 font-medium text-warning-foreground" title={`${col.rotting} open longer than ${col.rotDays} days`}>
          <ClockAlertIcon aria-hidden className="size-3" />
          <span className="num">{num(col.rotting)}</span> rotting
        </span>
      ) : null}
    </div>
  );
}
