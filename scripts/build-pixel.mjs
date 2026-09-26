// Builds pixel/al.ts -> public/p/al.js (minified) and fails if it exceeds 5 KB gzipped.
import { build } from "esbuild";
import { mkdirSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const out = "public/p/al.js";
mkdirSync("public/p", { recursive: true });
await build({
  entryPoints: ["pixel/al.ts"],
  outfile: out,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2018"],
  legalComments: "none",
});
const size = gzipSync(readFileSync(out)).length;
console.log(`pixel: ${out} ${(size / 1024).toFixed(2)} KB gzipped`);
if (size > 5 * 1024) {
  console.error("pixel is larger than 5 KB gzipped");
  process.exit(1);
}
