// Rasterizes public/icon.svg into the PNG app icons used by the web app manifest and iOS.
// Run: node scripts/generate-app-icons.mjs   (needs Playwright's Chromium: pnpm exec playwright install chromium)
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const svg = readFileSync("public/icon.svg", "utf8");
const BRAND = "#0f9d74";
// The glyph on its own (the icon without its rounded background tile).
const glyph = svg.replace(/<rect[^>]*\/>/, "").replace(/<svg[^>]*>/, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">');

// "any" icons keep the rounded tile with transparent corners. Maskable/apple icons are full-bleed
// squares with the glyph inside the platform safe zone (the central 80% circle for maskable).
const ICONS = [
  { file: "icon-192.png", size: 192, html: tile },
  { file: "icon-512.png", size: 512, html: tile },
  { file: "icon-maskable-192.png", size: 192, html: (s) => bleed(s, 0.85) },
  { file: "icon-maskable-512.png", size: 512, html: (s) => bleed(s, 0.85) },
  { file: "apple-touch-icon.png", size: 180, html: (s) => bleed(s, 1) },
];

function tile(size) {
  return `<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body>`;
}

function bleed(size, scale) {
  const inner = Math.round(size * scale);
  return `<body style="margin:0;width:${size}px;height:${size}px;display:grid;place-items:center;background:${BRAND}">${glyph.replace("<svg ", `<svg width="${inner}" height="${inner}" style="display:block" `)}</body>`;
}

mkdirSync("public/icons", { recursive: true });
const browser = await chromium.launch();
try {
  for (const icon of ICONS) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 });
    await page.setContent(icon.html(icon.size));
    await page.screenshot({ path: `public/icons/${icon.file}`, omitBackground: true });
    await page.close();
    console.log(`public/icons/${icon.file}`);
  }
} finally {
  await browser.close();
}
