import { eq } from "drizzle-orm";
import {
  WHATSAPP_PROVIDER,
  parseWhatsAppWebhook,
  verifySubscription,
  verifyWhatsAppSignature,
} from "@/lib/connectors/leads-whatsapp";
import { getDb, schema } from "@/lib/db";
import { clientIp, json, rateLimit } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { log } from "@/lib/log";
import { getConnection } from "@/lib/settings";
import { ingestWhatsAppMessages } from "@/lib/tracking/whatsapp";

// WhatsApp Business Cloud API webhook: /api/v1/webhooks/whatsapp/{workspaceId}
// GET = subscription handshake (hub.verify_token), POST = signed message notifications.

async function connectionFor(workspaceId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return null;
  const db = await getDb();
  const [ws] = await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return null;
  const conn = await getConnection(ws.id, WHATSAPP_PROVIDER, db);
  return conn && conn.enabled ? { db, conn } : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!rateLimit(`wahook:${clientIp(req)}`, 60)) return json({ error: "rate limited" }, 429);
  const found = await connectionFor(workspaceId);
  if (!found) return json({ error: "not found" }, 404);
  const challenge = verifySubscription(new URL(req.url).searchParams, found.conn.secrets.verifyToken);
  if (!challenge) return json({ error: "verification failed" }, 403);
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!rateLimit(`wahook:${clientIp(req)}`, 600)) return json({ error: "rate limited" }, 429);
  const found = await connectionFor(workspaceId);
  if (!found) return json({ error: "not found" }, 404);
  const { db, conn } = found;

  const rawBody = await req.text();
  if (!verifyWhatsAppSignature(rawBody, conn.secrets.appSecret, req.headers.get("x-hub-signature-256"))) {
    return json({ error: "invalid signature" }, 401);
  }

  try {
    const payload = rawBody ? JSON.parse(rawBody) : {};
    const only = conn.config.phoneNumberId?.trim();
    const messages = parseWhatsAppWebhook(payload).filter((m) => !only || m.phoneNumberId === only);
    const r = await ingestWhatsAppMessages(db, workspaceId, messages);
    if (r.leads) await requestAttribution(workspaceId);
    return json({ received: true, leads: r.leads, linked: r.linked });
  } catch (err) {
    // Only the error type: query errors echo their parameters (profile name, phone hash).
    const code = (err as { code?: unknown } | null)?.code;
    log.error("whatsapp webhook processing failed", `${err instanceof Error ? err.name : "Error"}${typeof code === "string" ? ` (${code})` : ""}`);
    // 500 lets Meta retry; ingestion is idempotent per reference code.
    return json({ error: "processing failed" }, 500);
  }
}
