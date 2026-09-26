import { eq } from "drizzle-orm";
import { getCrmConnector } from "@/lib/connectors/crm/index";
import { ingestRevenue } from "@/lib/connectors/revenue/ingest";
import { getDb, schema } from "@/lib/db";
import { BodyTooLargeError, clientIp, json, rateLimit, readTextLimited } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { log } from "@/lib/log";
import { getConnection } from "@/lib/settings";

// CRM deal webhooks: /api/v1/webhooks/crm/{hubspot|pipedrive}/{workspaceId}
// CRM webhooks only carry deal ids, so after verifying the call we re-read those deals through
// the CRM's API and ingest the won ones (idempotent on deal id). Non-won deals are ignored.

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ provider: string; workspaceId: string }> }) {
  const { provider, workspaceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return json({ error: "not found" }, 404);
  if (!rateLimit(`crmhook:${clientIp(req)}`, 600)) return json({ error: "rate limited" }, 429);
  const connector = getCrmConnector(provider);
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
  const request = { rawBody, headers: req.headers, url: req.url };
  const c = { config: conn.config, secrets: conn.secrets };
  let valid = false;
  try {
    valid = await connector.verifyWebhook(request, c);
  } catch (err) {
    log.warn(`${provider} webhook verification error`, err);
  }
  if (!valid) return json({ error: "invalid signature" }, 401);

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  try {
    const ids = connector.webhookDealIds(payload);
    const events = ids.length ? await connector.fetchDeals(c, ids) : [];
    const stored = events.length ? await ingestRevenue(db, ws.id, connector.source, events) : 0;
    if (stored) await requestAttribution(ws.id);
    return json({ received: true, deals: ids.length, stored });
  } catch (err) {
    log.error(`${provider} webhook processing failed`, err);
    // 500 lets the CRM retry; ingestion is idempotent.
    return json({ error: "processing failed" }, 500);
  }
}
