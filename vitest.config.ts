import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "memory://",
      CONNECTOR_MODE: "mock",
      ADLEDGER_SYNC_JOBS: "1",
      APP_SECRET: "test-secret-do-not-use",
    },
  },
});
