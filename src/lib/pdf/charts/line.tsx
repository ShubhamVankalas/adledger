import { G, Path, Svg } from "@react-pdf/renderer";
import { areaPath, axisWidth, linePath, XLabels, YGrid } from "./primitives";
import { finite, linear, niceTicks, pointX } from "./scale";

export type LineSeries = {
  values: (number | null)[];
  color: string;
  /** Comparison periods and incomplete days are drawn dashed. */
  dashed?: boolean;
  /** Soft fill under the line (one series per chart at most). */
  area?: boolean;
  strokeWidth?: number;
};

/** Multi-series line chart with a nice y axis. */
export function LineChart({
  width,
  height,
  labels,
  series,
  yFormat,
  yTicks = 4,
  includeZero = true,
  maxLabels = 7,
}: {
  width: number;
  height: number;
  labels: string[];
  series: LineSeries[];
  yFormat: (v: number) => string;
  yTicks?: number;
  includeZero?: boolean;
  maxLabels?: number;
}) {
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  const ticks = niceTicks(all.length ? Math.min(...all) : 0, all.length ? Math.max(...all) : 0, yTicks, { includeZero });
  const left = axisWidth(ticks, yFormat);
  const top = 4;
  const bottom = height - 14;
  const right = width - 2;
  const y = linear([ticks.min, ticks.max], [bottom, top]);
  const n = Math.max(...series.map((s) => s.values.length), labels.length, 1);
  const x = pointX(n, [left, right]);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid ticks={ticks} y={y} x0={left} x1={right} format={yFormat} />
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => (v === null || !Number.isFinite(v) ? null : { x: x(i), y: y(finite(v)) }));
        const contiguous = pts.filter((p): p is { x: number; y: number } => p !== null);
        return (
          <G key={si}>
            {s.area && contiguous.length > 1 ? <Path d={areaPath(contiguous, y(Math.max(ticks.min, 0)))} fill={s.color} fillOpacity={0.1} /> : null}
            <Path d={linePath(pts)} stroke={s.color} strokeWidth={s.strokeWidth ?? 1.25} fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "2.5 2" : undefined} strokeOpacity={s.dashed ? 0.75 : 1} />
          </G>
        );
      })}
      <XLabels labels={labels} x={x} y={height - 3} max={maxLabels} />
    </Svg>
  );
}
