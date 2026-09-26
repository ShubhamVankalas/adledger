// Starts the production server for e2e tests on a fresh embedded database.
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";

rmSync(process.env.DATA_DIR ?? ".data/e2e", { recursive: true, force: true });
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", process.env.PORT ?? "3200"], {
  stdio: "inherit",
  env: process.env,
});
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
