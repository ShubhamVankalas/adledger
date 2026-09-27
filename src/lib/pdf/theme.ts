// Light-theme hex equivalents of the "Quiet Ledger" OKLCH tokens (docs/redesign/BRIEF.md §2.2).
// PDFs are always printed light: paper is white, ink is near-black sage graphite, and colour
// appears only where it means money (green revenue / gain, red loss, amber warning).

export const PDF_COLORS = {
  // neutrals (hue 165, "sage graphite")
  paper: "#ffffff",
  bg: "#f8fbf9",
  bgSubtle: "#f3f7f5",
  fill: "#eef1ef",
  fillActive: "#dfe4e2",
  border: "#e3e6e4",
  borderStrong: "#cdd2d0",
  fgFaint: "#818885",
  fgMuted: "#5d6561",
  fg: "#111815",
  // accent (emerald): selection, links and the revenue series
  accent: "#008859",
  accentFg: "#005d3c",
  accentSoft: "#dff7ea",
  // semantic
  positive: "#007e46",
  positiveSoft: "#e3f8e9",
  negative: "#c9302d",
  negativeSoft: "#ffece9",
  warning: "#d58d25",
  warningText: "#915200",
  warningSoft: "#ffefd5",
  info: "#3275b4",
  // charts: one colour per metric, everywhere
  revenue: "#019f68",
  revenueSoft: "#d2f1df",
  spend: "#738292",
  spendSoft: "#d8dfe6",
  leads: "#dc932e",
  customers: "#5176cd",
  chart5: "#e06065",
  grid: "#e3e6e4",
} as const;

/** Sequential emerald ramp for heatmaps (light → dark). */
export const HEAT_RAMP = ["#edf8f2", "#c2e9d3", "#89d0aa", "#49af7e", "#118659", "#055c3e"] as const;

/** Categorical order for series without a fixed metric colour (channels, platforms, cohorts). */
export const CATEGORICAL = [PDF_COLORS.revenue, PDF_COLORS.customers, PDF_COLORS.leads, PDF_COLORS.spend, PDF_COLORS.chart5, "#8b6fc6", "#3e9fb8", "#a3a93a"] as const;

export type PdfTheme = typeof PDF_COLORS & {
  /** Organization accent used for the masthead rule and cover details (never for money). */
  brand: string;
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Relative luminance (WCAG) of a #rrggbb colour. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/**
 * Build the theme for one document. `accent` is an optional org colour: anything that isn't a
 * strict #rrggbb value, or that is too light to read on white (contrast < 3:1), falls back to
 * the emerald accent. Only validated hex ever reaches a drawing attribute.
 */
export function pdfTheme(accent?: string | null): PdfTheme {
  const ok = typeof accent === "string" && HEX.test(accent) && (1.05 / (luminance(accent) + 0.05)) >= 3;
  return { ...PDF_COLORS, brand: ok ? accent.toLowerCase() : PDF_COLORS.accent };
}

/** Type scale in points (A4 is 595 × 842 pt). Mirrors BRIEF §2.1 scaled for print. */
export const TYPE = {
  micro: 6.5,
  caption: 7.5,
  ui: 8.5,
  body: 9.5,
  titleSm: 11,
  title: 15,
  kpi: 15,
  kpiLg: 22,
  display: 26,
} as const;

export const SPACE = { page: 36, gutter: 12, section: 20 } as const;
