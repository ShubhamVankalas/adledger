import { G, Rect, Svg } from "@react-pdf/renderer";
import { safeText } from "../format";
import { HEAT_RAMP, PDF_COLORS, TYPE } from "../theme";
import { SvgText } from "./primitives";
import { finite, r2 } from "./scale";

/** Colour for `v` on the sequential ramp, relative to [0, max]. */
export function heatColor(v: number, max: number): string {
  if (!(max > 0) || v <= 0) return HEAT_RAMP[0];
  const t = Math.min(1, v / max);
  return HEAT_RAMP[Math.min(HEAT_RAMP.length - 1, Math.floor(t * (HEAT_RAMP.length - 1) + 0.5))];
}

/**
 * Cohort-style heatmap: one row per cohort, one column per period. `null` cells (periods that
 * haven't happened yet) stay empty. Values print inside cells when they fit.
 */
export function Heatmap({
  width: maxWidth,
  rowLabels,
  colLabels,
  values,
  format,
  rowLabelWidth = 64,
  cellHeight = 14,
  maxCellWidth = 64,
  extra,
}: {
  width: number;
  rowLabels: string[];
  colLabels: string[];
  values: (number | null)[][];
  format: (v: number) => string;
  rowLabelWidth?: number;
  cellHeight?: number;
  maxCellWidth?: number;
  /** Optional right-hand column (e.g. cohort size), printed after the grid. */
  extra?: { label: string; values: string[]; width: number };
}) {
  const extraW = extra?.width ?? 0;
  const cols = Math.max(1, colLabels.length);
  // Cells stay a readable size when there are only a few periods (the grid left-aligns).
  const cw = Math.min((maxWidth - rowLabelWidth - extraW) / cols, maxCellWidth);
  const width = rowLabelWidth + cols * cw + extraW;
  const headH = 12;
  const height = headH + rowLabels.length * cellHeight;
  const max = Math.max(0, ...values.flat().map((v) => finite(v)));
  const showValues = cw >= 24;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {colLabels.map((c, j) => (
        <SvgText key={`h${j}`} x={rowLabelWidth + j * cw + cw / 2} y={8} anchor="middle">
          {c}
        </SvgText>
      ))}
      {extra ? (
        <SvgText x={width} y={8} anchor="end">
          {extra.label}
        </SvgText>
      ) : null}
      {rowLabels.map((label, i) => {
        const y = headH + i * cellHeight;
        return (
          <G key={i}>
            <SvgText x={0} y={y + cellHeight / 2 + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fg}>
              {safeText(label, 16)}
            </SvgText>
            {colLabels.map((_, j) => {
              const v = values[i]?.[j];
              if (v === null || v === undefined) return null;
              const fill = heatColor(finite(v), max);
              const dark = HEAT_RAMP.indexOf(fill as (typeof HEAT_RAMP)[number]) >= 3;
              return (
                <G key={j}>
                  <Rect x={r2(rowLabelWidth + j * cw + 0.5)} y={r2(y + 0.5)} width={r2(cw - 1)} height={r2(cellHeight - 1)} rx={1} fill={fill} />
                  {showValues ? (
                    <SvgText x={rowLabelWidth + j * cw + cw / 2} y={y + cellHeight / 2 + TYPE.micro * 0.34} anchor="middle" color={dark ? "#ffffff" : PDF_COLORS.fg}>
                      {format(finite(v))}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
            {extra ? (
              <SvgText x={width} y={y + cellHeight / 2 + TYPE.caption * 0.34} size={TYPE.caption} color={PDF_COLORS.fgMuted} anchor="end">
                {extra.values[i] ?? ""}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </Svg>
  );
}
