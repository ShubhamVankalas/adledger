import type { CSSProperties } from "react";
import type { StageColor } from "@/lib/pipeline-shared";

// Stage swatches. Colour is identity here, not money, so it only ever appears as a small dot
// (column headers, funnel rows, the stage menu). Hue and chroma feed one oklch() per theme.

const SWATCH: Record<StageColor, { h: number; c: number; label: string }> = {
  slate: { h: 250, c: 0.03, label: "Slate" },
  blue: { h: 252, c: 0.13, label: "Blue" },
  violet: { h: 292, c: 0.13, label: "Violet" },
  amber: { h: 72, c: 0.14, label: "Amber" },
  emerald: { h: 160, c: 0.13, label: "Green" },
  rose: { h: 18, c: 0.15, label: "Red" },
  cyan: { h: 212, c: 0.1, label: "Cyan" },
};

export const stageSwatchLabel = (c: StageColor) => SWATCH[c].label;

/** Inline variables for {@link STAGE_DOT}. */
export function stageStyle(color: StageColor): CSSProperties {
  const s = SWATCH[color] ?? SWATCH.slate;
  return { "--stage-h": s.h, "--stage-c": s.c } as CSSProperties;
}

/** Background in the stage colour, readable in both themes. Pair with {@link stageStyle}. */
export const STAGE_DOT = "bg-[oklch(0.62_var(--stage-c)_var(--stage-h))] dark:bg-[oklch(0.74_var(--stage-c)_var(--stage-h))]";
