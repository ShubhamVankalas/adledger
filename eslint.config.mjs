import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/p/**",
    // Plain browser/PHP-plugin scripts for other platforms (ES5-style on purpose).
    "integrations/**",
    ".data/**",
    // Agent worktrees (full checkouts of other branches).
    ".claude/**",
  ]),
]);

export default eslintConfig;
