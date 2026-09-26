import { eq } from "drizzle-orm";
import { handleStripeEvent, verifyStripeSignature } from "@/lib/connectors/stripe";
import { getDb, schema } from "@/lib/db";
import { json } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { log } from "@/lib/log";
import { getConnection } from "@/lib/settings";

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) return json({ error: "not found" }, 404);
  const db = await getDb();
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) return json({ error: "not found" }, 404);
  const conn = await getConnection(ws.id, "stripe", db);
  const secret = conn?.secrets.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "Stripe webhook secret is not configured" }, 400);

  const raw = await req.text();
  let event;
  try {
    event = verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret);
  } catch {
    return json({ error: "invalid signature" }, 400);
  }
  try {
    const handled = await handleStripeEvent(db, ws.id, event as never);
    if (handled) await requestAttribution(ws.id);
    return json({ received: true, handled });
  } catch (err) {
    log.error(`stripe webhook ${event.type} failed`, err);
    // 500 makes Stripe retry later; ingestion is idempotent.
    return json({ error: "processing failed" }, 500);
  }
}
