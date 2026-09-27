import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, GRADIENT_THEMES, SOLID_THEMES, findTheme, parseTheme, themeCss, type ThemeTokens } from "@/lib/themes";

// oklch() string → sRGB (0..1, gamma-encoded, clipped to gamut) + alpha.
function parse(css: string): { rgb: [number, number, number]; a: number } {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(css);
  if (!m) throw new Error(`not oklch: ${css}`);
  const [L, C, H, A] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const gamma = (x: number) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return { rgb: lin.map(gamma) as [number, number, number], a: A };
}

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: [number, number, number]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** Colour composited over an opaque background (browsers blend in gamma-encoded sRGB). */
const over = (fg: string, bg: string): [number, number, number] => {
  const f = parse(fg);
  const b = parse(bg).rgb;
  return f.rgb.map((v, i) => v * f.a + b[i] * (1 - f.a)) as [number, number, number];
};
const contrast = (x: [number, number, number], y: [number, number, number]) => {
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

// Surfaces from globals.css.
const SURFACES = {
  light: { surface: "oklch(1 0 0)", bg: "oklch(0.985 0.003 165)" },
  dark: { surface: "oklch(0.195 0.005 165)", bg: "oklch(0.165 0.004 165)" },
};

const ALL = [...SOLID_THEMES, ...GRADIENT_THEMES];
const KEYS: (keyof ThemeTokens)[] = ["brand", "brandHover", "brandSoft", "brandFg", "ring", "chartRevenue", "brand2"];

describe("theme catalog", () => {
  it("has 20 solids and 10 gradients with unique ids", () => {
    expect(SOLID_THEMES).toHaveLength(20);
    expect(GRADIENT_THEMES).toHaveLength(10);
    expect(new Set(ALL.map((t) => `${t.kind}:${t.id}`)).size).toBe(30);
    expect(new Set(ALL.map((t) => t.name)).size).toBe(30);
  });

  it("defines every token for light and dark as valid oklch", () => {
    for (const t of ALL)
      for (const mode of ["light", "dark"] as const)
        for (const k of KEYS) expect(() => parse(t[mode][k]), `${t.id} ${mode} ${k}`).not.toThrow();
  });

  it("keeps the default emerald identical to the stylesheet", () => {
    const e = findTheme(DEFAULT_THEME)!;
    expect(e.light.brand).toBe("oklch(0.55 0.13 162)");
    expect(e.dark.brand).toBe("oklch(0.74 0.14 162)");
    expect(themeCss(DEFAULT_THEME)).toBe("");
  });

  for (const mode of ["light", "dark"] as const) {
    it(`passes WCAG AA in ${mode} mode`, () => {
      const { surface, bg } = SURFACES[mode];
      for (const t of ALL) {
        const tk = t[mode];
        const fg = parse(tk.brandFg).rgb;
        const where = `${t.kind}:${t.id} ${mode}`;
        // Brand text (links, brand badges) on cards, on the canvas and on its own soft tint.
        expect(contrast(fg, parse(surface).rgb), `${where} fg/surface`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, parse(bg).rgb), `${where} fg/bg`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(fg, over(tk.brandSoft, surface)), `${where} fg/soft`).toBeGreaterThanOrEqual(4.5);
        // Brand as a UI colour (focus, indicators, bars, both gradient stops) against the surface.
        expect(contrast(parse(tk.brand).rgb, parse(surface).rgb), `${where} brand/surface`).toBeGreaterThanOrEqual(3);
        expect(contrast(parse(tk.brand2).rgb, parse(surface).rgb), `${where} brand2/surface`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("parseTheme / themeCss", () => {
  it("falls back to the default for unknown or malformed values", () => {
    expect(parseTheme(null)).toEqual(DEFAULT_THEME);
    expect(parseTheme({})).toEqual(DEFAULT_THEME);
    expect(parseTheme({ kind: "solid", id: "nope" })).toEqual(DEFAULT_THEME);
    expect(parseTheme({ kind: "gradient", id: "blue" })).toEqual(DEFAULT_THEME);
    expect(parseTheme({ kind: "gradient", id: "aurora" })).toEqual({ kind: "gradient", id: "aurora" });
  });

  it("emits light and dark overrides, with a second stop only for gradients", () => {
    const solid = themeCss({ kind: "solid", id: "blue" });
    expect(solid).toMatch(/^:root\{--brand:oklch\(0\.53 0\.19 259\);.*\}:root\.dark\{--brand:oklch\(0\.71 0\.15 259\);.*\}$/);
    expect(solid).toContain("--brand-2:oklch(0.53 0.19 259)");
    const grad = themeCss({ kind: "gradient", id: "aurora" });
    expect(grad).toContain("--brand-2:oklch(0.52 0.21 292)");
    // Stored values can't inject CSS: unknown ids never reach the output.
    expect(themeCss({ kind: "solid", id: "x}body{display:none" })).toBe("");
  });
});
