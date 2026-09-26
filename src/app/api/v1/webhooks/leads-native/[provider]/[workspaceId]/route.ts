import { eq } from "drizzle-orm";
import { getLeadConnector } from "@/lib/connectors/leads/index";
import { ingestNativeLeads } from "@/lib/connectors/leads/ingest";
import { parseJsonLossless } from "@/lib/connectors/leads/shared";
import { getDb, schema } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { log } from "@/lib/log";
import { forcedMockMode, getConnection } from "@/lib/settings";

// Native ad-platform lead forms: /api/v1/webhooks/leads-native/{meta_leads|google_ads_leads|tiktok_leads}/{workspaceId}
// Each lead becomes a contact + lead + a touchpoint on the ad that collected it.

type Ctx = { params: Promise<{ provider: string; workspaceId: string }> };

async function load(provider: string, workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return { error: json({ error: "not found" }, 404) };
  const connector = getLeadConnector(provider);
  if (!connector) return { error: json({ error: "unknown provider" }, 404) };
  const db = await getDb();
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return { error: json({ error: "not found" }, 404) };
  const conn = await getConnection(ws.id, provider, db);
  if (!conn || !conn.enabled) return { error: json({ error: `${connector.meta.name} is not connected in this workspace` }, 400) };
  return { db, ws, connector, conn };
}

/** Subscription handshake (Meta: hub.mode=subscribe&hub.verify_token=…&hub.challenge=…). */
export async function GET(req: Request, { params }: Ctx) {
  const { provider, workspaceId } = await params;
  if (!rateLimit(`nativelead:${clientIp(req)}`, 120)) return json({ error: "rate limited" }, 429);
  const r = await load(provider, workspaceId);
  if (r.error) return r.error;
  const challenge = r.connector.verifyChallenge?.(new URL(req.url).searchParams, { config: r.conn.config, secrets: r.conn.secrets });
  if (!challenge) return json({ error: "verification failed" }, 403);
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: Request, { params }: Ctx) {
  const { provider, workspaceId } = await params;
  if (!rateLimit(`nativelead:${clientIp(req)}`, 600)) return json({ error: "rate limited" }, 429);
  const r = await load(provider, workspaceId);
  if (r.error) return r.error;
  const { db, ws, connector, conn } = r;

  const rawBody = await req.text();
  const request = { rawBody, headers: req.headers, url: req.url };
  const like = { config: conn.config, secrets: conn.secrets };
  let valid = false;
  try {
    valid = await connector.verifyWebhook(request, like);
  } catch (err) {
    log.warn(`${provider} lead webhook verification error`, err);
  }
  if (!valid) return json({ error: "invalid signature" }, 401);

  let payload: unknown;
  try {
    payload = rawBody ? parseJsonLossless(rawBody) : {};
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  try {
    const leads = await connector.parseWebhook(payload, request, { conn: like, mock: forcedMockMode() || conn.mode === "mock" });
    const result = leads.length ? await ingestNativeLeads(db, ws.id, connector, leads) : { stored: 0, duplicates: 0, skipped: 0 };
    if (result.stored) await requestAttribution(ws.id);
    return json({ received: true, stored: result.stored, duplicates: result.duplicates, skipped: result.skipped });
  } catch (err) {
    log.error(`${provider} lead webhook processing failed`, err);
    // 500 lets the platform retry; ingestion is idempotent on the platform's lead id.
    return json({ error: "processing failed" }, 500);
  }
}
