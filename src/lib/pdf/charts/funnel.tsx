import { G, Rect, Svg } from "@react-pdf/renderer";
import { pct } from "../format";
import { PDF_COLORS, TYPE } from "../theme";
import { SvgText } from "./primitives";
import { finite, linear, r2 } from "./scale";

/**
 * Funnel as horizontal bars (easier to read than trapezoids): each step's count, its width
 * relative to the first step, and the conversion from the previous step.
 */
export function Funnel({
  width,
  steps,
  format,
  color = PDF_COLORS.customers,
  rowHeight = 22,
}: {
  width: number;
  steps: { label: string; value: number }[];
  format: (v: number) => string;
  color?: string;
  rowHeight?: number;
}) {
  const labelW = Math.round(width * 0.24);
  const rateW = 44;
  const first = Math.max(1e-9, finite(steps[0]?.value));
  const x = linear([0, first], [0, width - labelW - rateW]);
  const height = steps.length * rowHeight;
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {steps.map((s, i) => {
        const y = i * rowHeight;
        const w = Math.max(1, x(Math.max(0, finite(s.value))));
        const prev = i ? finite(steps[i - 1].value) : null;
        return (
          <G key={i}>
            <SvgText x={0} y={y + rowHeight / 2 + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fg}>
              {s.label}
            </SvgText>
            <Rect x={r2(labelW)} y={r2(y + 3)} width={r2(w)} height={r2(rowHeight - 6)} rx={1.5} fill={color} fillOpacity={1 - i * (0.5 / Math.max(1, steps.length - 1))} />
            <SvgText x={labelW + w + 4} y={y + rowHeight / 2 + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fg} weight={500}>
              {format(finite(s.value))}
            </SvgText>
            {prev !== null ? (
              <SvgText x={width} y={y + rowHeight / 2 + TYPE.micro * 0.34} anchor="end" color={PDF_COLORS.fgMuted}>
                {prev > 0 ? `${pct(finite(s.value) / prev)} of previous` : "—"}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}
