import { G, Path, Rect, Svg } from "@react-pdf/renderer";
import { areaPath, axisWidth, linePath, XLabels, YGrid } from "./primitives";
import { band, finite, linear, niceTicks, r2 } from "./scale";

/**
 * Bars + line on one shared axis: daily ad spend as calm slate bars, revenue as a green line
 * with a soft area, and an optional dashed comparison line (previous period).
 */
export function ComboChart({
  width,
  height,
  labels,
  bars,
  line,
  compare,
  yFormat,
  maxLabels = 7,
}: {
  width: number;
  height: number;
  labels: string[];
  bars: { values: number[]; color: string };
  line: { values: number[]; color: string };
  compare?: { values: (number | null)[]; color: string };
  yFormat: (v: number) => string;
  maxLabels?: number;
}) {
  const vals = [...bars.values, ...line.values, ...(compare?.values ?? [])].filter((v): v is number => v !== null && Number.isFinite(v));
  const ticks = niceTicks(vals.length ? Math.min(...vals) : 0, vals.length ? Math.max(...vals) : 0, 4);
  const left = axisWidth(ticks, yFormat);
  const top = 4;
  const bottom = height - 14;
  const right = width - 2;
  const y = linear([ticks.min, ticks.max], [bottom, top]);
  const n = Math.max(labels.length, 1);
  const b = band(n, [left, right], n > 45 ? 0.15 : 0.3);
  const zero = y(0);
  const pts = line.values.map((v, i) => ({ x: b.center(i), y: y(finite(v)) }));
  const cmp = compare?.values.map((v, i) => (v === null ? null : { x: b.center(i), y: y(finite(v)) }));

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <YGrid ticks={ticks} y={y} x0={left} x1={right} format={yFormat} />
      <G>
        {bars.values.map((v, i) => {
          const h = Math.abs(zero - y(finite(v)));
          if (h < 0.1) return null;
          return <Rect key={i} x={r2(b.x(i))} y={r2(Math.min(zero, y(finite(v))))} width={r2(b.width)} height={r2(h)} rx={b.width > 4 ? 0.8 : 0} fill={bars.color} fillOpacity={0.55} />;
        })}
      </G>
      {pts.length > 1 ? <Path d={areaPath(pts, zero)} fill={line.color} fillOpacity={0.08} /> : null}
      {cmp ? <Path d={linePath(cmp)} stroke={compare!.color} strokeWidth={1} strokeDasharray="2.5 2" fill="none" strokeOpacity={0.7} /> : null}
      <Path d={linePath(pts)} stroke={line.color} strokeWidth={1.4} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <XLabels labels={labels} x={b.center} y={height - 3} max={maxLabels} />
    </Svg>
  );
}
