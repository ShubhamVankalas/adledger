"use client";

import { ArrowDownIcon, ArrowUpIcon, BlocksIcon, GripVerticalIcon, Maximize2Icon, PinIcon, PinOffIcon, XIcon } from "lucide-react";
import type { CSSProperties, ReactNode, Ref } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { moveItemBy, PINNED, removeItem, setItemSize, type ContainerId } from "@/lib/dashboard/ops";
import type { WidgetInstance } from "@/lib/dashboard/types";
import { METRICS } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { SIZE_LABELS, SIZE_SPAN, widgetMeta, type WidgetHeight, type WidgetSize } from "@/lib/widgets/catalog";
import { useDashboard } from "./dashboard-context";
import { HEIGHT_CLASS, SURFACE } from "./styles";

/** A server-rendered widget body, keyed by instance id (and by type + settings for reuse). */
export type WidgetNode = { id: string; type: string; sig: string; node: ReactNode };

const toolButton =
  "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-9";

export function WidgetFrame({
  item,
  container,
  node,
  ref,
  style,
  className,
  handle,
  dragging,
  selectable,
  pressed,
}: {
  item: WidgetInstance;
  container: ContainerId;
  node: ReactNode | undefined;
  ref?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  className?: string;
  /** Drag handle from the sortable board (edit mode, desktop). */
  handle?: ReactNode;
  dragging?: boolean;
  /** KPI tiles: clicking charts the metric in the Metric explorer. */
  selectable?: boolean;
  pressed?: boolean;
}) {
  const { editing, setDraft, togglePinned } = useDashboard();
  const meta = widgetMeta(item.type);
  const isKpi = meta?.category === "kpi";
  const height: WidgetHeight = meta?.height ?? "card";
  const title = item.settings?.title ?? meta?.title ?? "Widget";
  const metric = meta?.metric ? METRICS[meta.metric] : null;
  const { selectMetric } = useDashboard();

  return (
    <div
      ref={ref}
      style={style}
      data-widget-type={item.type}
      data-widget-id={item.id}
      className={cn(
        "group/widget relative min-w-0 overflow-hidden",
        SURFACE,
        isKpi ? "rounded-lg" : "rounded-xl",
        HEIGHT_CLASS[height],
        // Phones stack one column: lists take their natural height instead of a fixed box.
        meta && ["list", "crm", "utility"].includes(meta.category) && !editing && "max-md:h-auto max-md:min-h-52",
        container !== PINNED && SIZE_SPAN[item.size],
        editing && "outline outline-1 outline-offset-[3px] outline-dashed outline-foreground/20",
        dragging && "z-30 opacity-90 shadow-[0_8px_16px_-4px_oklch(0.2_0.02_165/0.08),0_24px_40px_-8px_oklch(0.2_0.02_165/0.14)] outline-transparent",
        pressed && !editing && "ring-[1.5px] ring-[color:var(--chart-revenue,var(--chart-1))] dark:ring-[color:var(--chart-revenue,var(--chart-1))]",
        className,
      )}
    >
      {selectable && metric && !editing ? (
        <button
          type="button"
          aria-pressed={pressed}
          aria-label={`Chart ${metric.label.toLowerCase()} in the metric explorer`}
          onClick={() => selectMetric(metric.key)}
          className="absolute inset-0 rounded-[inherit] transition-colors hover:bg-foreground/[0.02] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        />
      ) : null}

      <div className={cn("h-full", editing && "pointer-events-none select-none")} inert={editing || undefined}>
        {node ?? (meta ? <PendingWidget title={title} description={meta.description} compact={isKpi} /> : <UnavailableWidget type={item.type} compact={isKpi} />)}
      </div>

      {isKpi && !editing ? (
        <button
          type="button"
          onClick={() => togglePinned(item.type)}
          aria-label={container === PINNED ? `Unpin ${title}` : `Pin ${title} to the top strip`}
          title={container === PINNED ? "Unpin" : "Pin to the top"}
          className={cn(
            toolButton,
            "absolute top-2 right-2 z-20 size-6 opacity-0 group-focus-within/widget:opacity-100 group-hover/widget:opacity-100 pointer-coarse:hidden",
          )}
        >
          {container === PINNED ? <PinOffIcon aria-hidden className="size-3.5" /> : <PinIcon aria-hidden className="size-3.5" />}
        </button>
      ) : null}

      {editing ? (
        <div className="absolute top-2 right-2 z-20 flex items-center gap-0.5 rounded-lg bg-popover p-0.5 shadow-md ring-1 ring-foreground/10">
          {handle}
          {meta && !isKpi && meta.allowedSizes.length > 1 ? (
            <SizeMenu item={item} title={title} allowed={meta.allowedSizes} onChange={(size) => setDraft((l) => setItemSize(l, item.id, size))} />
          ) : null}
          <button type="button" className={cn(toolButton, "md:hidden")} aria-label={`Move ${title} up`} onClick={() => setDraft((l) => moveItemBy(l, item.id, -1))}>
            <ArrowUpIcon aria-hidden className="size-3.5" />
          </button>
          <button type="button" className={toolButton} aria-label={`Remove ${title}`} title="Remove" onClick={() => setDraft((l) => removeItem(l, item.id))}>
            <XIcon aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SizeMenu({ item, title, allowed, onChange }: { item: WidgetInstance; title: string; allowed: readonly WidgetSize[]; onChange: (s: WidgetSize) => void }) {
  const { setDraft } = useDashboard();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className={toolButton} aria-label={`Size and position of ${title}`} title="Size" />}>
        <Maximize2Icon aria-hidden className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Size</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={item.size} onValueChange={(v) => onChange(v as WidgetSize)}>
          {allowed.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {SIZE_LABELS[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setDraft((l) => moveItemBy(l, item.id, -1))}>
          <ArrowUpIcon aria-hidden /> Move earlier
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setDraft((l) => moveItemBy(l, item.id, 1))}>
          <ArrowDownIcon aria-hidden /> Move later
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Drag handle button (receives dnd-kit's listeners and attributes). */
export function DragHandle({ title, ref, ...props }: React.ComponentProps<"button"> & { title: string }) {
  return (
    <button ref={ref} type="button" className={cn(toolButton, "cursor-grab touch-none active:cursor-grabbing")} aria-label={`Drag to move ${title}`} {...props}>
      <GripVerticalIcon aria-hidden className="size-3.5" />
    </button>
  );
}

/** Added in edit mode: the body renders on the server once the layout is saved. */
function PendingWidget({ title, description, compact }: { title: string; description: string; compact?: boolean }) {
  return (
    <div className={cn("flex h-full flex-col justify-center gap-1 px-4", !compact && "items-center px-8 text-center")}>
      {!compact ? <BlocksIcon aria-hidden className="mb-1 size-5 text-muted-foreground/70" /> : null}
      <p className="truncate text-[13px] font-medium">{title}</p>
      <p className={cn("text-xs text-muted-foreground", compact ? "truncate" : "max-w-xs text-pretty")}>{compact ? "Save to load" : `${description} Save the layout to load it.`}</p>
    </div>
  );
}

/** A widget type this version doesn't know (saved by a newer version, or removed). */
export function UnavailableWidget({ type, compact }: { type: string; compact?: boolean }) {
  return (
    <div className={cn("flex h-full flex-col justify-center gap-1 px-4", !compact && "items-center px-8 text-center")}>
      <p className="text-[13px] font-medium">Widget unavailable</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-mono" translate="no">
          {type}
        </span>{" "}
        {compact ? null : "isn’t available in this version. Remove it in Customize."}
      </p>
    </div>
  );
}
