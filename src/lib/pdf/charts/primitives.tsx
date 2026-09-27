import { G, Line, Text as PdfText } from "@react-pdf/renderer";
import type { ComponentProps, ReactNode } from "react";
import { FONT_FAMILY } from "../fonts";
import { safeText } from "../format";
import { PDF_COLORS, TYPE } from "../theme";
import { labelIndexes, r2, type Ticks } from "./scale";

// Shared drawing helpers for the chart kit. Charts are react-pdf <Svg> trees built only from
// numbers and theme colours; labels are passed through safeText() and rendered as SVG text
// content (never as attributes), so data can't change what gets drawn.

type PdfTextProps = ComponentProps<typeof PdfText>;

/** Approximate advance width of a label in Geist at `size` pt (tabular digits ≈ 0.6 em). */
export const textWidth = (s: string, size: number) => s.length * size * 0.56;

export function SvgText({
  x,
  y,
  children,
  size = TYPE.micro,
  color = PDF_COLORS.fgFaint,
  anchor = "start",
  weight = 400,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  color?: string;
  anchor?: "start" | "middle" | "end";
  weight?: 400 | 500 | 600;
}) {
  // react-pdf reads font properties from SVG text props (they are inherited like fill), but its
  // typings only list presentation attributes, hence the cast.
  const props = {
    x: r2(x),
    y: r2(y),
    fill: color,
    textAnchor: anchor,
    fontFamily: FONT_FAMILY,
    fontSize: size,
    fontWeight: weight,
    fontFeatureSettings: { tnum: true, liga: false },
  } as unknown as PdfTextProps;
  return <PdfText {...props}>{typeof children === "string" || typeof children === "number" ? safeText(children, 60) : children}</PdfText>;
}

/** Horizontal gridlines + left tick labels for a y axis. */
export function YGrid({ ticks, y, x0, x1, format, labels = true }: { ticks: Ticks; y: (v: number) => number; x0: number; x1: number; format: (v: number) => string; labels?: boolean }) {
  return (
    <G>
      {ticks.ticks.map((t) => (
        <G key={t}>
          <Line x1={r2(x0)} x2={r2(x1)} y1={r2(y(t))} y2={r2(y(t))} stroke={t === 0 ? PDF_COLORS.borderStrong : PDF_COLORS.grid} strokeWidth={0.5} />
          {labels ? (
            <SvgText x={x0 - 4} y={y(t) + TYPE.micro * 0.34} anchor="end">
              {format(t)}
            </SvgText>
          ) : null}
        </G>
      ))}
    </G>
  );
}

/** Category labels under an x axis (thinned to `max` so they never collide). */
export function XLabels({ labels, x, y, max = 8 }: { labels: string[]; x: (i: number) => number; y: number; max?: number }) {
  const idx = labelIndexes(labels.length, max);
  return (
    <G>
      {idx.map((i) => (
        <SvgText key={i} x={x(i)} y={y} anchor={idx.length > 1 && i === 0 ? "start" : idx.length > 1 && i === labels.length - 1 ? "end" : "middle"}>
          {labels[i]}
        </SvgText>
      ))}
    </G>
  );
}

/** Width the y-axis labels need. */
export function axisWidth(ticks: Ticks, format: (v: number) => string) {
  return Math.ceil(Math.max(...ticks.ticks.map((t) => textWidth(format(t), TYPE.micro)))) + 6;
}

/** SVG path through points (null values break the line). */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (!p) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${r2(p.x)} ${r2(p.y)} `;
    pen = true;
  }
  return d.trim();
}

/** Closed area under a line down to `baseY` (contiguous points only). */
export function areaPath(points: { x: number; y: number }[], baseY: number): string {
  if (points.length < 2) return "";
  const top = points.map((p, i) => `${i ? "L" : "M"}${r2(p.x)} ${r2(p.y)}`).join(" ");
  return `${top} L${r2(points[points.length - 1].x)} ${r2(baseY)} L${r2(points[0].x)} ${r2(baseY)} Z`;
}

/** Donut/arc segment path between angles a0 → a1 (radians, 0 = 12 o'clock, clockwise). */
export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const sweep = Math.min(a1 - a0, Math.PI * 2 - 1e-4);
  const end = a0 + sweep;
  const pt = (r: number, a: number) => `${r2(cx + r * Math.sin(a))} ${r2(cy - r * Math.cos(a))}`;
  const large = sweep > Math.PI ? 1 : 0;
  return [`M${pt(rOuter, a0)}`, `A${r2(rOuter)} ${r2(rOuter)} 0 ${large} 1 ${pt(rOuter, end)}`, `L${pt(rInner, end)}`, `A${r2(rInner)} ${r2(rInner)} 0 ${large} 0 ${pt(rInner, a0)}`, "Z"].join(" ");
}
