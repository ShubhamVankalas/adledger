import { existsSync } from "node:fs";
import path from "node:path";
import { Font } from "@react-pdf/renderer";

// Fonts are embedded from files shipped in the repo (src/lib/pdf/fonts, SIL OFL 1.1), never
// fetched at runtime, so PDFs render offline and inside the Docker image
// (next.config.ts copies the folder into the standalone output via outputFileTracingIncludes).
//
// - Geist Regular / Medium / SemiBold / Bold: every Latin glyph, tabular figures (tnum).
// - Noto Sans Devanagari Regular / Bold (optional): drop NotoSansDevanagari-Regular.ttf and
//   NotoSansDevanagari-Bold.ttf into the folder and Hindi / Marathi campaign names render as
//   a fallback family. Without them those glyphs are skipped (documented in docs/REPORTS.md).

export const FONT_FAMILY = "Geist";
const DEVANAGARI = "Noto Sans Devanagari";

/** Where the font files live: the repo in dev/tests, `/app/src/lib/pdf/fonts` in the image. */
export function fontDir(): string {
  return path.join(process.cwd(), "src", "lib", "pdf", "fonts");
}

const g = globalThis as unknown as { __adledgerPdfFonts?: { families: string[] } };

/** Register fonts once per process. Returns the font-family fallback list to use in styles. */
export function registerFonts(): string[] {
  if (g.__adledgerPdfFonts) return g.__adledgerPdfFonts.families;
  const dir = fontDir();
  const file = (name: string) => path.join(dir, name);
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: file("Geist-Regular.ttf"), fontWeight: 400 },
      { src: file("Geist-Medium.ttf"), fontWeight: 500 },
      { src: file("Geist-SemiBold.ttf"), fontWeight: 600 },
      { src: file("Geist-Bold.ttf"), fontWeight: 700 },
    ],
  });
  const families = [FONT_FAMILY];
  if (existsSync(file("NotoSansDevanagari-Regular.ttf"))) {
    const bold = existsSync(file("NotoSansDevanagari-Bold.ttf")) ? file("NotoSansDevanagari-Bold.ttf") : file("NotoSansDevanagari-Regular.ttf");
    Font.register({
      family: DEVANAGARI,
      fonts: [
        { src: file("NotoSansDevanagari-Regular.ttf"), fontWeight: 400 },
        { src: file("NotoSansDevanagari-Regular.ttf"), fontWeight: 500 },
        { src: bold, fontWeight: 600 },
        { src: bold, fontWeight: 700 },
      ],
    });
    families.push(DEVANAGARI);
  }
  // Campaign names and IDs must never be hyphenated across lines.
  Font.registerHyphenationCallback((word) => [word]);
  g.__adledgerPdfFonts = { families };
  return families;
}

/** Currency symbols Geist can draw. Others (₩ ₺ ₦ ₫ …) print their ISO code instead. */
export const SUPPORTED_SYMBOL_CHARS = new Set([..."$€£¥₹₽₪₱฿₴", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,'  "]);
