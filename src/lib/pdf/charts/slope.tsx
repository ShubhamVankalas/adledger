import { Circle, G, Line, Svg } from "@react-pdf/renderer";
import { safeText } from "../format";
import { PDF_COLORS, TYPE } from "../theme";
import { SvgText, textWidth } from "./primitives";
import { finite, linear, niceTicks, r2 } from "./scale";

export type SlopeItem = { label: string; a: number; b: number; color: string };

/** Spread label positions so none are closer than `gap` (keeps order, stays inside [lo, hi]). */
export function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((p, q) => p.y - q.y);
  const out = order.map((o) => Math.max(lo, Math.min(hi, o.y)));
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap);
  // Ran past the bottom: pin the last label there and push the others back up.
  if (out.length && out[out.length - 1] > hi) {
    out[out.length - 1] = hi;
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap);
  }
  const res = new Array<number>(ys.length);
  order.forEach((o, k) => (res[o.i] = out[k]));
  return res;
}

/**
 * Slope chart: each item's value under model A (left) and model B (right). Great for "first vs
 * last touch": lines tilting down are journey starters, lines tilting up are closers.
 */
export function SlopeChart({
  width,
  height,
  items,
  leftTitle,
  rightTitle,
  format,
}: {
  width: number;
  height: number;
  items: SlopeItem[];
  leftTitle: string;
  rightTitle: string;
  format: (v: number) => string;
}) {
  const vals = items.flatMap((it) => [finite(it.a), finite(it.b)]);
  const ticks = niceTicks(0, Math.max(0, ...vals), 4);
  const top = 18;
  const bottom = height - 6;
  const y = linear([ticks.min, ticks.max], [bottom, top]);
  const leftW = Math.max(36, ...items.map((it) => textWidth(format(it.a), TYPE.caption))) + 6;
  const rightLabelW = Math.min(width * 0.46, 190);
  const x0 = leftW;
  const x1 = width - rightLabelW;
  const gap = TYPE.caption + 2.5;
  const ly = spread(items.map((it) => y(finite(it.a))), gap, top, bottom);
  const ry = spread(items.map((it) => y(finite(it.b))), gap, top, bottom);
  const maxChars = Math.floor((rightLabelW - 44) / (TYPE.caption * 0.52));

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <SvgText x={x0} y={8} anchor="middle" color={PDF_COLORS.fgMuted} weight={500}>
        {leftTitle}
      </SvgText>
      <SvgText x={x1} y={8} anchor="middle" color={PDF_COLORS.fgMuted} weight={500}>
        {rightTitle}
      </SvgText>
      <Line x1={x0} x2={x0} y1={top - 4} y2={bottom} stroke={PDF_COLORS.border} strokeWidth={0.6} />
      <Line x1={x1} x2={x1} y1={top - 4} y2={bottom} stroke={PDF_COLORS.border} strokeWidth={0.6} />
      {items.map((it, i) => (
        <G key={i}>
          <Line x1={r2(x0)} x2={r2(x1)} y1={r2(y(finite(it.a)))} y2={r2(y(finite(it.b)))} stroke={it.color} strokeWidth={1.2} strokeLinecap="round" />
          <Circle cx={r2(x0)} cy={r2(y(finite(it.a)))} r={1.8} fill={it.color} />
          <Circle cx={r2(x1)} cy={r2(y(finite(it.b)))} r={1.8} fill={it.color} />
          <SvgText x={x0 - 5} y={ly[i] + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fgMuted} anchor="end">
            {format(it.a)}
          </SvgText>
          <SvgText x={x1 + 5} y={ry[i] + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fg} weight={500}>
            {format(it.b)}
          </SvgText>
          <SvgText x={x1 + 44} y={ry[i] + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fgMuted}>
            {safeText(it.label, Math.max(8, maxChars))}
          </SvgText>
        </G>
      ))}
    </Svg>
  );
}
