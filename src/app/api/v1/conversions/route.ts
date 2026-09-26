import { getDb } from "@/lib/db";
import { json, withAuth } from "@/lib/http";
import { importConversions } from "@/lib/imports";

// POST /api/v1/conversions — payments, refunds and leads from any tool (WooCommerce plugin,
// Zapier, Make, your backend). Idempotent on source + external_id.
export const POST = withAuth(async (req, ws) => {
  const body = (await req.json().catch(() => null)) as { events?: unknown } | null;
  if (!body || !Array.isArray(body.events)) return json({ error: "expected { events: [...] }" }, 400);
  if (body.events.length > 5_000) return json({ error: "send at most 5,000 events per request" }, 413);
  const db = await getDb();
  const result = await importConversions(db, ws, body.events as never[]);
  const stored = result.revenue + result.leads;
  return json({ ok: result.errors.length === 0, ...result }, stored === 0 && result.errors.length ? 422 : 200);
});
