"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { GripVerticalIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { addStageAction, deleteStageAction, saveStagesAction } from "@/app/actions/pipeline";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { num } from "@/lib/format";
import { MAX_STAGES, STAGE_COLORS, type Stage, type StageColor, type StageKind } from "@/lib/pipeline-shared";
import { cn } from "@/lib/utils";
import { STAGE_DOT, stageStyle, stageSwatchLabel } from "./stage-color";

// Pipeline stage settings: rename, recolour, reorder (drag or keyboard), set type, win probability
// and rotting limit, then save the whole list at once. Adding and deleting are separate, immediate
// actions (deleting asks where the stage's contacts should go).

type Draft = Pick<Stage, "id" | "name" | "kind" | "color" | "rotDays" | "probability">;

const KIND_LABEL: Record<StageKind, string> = { open: "Open", won: "Won", lost: "Lost" };
const GRID = "sm:grid sm:grid-cols-[1.75rem_1.75rem_minmax(0,1fr)_7rem_6rem_7rem_5.5rem_2rem] sm:items-center sm:gap-2";

const toDraft = (s: Stage): Draft => ({ id: s.id, name: s.name, kind: s.kind, color: s.color, rotDays: s.rotDays, probability: s.probability });
const sameDraft = (a: Draft[], b: Draft[]) => JSON.stringify(a) === JSON.stringify(b);

function problems(rows: Draft[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const r of rows) {
    const key = r.name.trim().toLowerCase();
    if (!key) out.set(r.id, "Give this stage a name.");
    else if (r.name.trim().length > 40) out.set(r.id, "Keep it under 40 characters.");
    else if (seen.has(key)) out.set(r.id, "Another stage already has this name.");
    else seen.set(key, r.id);
    if (r.kind === "open") {
      if (!Number.isInteger(r.probability) || r.probability < 0 || r.probability > 100) out.set(r.id, "Win probability is between 0 and 100 %.");
      if (r.rotDays !== null && (!Number.isInteger(r.rotDays) || r.rotDays < 1 || r.rotDays > 365)) out.set(r.id, "Rotting starts after 1 to 365 days.");
    }
  }
  return out;
}

function setProblem(rows: Draft[]): string | null {
  if (!rows.some((r) => r.kind === "open")) return "Keep at least one open stage: new leads start there.";
  if (!rows.some((r) => r.kind === "won")) return "Keep at least one won stage: payments move contacts there.";
  return null;
}

