// Runs once when the server starts: migrate the database and start background jobs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { boot } = await import("./lib/boot");
  await boot();
}
