import { sql } from "drizzle-orm";
import { getDb, isEmbeddedDb } from "@/lib/db";
import { json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  let db: "ok" | "error" = "ok";
  try {
    const d = await getDb();
    await d.execute(sql`select 1`);
  } catch {
    db = "error";
  }
  const status = db === "ok" ? "ok" : "degraded";
  return json(
    { status, db, database: isEmbeddedDb() ? "embedded" : "postgres", version: process.env.APP_VERSION ?? "0.1.0" },
    status === "ok" ? 200 : 503,
  );
}