export function StagesEditor({ stages, counts }: { stages: Stage[]; counts: Record<string, number> }) {
  const initial = useMemo(() => stages.map(toDraft), [stages]);
  const [rows, setRows] = useState<Draft[]>(initial);
  const [saving, startSaving] = useTransition();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Draft | null>(null);
  const dirty = !sameDraft(rows, initial);
  const errors = problems(rows);
  const setError = setProblem(rows);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const patch = (id: string, p: Partial<Draft>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...p };
        // Won is always 100 %, lost 0 %, and neither rots (the server applies the same rule).
        if (p.kind === "won") return { ...next, probability: 100, rotDays: null };
        if (p.kind === "lost") return { ...next, probability: 0, rotDays: null };
        if (p.kind === "open" && r.kind !== "open") return { ...next, probability: 50, rotDays: 7 };
        return next;
      }),
    );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setRows((prev) => arrayMove(prev, prev.findIndex((r) => r.id === active.id), prev.findIndex((r) => r.id === over.id)));
  };

  const save = () =>
    startSaving(async () => {
      const r = await saveStagesAction(rows.map((x) => ({ ...x, name: x.name.trim() })));
      if (r.ok) toast.success(r.message ?? "Stages saved.");
      else toast.error(r.message ?? "Could not save the stages. Try again.");
    });

  const titleOf = (r: Draft) => r.name.trim() || "this stage";
  const canDelete = (r: Draft) => setProblem(rows.filter((x) => x.id !== r.id)) === null;

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl bg-card shadow-(--elev-card)">
        <div aria-hidden className={cn("hidden border-b bg-bg-subtle px-3 py-2 text-caption font-medium text-muted-foreground", GRID)}>
          <span />
          <span />
          <span>Stage</span>
          <span>Type</span>
          <span>Win chance</span>
          <span>Rots after</span>
          <span className="text-right">Contacts</span>
          <span />
        </div>
        <DndContext
          id="pipeline-stages"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
          accessibility={{
            screenReaderInstructions: { draggable: "To reorder a stage, press Space or Enter on its handle, move it with the up and down arrows, then press Space or Enter to drop it." },
            announcements: {
              onDragStart: ({ active }) => `Picked up ${rows.find((r) => r.id === active.id)?.name || "stage"}.`,
              onDragOver: ({ active, over }) => (over ? `${rows.find((r) => r.id === active.id)?.name || "Stage"} is now at position ${rows.findIndex((r) => r.id === over.id) + 1} of ${rows.length}.` : undefined),
              onDragEnd: ({ active, over }) => (over ? `${rows.find((r) => r.id === active.id)?.name || "Stage"} dropped at position ${rows.findIndex((r) => r.id === over.id) + 1}.` : "Dropped."),
              onDragCancel: () => "Reordering cancelled.",
            },
          }}
        >
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <ol className="divide-y">
              {rows.map((r, i) => (
                <StageRow
                  key={r.id}
                  row={r}
                  index={i}
                  count={counts[r.id] ?? 0}
                  error={errors.get(r.id)}
                  onChange={(p) => patch(r.id, p)}
                  onDelete={() => setDeleting(r)}
                  deleteDisabled={dirty ? "Save or discard your changes first." : !canDelete(r) ? `Keep at least one ${r.kind} stage.` : null}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAdding(true)}
            disabled={dirty || rows.length >= MAX_STAGES}
            title={dirty ? "Save or discard your changes first." : rows.length >= MAX_STAGES ? `A pipeline can have at most ${MAX_STAGES} stages.` : undefined}
          >
            <PlusIcon /> Add stage
          </Button>
          {setError ? (
            <p role="alert" className="text-caption text-destructive">
              {setError}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "sticky bottom-[calc(1rem+env(safe-area-inset-bottom))] z-20 flex items-center justify-between gap-3 rounded-xl bg-ink py-2 pr-2 pl-4 text-ui text-ink-foreground shadow-lg transition-[opacity,translate] duration-200 ease-out max-md:bottom-[calc(5.5rem+env(safe-area-inset-bottom))]",
          dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0",
        )}
        aria-hidden={!dirty}
      >
        <span>You have unsaved changes</span>
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" className="text-ink-foreground hover:bg-ink-foreground/12" onClick={() => setRows(initial)} disabled={saving} tabIndex={dirty ? 0 : -1}>
            Discard
          </Button>
          <Button
            size="sm"
            className="bg-ink-foreground text-ink hover:bg-ink-foreground/90"
            onClick={save}
            disabled={saving || errors.size > 0 || Boolean(setError)}
            tabIndex={dirty ? 0 : -1}
          >
            {saving ? <Loader2Icon className="animate-spin" /> : null}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      <AddStageDialog open={adding} onOpenChange={setAdding} taken={rows.map((r) => r.name.trim().toLowerCase())} />
      <DeleteStageDialog stage={deleting} rows={rows} count={deleting ? (counts[deleting.id] ?? 0) : 0} onClose={() => setDeleting(null)} titleOf={titleOf} />
    </div>
  );
}

