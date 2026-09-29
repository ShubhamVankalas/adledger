"use client";

import { ChevronDownIcon, LayoutGridIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useMemo, useSyncExternalStore, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { PINNED, widgetSig } from "@/lib/dashboard/ops";
import type { Layout, Section, WidgetInstance } from "@/lib/dashboard/types";
import type { MetricKey } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { widgetMeta } from "@/lib/widgets/catalog";
import { useDashboard } from "./dashboard-context";
import { MobileEditList } from "./mobile-edit-list";
import { WidgetFrame, type WidgetNode } from "./widget-frame";

// The Overview board: a pinned KPI strip, then named sections on a 12/6/1-column grid. View mode
// is plain CSS grid; the drag-and-drop board (and @dnd-kit) load only when editing on desktop.

const SortableBoard = dynamic(() => import("./sortable-board").then((m) => m.SortableBoard), {
  ssr: false,
  loading: () => <LoadingEditBoard />,
});

const MOBILE = "(max-width: 767px)";
export function useIsMobile() {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(MOBILE).matches,
    () => false,
  );
}

export type NodeLookup = (item: WidgetInstance) => React.ReactNode | undefined;

/** Server-rendered bodies by instance id, falling back to a body of the same type and settings. */
export function useNodeLookup(nodes: WidgetNode[]): NodeLookup {
  return useMemo(() => {
    const byId = new Map(nodes.map((n) => [n.id, n.node]));
    const bySig = new Map(nodes.map((n) => [n.sig, n.node]));
    return (item) => byId.get(item.id) ?? bySig.get(widgetSig(item));
  }, [nodes]);
}

/** The metric the explorer shows: the clicked tile, else the first explorer's own setting. */
export function useActiveMetric(layout: Layout): { hasExplorer: boolean; active: MetricKey } {
  const { metric } = useDashboard();
  const explorer = layout.sections.flatMap((s) => s.items).find((w) => w.type === "chart.explorer");
  return { hasExplorer: !!explorer, active: metric ?? explorer?.settings?.metric ?? "revenue" };
}

export const PINNED_GRID = "grid grid-cols-2 gap-3 md:grid-cols-[repeat(var(--nm),minmax(0,1fr))] xl:grid-cols-[repeat(var(--n),minmax(0,1fr))]";
export const pinnedStyle = (n: number) => ({ "--n": Math.max(1, n), "--nm": n <= 4 ? Math.max(1, n) : 3 }) as CSSProperties;
export const SECTION_GRID = "grid grid-cols-1 gap-4 md:grid-cols-6 xl:grid-cols-12";

export function Board({ nodes }: { nodes: WidgetNode[] }) {
  const { layout, editing } = useDashboard();
  const lookup = useNodeLookup(nodes);
  const mobile = useIsMobile();
  if (editing) return mobile ? <MobileEditList /> : <SortableBoard lookup={lookup} />;
  return <StaticBoard layout={layout} lookup={lookup} />;
}

function StaticBoard({ layout, lookup }: { layout: Layout; lookup: NodeLookup }) {
  const { hasExplorer, active } = useActiveMetric(layout);
  const sections = layout.sections.filter((s) => s.items.length > 0);
  const frame = (item: WidgetInstance, container: string) => {
    const metric = widgetMeta(item.type)?.metric;
    return <WidgetFrame key={item.id} item={item} container={container} node={lookup(item)} selectable={hasExplorer && !!metric} pressed={hasExplorer && metric === active} />;
  };
  if (layout.pinned.length === 0 && sections.length === 0) return <EmptyBoard />;
  return (
    <div className="flex flex-col gap-7 md:gap-8">
      {layout.pinned.length ? (
        <section aria-label="Pinned metrics" data-tour="kpis" className={PINNED_GRID} style={pinnedStyle(layout.pinned.length)}>
          {layout.pinned.map((w) => frame(w, PINNED))}
        </section>
      ) : null}
      {sections.map((s) => (
        <SectionView key={s.id} section={s}>
          {s.items.map((w) => frame(w, s.id))}
        </SectionView>
      ))}
    </div>
  );
}

function SectionView({ section, children }: { section: Section; children: React.ReactNode }) {
  if (!section.title) return <div data-tour="widgets" className={SECTION_GRID}>{children}</div>;
  return (
    <details open={!section.collapsed} data-tour="widgets" className="group/section">
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md py-1 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <h2 className="text-xs font-medium tracking-[0.04em] text-muted-foreground uppercase">{section.title}</h2>
        <span aria-hidden className="h-px flex-1 bg-border" />
        <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground/70 transition-transform duration-200 group-open/section:rotate-180" />
        <span className="sr-only">Show or hide {section.title}</span>
      </summary>
      <div className={cn(SECTION_GRID, "mt-3")}>{children}</div>
    </details>
  );
}

function EmptyBoard() {
  const { startEditing, resetDraft } = useDashboard();
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-16 text-center">
      <LayoutGridIcon aria-hidden className="size-6 text-muted-foreground/60" />
      <p className="text-sm font-medium">Your board is empty</p>
      <p className="max-w-sm text-[13px] text-pretty text-muted-foreground">Add the numbers and charts you care about, or start from a preset.</p>
      <div className="mt-2 flex gap-2">
        <Button onClick={startEditing}>Customize</Button>
        <Button
          variant="outline"
          onClick={() => {
            startEditing();
            resetDraft("minimal");
          }}
        >
          Use the minimal preset
        </Button>
      </div>
    </div>
  );
}

/** Shown for the moment the drag-and-drop chunk takes to load. */
function LoadingEditBoard() {
  return <div aria-busy className="h-[60vh] animate-pulse rounded-xl bg-foreground/[0.03]" />;
}
