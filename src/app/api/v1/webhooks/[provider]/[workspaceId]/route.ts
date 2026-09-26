import { eq } from "drizzle-orm";
import { getRevenueConnector } from "@/lib/connectors/registry";
import { ingestRevenue } from "@/lib/connectors/revenue/ingest";
import { getDb, schema } from "@/lib/db";
import { BodyTooLargeError, clientIp, json, rateLimit, readTextLimited } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { log } from "@/lib/log";
import { getConnection } from "@/lib/settings";

// Revenue webhooks for every non-Stripe source: /api/v1/webhooks/{shopify|woocommerce|paddle|…}/{workspaceId}
// Signatures are HMACs compared in constant time (see connectors/revenue/shared.ts); schemes that
// sign a timestamp (Paddle, PayPal) also reject old events. Ingestion is idempotent on the
// provider's order/event id, so replaying an HMAC-only delivery cannot double-count revenue.

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ provider: string; workspaceId: string }> }) {
  const { provider, workspaceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return json({ error: "not found" }, 404);
  if (!rateLimit(`revhook:${clientIp(req)}`, 600)) return json({ error: "rate limited" }, 429);
  const connector = getRevenueConnector(provider);
  if (!connector) return json({ error: "unknown provider" }, 404);
  const db = await getDb();
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return json({ error: "not found" }, 404);
  const conn = await getConnection(ws.id, provider, db);
  if (!conn || !conn.enabled) return json({ error: `${connector.meta.name} is not connected in this workspace` }, 400);

  let rawBody: string;
  try {
    rawBody = await readTextLimited(req, MAX_BODY_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return json({ error: "payload too large" }, 413);
    throw err;
  }
  // WooCommerce pings a new webhook with a form body `webhook_id=N`; acknowledge it so it activates.
  if (/^webhook_id=\d+$/.test(rawBody.trim())) return json({ received: true, ping: true });
  const request = { rawBody, headers: req.headers, url: req.url };
  let valid = false;
  try {
    valid = await connector.verifyWebhook(request, { config: conn.config, secrets: conn.secrets });
  } catch (err) {
    log.warn(`${provider} webhook verification error`, err);
  }
  if (!valid) return json({ error: "invalid signature" }, 401);

  try {
    // JSON bodies are parsed; a urlencoded body (Instamojo, Gumroad) becomes a field object, even when
    // the content-type is missing or generic. Non-JSON sources (Instamojo, Gumroad, Recurly XML) read
    // `request.rawBody` themselves, so a body that fails to parse is passed through as-is.
    const ct = req.headers.get("content-type") ?? "";
    const trimmed = rawBody.trimStart();
    let payload: unknown = {};
    if (!trimmed) {
      // Empty body: nothing to parse.
    } else if (/application\/x-www-form-urlencoded/i.test(ct) || !/^[[{<]/.test(trimmed)) {
      payload = Object.fromEntries(new URLSearchParams(rawBody));
    } else {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        payload = rawBody;
      }
    }
    const events = connector.parseWebhook(payload, request);
    const stored = events.length ? await ingestRevenue(db, ws.id, connector.source, events) : 0;
    if (stored) await requestAttribution(ws.id);
    return json({ received: true, stored });
  } catch (err) {
    log.error(`${provider} webhook processing failed`, err);
    // 500 lets the platform retry; ingestion is idempotent.
    return json({ error: "processing failed" }, 500);
  }
}
