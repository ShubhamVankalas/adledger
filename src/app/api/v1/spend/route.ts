import { getDb } from "@/lib/db";
import { BodyTooLargeError, json, readTextLimited, withAuth } from "@/lib/http";
import { importSpend } from "@/lib/imports";

const MAX_BODY_BYTES = 20 * 1024 * 1024;

// POST /api/v1/spend — push ad spend from any platform (Zapier, Make, n8n, scripts).
// Body: { "rows": [ { "date": "2026-09-01", "campaign_name": "…", "spend": "12.34", … } ] }
export const POST = withAuth(
  async (req, ws) => {
    let body: { rows?: unknown } | null;
    try {
      body = JSON.parse(await readTextLimited(req, MAX_BODY_BYTES)) as { rows?: unknown } | null;
    } catch (err) {
      if (err instanceof BodyTooLargeError) return json({ error: "request body is too large (max 20 MB)" }, 413);
      body = null;
    }
    if (!body || !Array.isArray(body.rows)) return json({ error: "expected { rows: [...] }" }, 400);
    if (body.rows.length > 20_000) return json({ error: "send at most 20,000 rows per request" }, 413);
    const db = await getDb();
    const result = await importSpend(db, ws, body.rows as never[]);
    return json({ ok: result.errors.length === 0, ...result }, result.rows === 0 && result.errors.length ? 422 : 200);
  },
  // Same permission as the CSV import in Settings when called with a dashboard session.
  { permission: "workspace.settings", perMinute: 60 },
);
