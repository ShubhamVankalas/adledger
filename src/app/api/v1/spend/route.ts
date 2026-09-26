import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { importSpend } from "@/lib/imports";

// POST /api/v1/spend — push ad spend from any platform (Zapier, Make, n8n, scripts).
// Body: { "rows": [ { "date": "2026-09-01", "campaign_name": "…", "spend": "12.34", … } ] }
export const POST = withAuth(async (req, ws) => {
  const body = (await req.json().catch(() => null)) as { rows?: unknown } | null;
  if (!body || !Array.isArray(body.rows)) return json({ error: "expected { rows: [...] }" }, 400);
  if (body.rows.length > 20_000) return json({ error: "send at most 20,000 rows per request" }, 413);
  const db = await getDb();
  const result = await importSpend(db, ws, body.rows as never[]);
  return json({ ok: result.errors.length === 0, ...result }, result.rows === 0 && result.errors.length ? 422 : 200);
});
