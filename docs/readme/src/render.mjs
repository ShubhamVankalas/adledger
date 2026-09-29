// Renders the README graphics from the HTML sources in this folder (one headless Chromium).
// Usage (from the repo root): node docs/readme/src/render.mjs
import { chromium } from "@playwright/test";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const pnpm = path.join(root, "node_modules", ".pnpm");
const sharpDir = fs.readdirSync(pnpm).find((d) => d.startsWith("sharp@"));
const sharp = createRequire(path.join(root, "package.json"))(path.join(pnpm, sharpDir, "node_modules", "sharp"));
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..");
const url = (f) => pathToFileURL(path.join(here, f)).href;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1.5 });
  for (const theme of ["dark", "light"]) {
    await page.goto(url("banner.html"));
    await page.evaluate((t) => document.body.classList.toggle("light", t === "light"), theme);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));
    const png = await page.screenshot({ type: "png" });
    await sharp(png).webp({ quality: 88 }).toFile(path.join(out, `banner-${theme}.webp`));
  }
  const cards = await browser.newPage({ viewport: { width: 1520, height: 1900 }, deviceScaleFactor: 1.5 });
  await cards.goto(url("cards.html"));
  await cards.evaluate(() => document.fonts.ready);
  await cards.waitForFunction(() => [...document.images].every((i) => i.complete));
  for (const el of await cards.locator(".card").all()) {
    const id = await el.getAttribute("id");
    const png = await el.screenshot({ type: "png", omitBackground: true });
    await sharp(png).webp({ quality: 86 }).toFile(path.join(out, `card-${id}.webp`));
  }
} finally {
  await browser.close();
}
for (const f of fs.readdirSync(out).filter((f) => f.endsWith(".webp"))) {
  console.log(f, Math.round(fs.statSync(path.join(out, f)).size / 1024) + " KB");
}
