import { Circle, Path, Svg } from "@react-pdf/renderer";
import { linePath } from "./primitives";
import { finite, linear, pointX, r2 } from "./scale";

/** Tiny trend line for KPI tiles, with an optional dashed comparison series. */
export function Sparkline({
  width,
  height,
  values,
  color,
  compare,
  compareColor,
}: {
  width: number;
  height: number;
  values: number[];
  color: string;
  compare?: number[];
  compareColor?: string;
}) {
  const all = [...values, ...(compare ?? [])].map(finite);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const pad = 1.5;
  const y = linear([lo, hi === lo ? lo + 1 : hi], [height - pad, pad]);
  const x = pointX(Math.max(values.length, compare?.length ?? 0), [pad, width - pad]);
  const pts = values.map((v, i) => ({ x: x(i), y: y(finite(v)) }));
  const last = pts[pts.length - 1];
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {compare?.length ? <Path d={linePath(compare.map((v, i) => ({ x: x(i), y: y(finite(v)) })))} stroke={compareColor ?? color} strokeWidth={0.7} strokeDasharray="1.5 1.5" fill="none" strokeOpacity={0.6} /> : null}
      {pts.length > 1 ? <Path d={linePath(pts)} stroke={color} strokeWidth={1} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
      {last ? <Circle cx={r2(last.x)} cy={r2(last.y)} r={1.3} fill={color} /> : null}
    </Svg>
  );
}