function StageRow({
  row,
  index,
  count,
  error,
  onChange,
  onDelete,
  deleteDisabled,
}: {
  row: Draft;
  index: number;
  count: number;
  error?: string;
  onChange: (p: Partial<Draft>) => void;
  onDelete: () => void;
  deleteDisabled: string | null;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const id = useId();
  const open = row.kind === "open";
  return (
    <li
      ref={setNodeRef}
      style={{ transform: transform ? `translate3d(0, ${Math.round(transform.y)}px, 0)` : undefined, transition }}
      className={cn("relative bg-card px-3 py-2.5", isDragging && "z-10 shadow-lg")}
    >
      <div className={cn("grid grid-cols-[1.75rem_1.75rem_minmax(0,1fr)_2rem] items-center gap-2", GRID)}>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${row.name || "stage"}, position ${index + 1}`}
          className="grid size-7 cursor-grab touch-none place-items-center rounded-md text-fg-faint outline-none hover:bg-fill-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
        >
          <GripVerticalIcon aria-hidden className="size-4" />
        </button>
        <ColorPicker value={row.color} onChange={(color) => onChange({ color })} name={row.name} />
        <div className="min-w-0">
          <Input
            id={`${id}-name`}
            aria-label="Stage name"
            value={row.name}
            maxLength={60}
            autoComplete="off"
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? `${id}-err` : undefined}
            onChange={(e) => onChange({ name: e.target.value })}
            className="h-8"
          />
        </div>
        <div className="col-span-4 col-start-1 row-start-2 grid grid-cols-3 gap-2 sm:contents">
          <label className="grid gap-1 sm:block">
            <span className="text-caption text-muted-foreground sm:sr-only">Type</span>
            <NativeSelect value={row.kind} onChange={(e) => onChange({ kind: e.target.value as StageKind })} aria-label="Stage type" className="[&_select]:h-8 [&_select]:text-ui">
              {(["open", "won", "lost"] as const).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 sm:block">
            <span className="text-caption text-muted-foreground sm:sr-only">Win chance</span>
            <span className="relative block">
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={5}
                aria-label="Win probability in percent"
                disabled={!open}
                value={row.probability}
                onChange={(e) => onChange({ probability: e.target.value === "" ? 0 : Math.round(Number(e.target.value)) })}
                className="num h-8 pr-7"
              />
              <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ui text-muted-foreground">%</span>
            </span>
          </label>
          <label className="grid gap-1 sm:block">
            <span className="text-caption text-muted-foreground sm:sr-only">Rots after</span>
            <span className="relative block">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                aria-label="Days before an open contact is rotting (empty for never)"
                placeholder={open ? "Never" : "n/a"}
                disabled={!open}
                value={row.rotDays ?? ""}
                onChange={(e) => onChange({ rotDays: e.target.value === "" ? null : Math.round(Number(e.target.value)) })}
                className="num h-8 pr-11"
              />
              {row.rotDays !== null ? <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-ui text-muted-foreground">days</span> : null}
            </span>
          </label>
        </div>
        <span className="num hidden text-right text-ui text-muted-foreground sm:block">{num(count)}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={Boolean(deleteDisabled)}
          title={deleteDisabled ?? `Delete ${row.name || "stage"}`}
          aria-label={`Delete ${row.name || "stage"}`}
          className="col-start-4 row-start-1 text-muted-foreground hover:text-destructive sm:col-start-auto sm:row-start-auto"
        >
          <Trash2Icon />
        </Button>
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1.5 text-caption text-destructive sm:pl-[4.5rem]">
          {error}
        </p>
      ) : null}
    </li>
  );
}

function ColorPicker({ value, onChange, name }: { value: StageColor; onChange: (c: StageColor) => void; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Colour of ${name || "stage"}: ${stageSwatchLabel(value)}`}
            className="grid size-7 place-items-center rounded-md outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-ring"
          />
        }
      >
        <span aria-hidden style={stageStyle(value)} className={cn("size-3 rounded-full", STAGE_DOT)} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div role="radiogroup" aria-label="Stage colour" className="flex gap-1">
          {STAGE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === value}
              aria-label={stageSwatchLabel(c)}
              title={stageSwatchLabel(c)}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className={cn(
                "grid size-7 place-items-center rounded-md outline-none hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-ring",
                c === value && "bg-fill-active",
              )}
            >
              <span aria-hidden style={stageStyle(c)} className={cn("size-3.5 rounded-full", STAGE_DOT)} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddStageDialog({ open, onOpenChange, taken }: { open: boolean; onOpenChange: (o: boolean) => void; taken: string[] }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<StageKind>("open");
  const [color, setColor] = useState<StageColor>("cyan");
  const [pending, start] = useTransition();
  const [touched, setTouched] = useState(false);
  const key = name.trim().toLowerCase();
  const error = !key ? "Give the stage a name." : key.length > 40 ? "Keep it under 40 characters." : taken.includes(key) ? "Another stage already has this name." : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (error) return;
    start(async () => {
      const r = await addStageAction({ name: name.trim(), kind, color, rotDays: kind === "open" ? 7 : null, probability: kind === "open" ? 50 : kind === "won" ? 100 : 0 });
      if (!r.ok) {
        toast.error(r.message ?? "Could not add the stage.");
        return;
      }
      toast.success(r.message ?? "Stage added.");
      setName("");
      setKind("open");
      setTouched(false);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a stage</DialogTitle>
            <DialogDescription>Open stages go before Won, so the board keeps its order. You can move it after.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="new-stage-name">Name</Label>
            <Input
              id="new-stage-name"
              name="stage-name"
              value={name}
              autoComplete="off"
              placeholder="Negotiation…"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={(touched && Boolean(error)) || undefined}
              aria-describedby={touched && error ? "new-stage-error" : undefined}
            />
            {touched && error ? (
              <p id="new-stage-error" className="text-caption text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="new-stage-kind">Type</Label>
              <NativeSelect id="new-stage-kind" value={kind} onChange={(e) => setKind(e.target.value as StageKind)}>
                <option value="open">Open</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <span className="text-ui font-medium">Colour</span>
              <div className="flex h-9 items-center">
                <ColorPicker value={color} onChange={setColor} name={name} />
                <span className="text-ui text-muted-foreground">{stageSwatchLabel(color)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Adding…" : "Add stage"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStageDialog({ stage, rows, count, onClose, titleOf }: { stage: Draft | null; rows: Draft[]; count: number; onClose: () => void; titleOf: (r: Draft) => string }) {
  const others = rows.filter((r) => r.id !== stage?.id);
  // Default target: the stage just before it (or the first open stage).
  const fallback = stage ? (rows[rows.findIndex((r) => r.id === stage.id) - 1] ?? others.find((r) => r.kind === "open") ?? others[0]) : undefined;
  const [target, setTarget] = useState<string>("");
  const [pending, start] = useTransition();
  const to = target && others.some((o) => o.id === target) ? target : (fallback?.id ?? "");

  const confirm = () => {
    if (!stage) return;
    start(async () => {
      const r = await deleteStageAction(stage.id, count > 0 ? to : null);
      if (!r.ok) {
        toast.error(r.message ?? "Could not delete the stage.");
        return;
      }
      toast.success(r.message ?? "Stage deleted.");
      setTarget("");
      onClose();
    });
  };

  return (
    <Dialog open={Boolean(stage)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{stage ? titleOf(stage) : ""}”?</DialogTitle>
          <DialogDescription>
            {count > 0
              ? `${num(count)} contact${count === 1 ? " is" : "s are"} in this stage. Choose where ${count === 1 ? "it goes" : "they go"}; the move is saved in each contact's history.`
              : "Nobody is in this stage. Its past moves stay in contact histories under the old name."}
          </DialogDescription>
        </DialogHeader>
        {count > 0 ? (
          <div className="grid gap-1.5">
            <Label htmlFor="delete-stage-target">Move contacts to</Label>
            <NativeSelect id="delete-stage-target" value={to} onChange={(e) => setTarget(e.target.value)}>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {titleOf(o)}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={confirm} disabled={pending || (count > 0 && !to)}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {pending ? "Deleting…" : count > 0 ? `Move ${num(count)} and delete` : "Delete stage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
