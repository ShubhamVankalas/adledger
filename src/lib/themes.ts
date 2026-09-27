/**
 * Organization accent themes (Settings → Organization → Appearance).
 *
 * Pure catalog, no server imports: the app layout injects `themeCss()` server-side and the picker
 * reuses it for a live preview. A theme only changes the accent tokens (--brand*, --ring,
 * --chart-revenue and --brand-2 for gradients); neutrals and the money colours (--positive,
 * --negative) never change. Contrast is checked in tests/themes.test.ts.
 */

export type ThemeKind = "solid" | "gradient";
export type OrgTheme = { kind: ThemeKind; id: string };

export type ThemeTokens = {
  brand: string;
  brandHover: string;
  brandSoft: string;
  brandFg: string;
  ring: string;
  chartRevenue: string;
  /** Second gradient stop; equals --brand for solid themes. */
  brand2: string;
};

type Tone = { l: number; c: number };
type Solid = { id: string; name: string; h: number; light: Tone; dark: Tone };
type Gradient = { id: string; name: string; from: string; to: string };

export const DEFAULT_THEME: OrgTheme = { kind: "solid", id: "emerald" };

// Lightness/chroma per mode, tuned so text (--brand-fg) is AA on cards and on its soft tint.
const SOLIDS: Solid[] = [
  { id: "emerald", name: "Emerald", h: 162, light: { l: 0.55, c: 0.13 }, dark: { l: 0.74, c: 0.14 } },
  { id: "teal", name: "Teal", h: 185, light: { l: 0.55, c: 0.1 }, dark: { l: 0.75, c: 0.12 } },
  { id: "cyan", name: "Cyan", h: 215, light: { l: 0.55, c: 0.11 }, dark: { l: 0.76, c: 0.12 } },
  { id: "sky", name: "Sky", h: 237, light: { l: 0.56, c: 0.14 }, dark: { l: 0.74, c: 0.13 } },
  { id: "blue", name: "Blue", h: 259, light: { l: 0.53, c: 0.19 }, dark: { l: 0.71, c: 0.15 } },
  { id: "indigo", name: "Indigo", h: 276, light: { l: 0.51, c: 0.2 }, dark: { l: 0.7, c: 0.15 } },
  { id: "violet", name: "Violet", h: 292, light: { l: 0.52, c: 0.21 }, dark: { l: 0.71, c: 0.16 } },
  { id: "purple", name: "Purple", h: 308, light: { l: 0.5, c: 0.19 }, dark: { l: 0.71, c: 0.16 } },
  { id: "fuchsia", name: "Fuchsia", h: 328, light: { l: 0.54, c: 0.21 }, dark: { l: 0.72, c: 0.18 } },
  { id: "pink", name: "Pink", h: 355, light: { l: 0.56, c: 0.19 }, dark: { l: 0.74, c: 0.14 } },
  { id: "rose", name: "Rose", h: 13, light: { l: 0.55, c: 0.19 }, dark: { l: 0.72, c: 0.15 } },
  { id: "red", name: "Red", h: 27, light: { l: 0.54, c: 0.2 }, dark: { l: 0.7, c: 0.17 } },
  { id: "orange", name: "Orange", h: 45, light: { l: 0.58, c: 0.17 }, dark: { l: 0.75, c: 0.15 } },
  { id: "amber", name: "Amber", h: 68, light: { l: 0.62, c: 0.15 }, dark: { l: 0.8, c: 0.14 } },
  { id: "gold", name: "Gold", h: 90, light: { l: 0.62, c: 0.13 }, dark: { l: 0.82, c: 0.13 } },
  { id: "lime", name: "Lime", h: 128, light: { l: 0.58, c: 0.15 }, dark: { l: 0.8, c: 0.17 } },
  { id: "green", name: "Forest", h: 148, light: { l: 0.5, c: 0.12 }, dark: { l: 0.74, c: 0.15 } },
  { id: "slate", name: "Slate", h: 250, light: { l: 0.5, c: 0.05 }, dark: { l: 0.74, c: 0.05 } },
  { id: "graphite", name: "Graphite", h: 260, light: { l: 0.42, c: 0.012 }, dark: { l: 0.8, c: 0.01 } },
  { id: "copper", name: "Copper", h: 50, light: { l: 0.55, c: 0.11 }, dark: { l: 0.74, c: 0.1 } },
];

