import type { WidgetHeight } from "@/lib/widgets/catalog";

// Shared class strings for the Overview (plain module: usable from server and client components).

/** Fixed heights so rows align and nothing jumps between loading, empty, error and data. */
export const HEIGHT_CLASS: Record<WidgetHeight, string> = {
  kpi: "h-24 md:h-[124px]",
  card: "h-[380px]",
  tall: "h-[520px]",
};

/** Flat card on the canvas with a 7% hairline; shadows are for floating layers only. */
export const SURFACE =
  "bg-card text-card-foreground ring-1 ring-foreground/[0.07] shadow-[0_1px_2px_oklch(0.2_0.02_165/0.04)] dark:shadow-none dark:ring-foreground/[0.08]";
