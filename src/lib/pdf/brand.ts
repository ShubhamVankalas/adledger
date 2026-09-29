import { findTheme, isDefaultTheme, parseTheme } from "../themes";

// The organization's accent (Settings → Organization → Appearance) as a print colour. Themes are
// defined in OKLCH for the screen; react-pdf needs #rrggbb, so the light-mode brand is converted
// here and darkened until it reads on white paper (contrast >= 3:1, like pdfTheme() requires).
// The default theme keeps the PDF's own emerald accent.

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/;

function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l1 = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m1 = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s1 = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l1 - 3.3077115913 * m1 + 0.2309699292 * s1,
    -1.2684380046 * l1 + 2.6097574011 * m1 - 0.3413193965 * s1,
    -0.0041960863 * l1 - 0.7034186147 * m1 + 1.707614701 * s1,
  ];
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const [r, g, bl] = lin.map((v) => Math.round(Math.min(1, Math.max(0, gamma(v))) * 255));
  return [r, g, bl];
}

const hex = (rgb: [number, number, number]) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

function contrastOnWhite([r, g, b]: [number, number, number]) {
  const ch = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] + 0.05);
}

/** "oklch(0.55 0.13 162)" → "#1a8a5f", darkened until it has at least 3:1 contrast on white. */
export function oklchToPrintHex(value: string): string | null {
  const m = OKLCH.exec(value.trim());
  if (!m) return null;
  let l = Number(m[1]);
  let c = Number(m[2]);
  const h = Number(m[3]);
  if (![l, c, h].every(Number.isFinite)) return null;
  for (let i = 0; i < 20; i++) {
    const rgb = oklchToRgb(l, c, h);
    if (contrastOnWhite(rgb) >= 3.2) return hex(rgb);
    l -= 0.025;
    c *= 0.97;
  }
  return null;
}

/** Print accent for an organization's stored theme, or null for the default (PDF emerald). */
export function orgPrintAccent(theme: unknown): string | null {
  const parsed = parseTheme(theme);
  if (isDefaultTheme(parsed)) return null;
  const t = findTheme(parsed);
  return t ? oklchToPrintHex(t.light.brand) : null;
}
