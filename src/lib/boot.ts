import { desc, eq } from "drizzle-orm";
import { generateReport } from "./ai/report";
import { getDb, isEmbeddedDb, schema } from "./db";
import { requestAttribution, startScheduler } from "./jobs";
import { createAdmin, hasUsers } from "./auth";
import { hashPassword } from "./crypto";
import { seedDemo } from "./demo/seed";
import { log } from "./log";
import { getAppSecret } from "./settings";
import { syncAll } from "./sync";

const HOUR = 3_600_000;

export async function boot() {
  const db = await getDb(); // applies pending migrations
  await getAppSecret(db);
  log.info(`AdLedger ready (${isEmbeddedDb() ? "embedded database" : "PostgreSQL"})`);
  if (!process.env.APP_SECRET) {
    log.warn("APP_SECRET is not set; using a generated secret stored in the database. Set APP_SECRET for stronger protection of stored API keys.");
  }
  await bootstrapFromEnv();
  // Recompute attribution once per boot so upgrades that change attribution logic apply to old data.
  for (const ws of await db.select({ id: schema.workspaces.id }).from(schema.workspaces)) requestAttribution(ws.id);
  if (process.env.DISABLE_SCHEDULER === "true") return;

  startScheduler([
    {
      name: "ad-sync",
      everyMs: Number(process.env.SYNC_INTERVAL_HOURS ?? 6) * HOUR,
      run: async () => {
        for (const ws of await db.select().from(schema.workspaces)) await syncAll(db, ws.id);
      },
    },
    {
      // Weekly insights: checked hourly, generated when the latest is older than 7 days.
      name: "weekly-insights",
      everyMs: HOUR,
      run: async () => {
        for (const ws of await db.select().from(schema.workspaces)) {
          const [last] = await db
            .select({ at: schema.aiReports.createdAt })
            .from(schema.aiReports)
            .where(eq(schema.aiReports.workspaceId, ws.id))
            .orderBy(desc(schema.aiReports.createdAt))
            .limit(1);
          if (last && Date.now() - last.at.getTime() < 7 * 24 * HOUR) continue;
          const [hasData] = await db.select({ id: schema.adInsightsDaily.id }).from(schema.adInsightsDaily).where(eq(schema.adInsightsDaily.workspaceId, ws.id)).limit(1);
          if (hasData) await generateReport(db, ws);
        }
      },
    },
  ]);
}

/**
 * Headless installs: if ADMIN_EMAIL + ADMIN_PASSWORD are set and nobody has signed up yet,
 * create the workspace and admin automatically (optionally with DEMO_DATA=true).
 */
async function bootstrapFromEnv() {
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const db = await getDb();
  if (password.length < 8) {
    log.warn("ADMIN_PASSWORD must be at least 8 characters; ignoring it");
    return;
  }
  if (await hasUsers(db)) {
    // Forgot your password? Set ADMIN_EMAIL, ADMIN_PASSWORD and RESET_PASSWORD=true, then restart.
    if (process.env.RESET_PASSWORD === "true") {
      const updated = await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(schema.users.email, email.toLowerCase()))
        .returning({ id: schema.users.id });
      log.warn(updated.length ? "admin password was reset from ADMIN_PASSWORD — remove RESET_PASSWORD now" : "RESET_PASSWORD: no user with ADMIN_EMAIL");
    }
    return;
  }
  const name = process.env.WORKSPACE_NAME?.trim() || "My business";
  const [ws] = await db
    .insert(schema.workspaces)
    .values({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace",
      reportingCurrency: (process.env.REPORTING_CURRENCY || "USD").toUpperCase(),
      timezone: process.env.TIMEZONE || "UTC",
    })
    .returning();
  await createAdmin(db, ws.id, email, password, "Admin");
  log.info("created workspace and admin from ADMIN_EMAIL / ADMIN_PASSWORD");
  // Seed in the background so the server starts answering immediately.
  if (process.env.DEMO_DATA === "true") {
    seedDemo(db, ws.id).then(
      () => log.info("demo data loaded"),
      (err) => log.error("demo seed failed", err),
    );
  }
}
