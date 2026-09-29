import { and, desc, eq, sql } from "drizzle-orm";
import { decrypt, encrypt } from "../crypto";
import { schema, type DB } from "../db";
import type { WebhookEventType } from "../db/schema";
import { allowPrivateUrls, checkOutboundUrl } from "../net";
import { getAppSecret } from "../settings";
import { isWebhookEvent, WEBHOOK_EVENT_TYPES } from "./catalog";
import { invalidateWebhookSubscribers } from "./emit";
import { newWebhookSecret } from "./signature";

// Webhook endpoints: validation and storage. Permission checks and audit entries live in the
// server actions (src/app/actions/developers.ts); everything here is scoped to one workspace.

export const MAX_ENDPOINTS = 20;

export type EndpointInput = { url: string; description: string; events: WebhookEventType[]; includePii: boolean };

export class EndpointError extends Error {}

/** Parse and check a form's endpoint fields. Throws EndpointError with a message to show. */
export async function parseEndpointInput(raw: { url: unknown; description: unknown; events: unknown[]; includePii: unknown }): Promise<EndpointInput> {
  const url = String(raw.url ?? "").trim();
  if (!url) throw new EndpointError("Paste the URL that should receive events.");
  if (url.length > 2000) throw new EndpointError("That URL is too long.");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new EndpointError("That doesn't look like a URL. It should start with https://");
  }
  // Events carry personal data: plain http only where private URLs are allowed (local development).
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && allowPrivateUrls())) {
    throw new EndpointError("Use an https:// URL so events are encrypted in transit.");
  }
  const blocked = await checkOutboundUrl(url);
  if (blocked) throw new EndpointError(blocked);
  const events = WEBHOOK_EVENT_TYPES.filter((t) => raw.events.some((e) => e === t));
  if (!events.length || raw.events.some((e) => !isWebhookEvent(e))) throw new EndpointError("Pick at least one event to send.");
  const description = String(raw.description ?? "").trim().slice(0, 200);
  const includePii = raw.includePii === true || raw.includePii === "on" || raw.includePii === "true";
  return { url, description, events, includePii };
}

export async function listEndpoints(db: DB, workspaceId: string) {
  const d = schema.webhookDeliveries;
  const e = schema.webhookEndpoints;
  // Health over the last 24 hours, for the list.
  const since = sql`now() - interval '24 hours'`;
  return db
    .select({
      id: e.id,
      url: e.url,
      description: e.description,
      events: e.events,
      enabled: e.enabled,
      includePii: e.includePii,
      createdAt: e.createdAt,
      delivered24h: sql<number>`(select count(*)::int from ${d} where ${d.endpointId} = ${e.id} and ${d.status} = 'delivered' and ${d.createdAt} > ${since})`,
      failed24h: sql<number>`(select count(*)::int from ${d} where ${d.endpointId} = ${e.id} and ${d.status} = 'failed' and ${d.createdAt} > ${since})`,
      pending: sql<number>`(select count(*)::int from ${d} where ${d.endpointId} = ${e.id} and ${d.status} = 'pending')`,
      lastDeliveryAt: sql<Date | null>`(select max(${d.lastAttemptAt}) from ${d} where ${d.endpointId} = ${e.id})`,
    })
    .from(e)
    .where(eq(e.workspaceId, workspaceId))
    .orderBy(desc(e.createdAt));
}

export async function getEndpoint(db: DB, workspaceId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.workspaceId, workspaceId), eq(schema.webhookEndpoints.id, id)));
  return row ?? null;
}

/** Create an endpoint with a fresh signing secret. Returns the row and the secret (shown once). */
export async function createEndpoint(db: DB, workspaceId: string, input: EndpointInput, createdBy: string | null) {
  const count = await db.$count(schema.webhookEndpoints, eq(schema.webhookEndpoints.workspaceId, workspaceId));
  if (count >= MAX_ENDPOINTS) throw new EndpointError(`A workspace can have at most ${MAX_ENDPOINTS} webhook endpoints.`);
  const secret = newWebhookSecret();
  const [row] = await db
    .insert(schema.webhookEndpoints)
    .values({ workspaceId, url: input.url, description: input.description, events: input.events, includePii: input.includePii, secretEnc: encrypt(secret, await getAppSecret(db)), createdBy })
    .returning();
  invalidateWebhookSubscribers(workspaceId);
  return { endpoint: row, secret };
}

export async function updateEndpoint(db: DB, workspaceId: string, id: string, patch: Partial<EndpointInput & { enabled: boolean }>) {
  const [row] = await db
    .update(schema.webhookEndpoints)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.webhookEndpoints.workspaceId, workspaceId), eq(schema.webhookEndpoints.id, id)))
    .returning();
  invalidateWebhookSubscribers(workspaceId);
  return row ?? null;
}

export async function deleteEndpoint(db: DB, workspaceId: string, id: string) {
  const gone = await db
    .delete(schema.webhookEndpoints)
    .where(and(eq(schema.webhookEndpoints.workspaceId, workspaceId), eq(schema.webhookEndpoints.id, id)))
    .returning({ id: schema.webhookEndpoints.id });
  invalidateWebhookSubscribers(workspaceId);
  return gone.length > 0;
}

/** Replace the signing secret. The old one stops working immediately. */
export async function rollEndpointSecret(db: DB, workspaceId: string, id: string) {
  const secret = newWebhookSecret();
  const row = await db
    .update(schema.webhookEndpoints)
    .set({ secretEnc: encrypt(secret, await getAppSecret(db)), updatedAt: new Date() })
    .where(and(eq(schema.webhookEndpoints.workspaceId, workspaceId), eq(schema.webhookEndpoints.id, id)))
    .returning({ id: schema.webhookEndpoints.id });
  return row.length ? secret : null;
}

export async function revealEndpointSecret(db: DB, endpoint: Pick<typeof schema.webhookEndpoints.$inferSelect, "secretEnc">) {
  return decrypt(endpoint.secretEnc, await getAppSecret(db));
}

/** Recent deliveries of one endpoint, newest first. */
export async function listDeliveries(db: DB, workspaceId: string, endpointId: string, opts: { status?: "delivered" | "failed" | "pending"; limit?: number } = {}) {
  const d = schema.webhookDeliveries;
  return db
    .select()
    .from(d)
    .where(and(eq(d.workspaceId, workspaceId), eq(d.endpointId, endpointId), opts.status ? eq(d.status, opts.status) : undefined))
    .orderBy(desc(d.createdAt))
    .limit(opts.limit ?? 50);
}
