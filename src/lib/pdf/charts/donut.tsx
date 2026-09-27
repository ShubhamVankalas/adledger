import { Circle, G, Path, Svg } from "@react-pdf/renderer";
import { PDF_COLORS, TYPE } from "../theme";
import { arcPath, SvgText } from "./primitives";
import { finite } from "./scale";

/**
 * Donut with an optional centre value. Slices under 0.5% are merged by the caller's data (we
 * only draw positive values); a hairline gap separates slices.
 */
export function Donut({
  size,
  slices,
  centerValue,
  centerLabel,
  thickness,
}: {
  size: number;
  slices: { value: number; color: string }[];
  centerValue?: string;
  centerLabel?: string;
  thickness?: number;
}) {
  const r = size / 2;
  const t = thickness ?? Math.max(6, size * 0.14);
  const positive = slices.map((s) => ({ ...s, value: Math.max(0, finite(s.value)) })).filter((s) => s.value > 0);
  const total = positive.reduce((a, s) => a + s.value, 0);
  const gap = positive.length > 1 ? 0.018 : 0;
  // Start angle of each slice (running sum), computed before drawing.
  const starts = positive.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + (positive[i - 1].value / total) * Math.PI * 2 : 0], []);
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {total <= 0 ? <Circle cx={r} cy={r} r={r - t / 2} stroke={PDF_COLORS.fill} strokeWidth={t} fill="none" /> : null}
      <G>
        {positive.map((s, i) => {
          const sweep = (s.value / total) * Math.PI * 2;
          const a = starts[i];
          const d = arcPath(r, r, r, r - t, a + gap / 2, a + Math.max(sweep - gap / 2, gap / 2 + 0.001));
          return <Path key={i} d={d} fill={s.color} />;
        })}
      </G>
      {centerValue ? (
        <SvgText x={r} y={r + (centerLabel ? 1 : TYPE.titleSm * 0.35)} size={TYPE.titleSm} color={PDF_COLORS.fg} anchor="middle" weight={600}>
          {centerValue}
        </SvgText>
      ) : null}
      {centerLabel ? (
        <SvgText x={r} y={r + TYPE.micro + 3} anchor="middle" color={PDF_COLORS.fgMuted}>
          {centerLabel}
        </SvgText>
      ) : null}
    </Svg>
  );
}
