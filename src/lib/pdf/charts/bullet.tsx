import { Line, Rect, Svg } from "@react-pdf/renderer";
import { PDF_COLORS } from "../theme";
import { finite, linear, r2 } from "./scale";

/**
 * Bullet chart: a thin bar for the actual value against a target tick, on a neutral track with
 * an optional "good" band (e.g. ROAS above break-even).
 */
export function Bullet({
  width,
  height = 8,
  value,
  target,
  max,
  color = PDF_COLORS.revenue,
  goodFrom,
}: {
  width: number;
  height?: number;
  value: number;
  target?: number | null;
  max?: number;
  color?: string;
  /** Start of the shaded "good" band. */
  goodFrom?: number;
}) {
  const top = Math.max(finite(value), finite(target ?? 0), finite(max ?? 0), 1e-9) * (max ? 1 : 1.15);
  const x = linear([0, top], [0, width]);
  const barH = Math.max(2, height * 0.45);
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Rect x={0} y={0} width={width} height={height} rx={1.5} fill={PDF_COLORS.fill} />
      {goodFrom !== undefined && goodFrom < top ? <Rect x={r2(x(goodFrom))} y={0} width={r2(width - x(goodFrom))} height={height} rx={1.5} fill={PDF_COLORS.positiveSoft} /> : null}
      <Rect x={0} y={r2((height - barH) / 2)} width={r2(Math.max(0, x(Math.max(0, finite(value)))))} height={r2(barH)} rx={1} fill={color} />
      {target !== undefined && target !== null ? <Line x1={r2(x(target))} x2={r2(x(target))} y1={0} y2={height} stroke={PDF_COLORS.fg} strokeWidth={1} /> : null}
    </Svg>
  );
}
