import { G, Line, Rect, Svg } from "@react-pdf/renderer";
import { safeText } from "../format";
import { PDF_COLORS, TYPE } from "../theme";
import { axisWidth, SvgText, textWidth, XLabels, YGrid } from "./primitives";
import { band, finite, linear, niceTicks, r2 } from "./scale";

export type BarSeries = { name: string; values: number[]; color: string };

/** Vertical bars: grouped (side by side) or stacked. */
export function BarChart({
  width,
  height,
  categories,
  series,
  mode = "grouped",
  yFormat,
  maxLabels = 8,
}: {
  width: number;
  height: number;
  categories: string[];
  series: BarSeries[];
  mode?: "grouped" | "stacked";
  yFormat: (v: number) => string;
  maxLabels?: number;
}) {
  const n = categories.length;
  const totals = (sign: 1 | -1) => categories.map((_, i) => series.reduce((s, se) => s + (Math.sign(finite(se.values[i])) === sign ? finite(se.values[i]) : 0), 0));
  const vals = mode === "stacked" ? [...totals(1), ...totals(-1)] : series.flatMap((s) => s.values.map(finite));
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const left = axisWidth(ticks, yFormat);
  const top = 4;
  const bottom = height - 14;
  const right = width - 2;
  const y = linear([ticks.min, ticks.max], [bottom, top]);
  const b = band(n, [left, right], 0.3);
  const zero = y(0);
  const sub = mode === "grouped" ? b.width / Math.max(1, series.length) : b.width;

  const rects: { x: number; y: number; w: number; h: number; color: string; key: string }[] = [];
  categories.forEach((_, i) => {
    let up = 0;
    let down = 0;
    series.forEach((s, si) => {
      const v = finite(s.values[i]);
      if (mode === "grouped") {
        rects.push({ x: b.x(i) + si * sub, y: Math.min(zero, y(v)), w: Math.max(0.5, sub - (series.length > 1 ? 0.8 : 0)), h: Math.abs(zero - y(v)), color: s.color, key: `${i}-${si}` });
      } else {
        const base = v >= 0 ? up : down;
        const y0 = y(base);
        const y1 = y(base + v);
        rects.push({ x: b.x(i), y: Math.min(y0, y1), w: sub, h: Math.abs(y1 - y0), color: s.color, key: `${i}-${si}` });
        if (v >= 0) up += v;
        else down += v;
      }
    });
  });

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid ticks={ticks} y={y} x0={left} x1={right} format={yFormat} />
      {rects.map((r) => (r.h < 0.1 ? null : <Rect key={r.key} x={r2(r.x)} y={r2(r.y)} width={r2(r.w)} height={r2(r.h)} fill={r.color} />))}
      <XLabels labels={categories} x={b.center} y={height - 3} max={maxLabels} />
    </Svg>
  );
}

/**
 * Horizontal bars with the category name on the left and the formatted value at the end of
 * the bar. Ideal for ranked lists (waste by campaign, LTV:CAC by channel).
 */
export function HBarChart({
  width,
  rows,
  format,
  color = PDF_COLORS.spend,
  rowHeight = 15,
  labelWidth,
  reference,
}: {
  width: number;
  rows: { label: string; value: number; color?: string; note?: string }[];
  format: (v: number) => string;
  color?: string;
  rowHeight?: number;
  /** Width reserved for names (default ~38% of the chart). */
  labelWidth?: number;
  /** Optional vertical reference line (e.g. break-even 1.0×). */
  reference?: { value: number; label: string };
}) {
  const height = Math.max(rowHeight, rows.length * rowHeight) + (reference ? 10 : 0);
  const lw = labelWidth ?? Math.round(width * 0.38);
  const valueW = Math.max(28, ...rows.map((r) => textWidth(format(r.value), TYPE.caption))) + 4;
  const max = Math.max(0, ...rows.map((r) => finite(r.value)), reference?.value ?? 0);
  const min = Math.min(0, ...rows.map((r) => finite(r.value)));
  const x = linear([min, max || 1], [lw, width - valueW]);
  const maxChars = Math.max(8, Math.floor(lw / (TYPE.caption * 0.52)) - 1);
  const top = reference ? 10 : 0;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {rows.map((r, i) => {
        const cy = top + i * rowHeight + rowHeight / 2;
        const x0 = x(Math.min(0, finite(r.value)));
        const x1 = x(Math.max(0, finite(r.value)));
        return (
          <G key={i}>
            <SvgText x={0} y={cy + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fg}>
              {safeText(r.label, maxChars)}
            </SvgText>
            <Rect x={r2(lw)} y={r2(cy - 3.5)} width={r2(width - valueW - lw)} height={7} rx={1} fill={PDF_COLORS.fill} />
            {x1 - x0 > 0.2 ? <Rect x={r2(x0)} y={r2(cy - 3.5)} width={r2(x1 - x0)} height={7} rx={1} fill={r.color ?? color} /> : null}
            <SvgText x={width} y={cy + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fg} anchor="end" weight={500}>
              {format(r.value)}
            </SvgText>
          </G>
        );
      })}
      {reference ? (
        <G>
          <Line x1={r2(x(reference.value))} x2={r2(x(reference.value))} y1={top - 2} y2={height} stroke={PDF_COLORS.fgMuted} strokeWidth={0.6} strokeDasharray="1.5 1.5" />
          <SvgText x={x(reference.value)} y={7} anchor="middle">
            {reference.label}
          </SvgText>
        </G>
      ) : null}
    </Svg>
  );
}
