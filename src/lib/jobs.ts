import { recomputeAttribution } from "./attribution";
import { eq, sql } from "drizzle-orm";
import { getDb, isEmbeddedDb, rows, schema } from "./db";
import { log } from "./log";

// In-process background work. AdLedger runs as a single app container, so there
// is no separate queue: jobs are debounced timers, and scheduled jobs use a
// Postgres advisory lock so only one instance runs them if you scale out.

const g = globalThis as unknown as {
  __adledgerTimers?: Map<string, NodeJS.Timeout>;
  __adledgerScheduler?: NodeJS.Timeout[];
};
const timers = (g.__adledgerTimers ??= new Map());

/** Run `fn` once, `delayMs` after the last call with the same key. */
export function debounce(key: string, delayMs: number, fn: () => Promise<unknown>) {
  if (process.env.ADLEDGER_SYNC_JOBS === "1") {
    // Tests: run inline so results are deterministic.
    return fn();
  }
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn().catch((err) => log.error(`job ${key} failed`, err));
    }, delayMs),
  );
}

/** Ask for an attribution recompute soon (collapses bursts of webhooks/events). */
export function requestAttribution(workspaceId: string) {
  return debounce(`attr:${workspaceId}`, 3000, async () => {
    const db = await getDb();
    const { credits } = await recomputeAttribution(db, workspaceId);
    log.info(`attribution recomputed (${credits} credits)`);
  });
}

type Scheduled = { name: string; everyMs: number; run: () => Promise<unknown> };

const HOUR_MS = 3_600_000;

/**
 * Jobs every install runs, appended to the list boot passes in. Modules are imported lazily so
 * jobs.ts stays free of import cycles (alerts → notify → reports).
 */
export const BUILTIN_JOBS: Scheduled[] = [
  {
    // Insights → Alerts: threshold rules and anomaly detection over the last complete days.
    name: "alerts",
    everyMs: HOUR_MS,
    run: async () => (await import("./alerts")).runAlertsAll(),
  },
];

/** Re-check alert rules soon for one workspace (e.g. right after a sync brought new numbers). */
export function requestAlertCheck(workspaceId: string) {
  return debounce(`alerts:${workspaceId}`, 30_000, async () => {
    const [{ runAlerts }, db] = await Promise.all([import("./alerts"), getDb()]);
    const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    if (ws) await runAlerts(db, ws);
  });
}

/** Start interval jobs (plus BUILTIN_JOBS); each tick takes a cluster-wide advisory lock. */
export function startScheduler(jobs: Scheduled[]) {
  if (g.__adledgerScheduler) return;
  const all = [...jobs, ...BUILTIN_JOBS.filter((b) => !jobs.some((j) => j.name === b.name))];
  g.__adledgerScheduler = all.map((job) => {
    const tick = async () => {
      try {
        const db = await getDb();
        if (isEmbeddedDb()) return void (await job.run());
        // Transaction-scoped lock: held on one pooled connection, released automatically.
        await db.transaction(async (tx) => {
          const [lock] = rows<{ ok: boolean }>(
            await tx.execute(sql`select pg_try_advisory_xact_lock(hashtext(${"job:" + job.name})) as ok`),
          );
          if (lock?.ok) await job.run();
        });
      } catch (err) {
        log.error(`scheduled job ${job.name} failed`, err);
      }
    };
    // First run shortly after boot, then on the interval.
    setTimeout(tick, 60_000).unref?.();
    const handle = setInterval(tick, job.everyMs);
    handle.unref?.();
    return handle;
  });
  log.info(`scheduler started: ${all.map((j) => j.name).join(", ")}`);
}