const GRADIENTS: Gradient[] = [
  { id: "aurora", name: "Aurora", from: "teal", to: "violet" },
  { id: "ocean", name: "Ocean", from: "blue", to: "cyan" },
  { id: "sunset", name: "Sunset", from: "orange", to: "pink" },
  { id: "berry", name: "Berry", from: "purple", to: "rose" },
  { id: "lagoon", name: "Lagoon", from: "cyan", to: "emerald" },
  { id: "ember", name: "Ember", from: "red", to: "amber" },
  { id: "orchid", name: "Orchid", from: "fuchsia", to: "indigo" },
  { id: "citrus", name: "Citrus", from: "lime", to: "gold" },
  { id: "twilight", name: "Twilight", from: "indigo", to: "pink" },
  { id: "mint", name: "Mint", from: "emerald", to: "sky" },
];

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const ok = (l: number, c: number, h: number, alpha?: number) => `oklch(${r3(l)} ${r3(Math.max(0, c))} ${h}${alpha === undefined ? "" : ` / ${alpha}`})`;

function solidTokens(s: Solid, mode: "light" | "dark"): ThemeTokens {
  const { l, c } = s[mode];
  const h = s.h;
  const brand = ok(l, c, h);
  if (mode === "light") {
    return {
      brand,
      brandHover: ok(l - 0.05, c, h),
      brandSoft: ok(l, c, h, 0.09),
      // Text shade: dark enough for AA on white, the canvas and the soft tint.
      brandFg: ok(Math.min(l - 0.13, 0.44), c * 0.78, h),
      ring: ok(l, c, h, 0.45),
      chartRevenue: ok(l + 0.07, c + 0.01, h),
      brand2: brand,
    };
  }
  return {
    brand,
    brandHover: ok(l + 0.05, c - 0.01, h),
    brandSoft: ok(l, c, h, 0.12),
    brandFg: ok(Math.max(l + 0.06, 0.78), c - 0.02, h),
    ring: ok(l, c, h, 0.5),
    chartRevenue: brand,
    brand2: brand,
  };
}

export type ThemeOption = { kind: ThemeKind; id: string; name: string; light: ThemeTokens; dark: ThemeTokens };

const solidById = new Map(SOLIDS.map((s) => [s.id, s]));

export const SOLID_THEMES: ThemeOption[] = SOLIDS.map((s) => ({ kind: "solid", id: s.id, name: s.name, light: solidTokens(s, "light"), dark: solidTokens(s, "dark") }));

export const GRADIENT_THEMES: ThemeOption[] = GRADIENTS.map((g) => {
  const from = solidById.get(g.from)!;
  const to = solidById.get(g.to)!;
  return {
    kind: "gradient",
    id: g.id,
    name: g.name,
    light: { ...solidTokens(from, "light"), brand2: solidTokens(to, "light").brand },
    dark: { ...solidTokens(from, "dark"), brand2: solidTokens(to, "dark").brand },
  };
});

/** Valid theme from a stored value; anything unknown falls back to the default. */
export function parseTheme(raw: unknown): OrgTheme {
  if (raw && typeof raw === "object") {
    const { kind, id } = raw as Record<string, unknown>;
    if (typeof id === "string" && (kind === "solid" || kind === "gradient") && findTheme({ kind, id })) return { kind, id };
  }
  return DEFAULT_THEME;
}

export function findTheme(t: OrgTheme): ThemeOption | undefined {
  return (t.kind === "gradient" ? GRADIENT_THEMES : SOLID_THEMES).find((o) => o.id === t.id);
}

export function isDefaultTheme(t: OrgTheme): boolean {
  return t.kind === DEFAULT_THEME.kind && t.id === DEFAULT_THEME.id;
}

function declarations(t: ThemeTokens): string {
  return [
    `--brand:${t.brand}`,
    `--brand-hover:${t.brandHover}`,
    `--brand-soft:${t.brandSoft}`,
    `--brand-fg:${t.brandFg}`,
    `--ring:${t.ring}`,
    `--chart-revenue:${t.chartRevenue}`,
    `--brand-2:${t.brand2}`,
  ].join(";");
}

/**
 * CSS that overrides the accent tokens for light and dark mode. Empty for the default theme (the
 * stylesheet already has it). `:root.dark` outranks both `:root` and globals.css's `.dark`.
 */
export function themeCss(theme: unknown, { includeDefault = false }: { includeDefault?: boolean } = {}): string {
  const parsed = parseTheme(theme);
  const t = findTheme(parsed);
  if (!t || (isDefaultTheme(parsed) && !includeDefault)) return "";
  return `:root{${declarations(t.light)}}:root.dark{${declarations(t.dark)}}`;
}
