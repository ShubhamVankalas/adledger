import { G, Line, Rect, Svg } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { axisWidth, SvgText, XLabels, YGrid } from "./primitives";
import { band, finite, linear, niceTicks, r2 } from "./scale";

export type WaterfallStep = { label: string; value: number; kind: "total" | "delta" };

/**
 * Waterfall (e.g. revenue → refunds → fees → ad spend → contribution). "total" steps are drawn
 * from zero in ink; deltas float from the running total, green up and red down.
 */
export function Waterfall({ width, height, steps, yFormat }: { width: number; height: number; steps: WaterfallStep[]; yFormat: (v: number) => string }) {
  const spans: { y0: number; y1: number; kind: WaterfallStep["kind"]; value: number }[] = [];
  let run = 0;
  for (const s of steps) {
    const v = finite(s.value);
    if (s.kind === "total") {
      run = v;
      spans.push({ y0: 0, y1: v, kind: "total", value: v });
    } else {
      spans.push({ y0: run, y1: run + v, kind: "delta", value: v });
      run += v;
    }
  }
  const vals = spans.flatMap((s) => [s.y0, s.y1]);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const left = axisWidth(ticks, yFormat);
  const top = 12;
  const bottom = height - 14;
  const right = width - 2;
  const y = linear([ticks.min, ticks.max], [bottom, top]);
  const b = band(steps.length, [left, right], 0.35);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid ticks={ticks} y={y} x0={left} x1={right} format={yFormat} />
      {spans.map((s, i) => {
        const color = s.kind === "total" ? PDF_COLORS.fg : s.value >= 0 ? PDF_COLORS.positive : PDF_COLORS.negative;
        const yTop = Math.min(y(s.y0), y(s.y1));
        const h = Math.max(0.6, Math.abs(y(s.y1) - y(s.y0)));
        return (
          <G key={i}>
            <Rect x={r2(b.x(i))} y={r2(yTop)} width={r2(b.width)} height={r2(h)} rx={0.8} fill={color} fillOpacity={s.kind === "total" ? 0.85 : 0.8} />
            {i < spans.length - 1 ? <Line x1={r2(b.x(i) + b.width)} x2={r2(b.x(i + 1))} y1={r2(y(s.y1))} y2={r2(y(s.y1))} stroke={PDF_COLORS.borderStrong} strokeWidth={0.5} strokeDasharray="1 1" /> : null}
            <SvgText x={b.center(i)} y={yTop - 3} anchor="middle" color={PDF_COLORS.fgMuted}>
              {yFormat(s.value)}
            </SvgText>
          </G>
        );
      })}
      <XLabels labels={steps.map((s) => s.label)} x={b.center} y={height - 3} max={steps.length} />
    </Svg>
  );
}
