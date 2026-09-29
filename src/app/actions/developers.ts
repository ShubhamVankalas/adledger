"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { fail, guard, ok, run, str, type ActionResult } from "@/lib/actions";
import { audit } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { UUID_RE } from "@/lib/request-auth";
import { isWebhookEvent } from "@/lib/webhooks/catalog";
import { redeliver, sendTestEvent } from "@/lib/webhooks/deliver";
import {
  createEndpoint,
  deleteEndpoint,
  EndpointError,
  getEndpoint,
  parseEndpointInput,
  revealEndpointSecret,
  rollEndpointSecret,
  updateEndpoint,
} from "@/lib/webhooks/endpoints";

// Developers → Webhooks. Every action needs developers.access (it sends workspace data to outside
// URLs) and is audited. Raw emails and phones in payloads additionally need contacts.pii.

const PII_DENIED = "Only members who can see contact emails can send personal data to a webhook.";

async function readInput(form: FormData) {
  return parseEndpointInput({ url: str(form, "url"), description: str(form, "description"), events: form.getAll("events"), includePii: form.get("includePii") });
}

/** Endpoint host for audit entries (never the full URL: paths and query strings can carry tokens). */
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid URL";
  }
};

const refresh = (id?: string) => {
  revalidatePath("/developers/webhooks");
  if (id) revalidatePath(`/developers/webhooks/${id}`);
};

function withEndpointErrors(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  return run(async () => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof EndpointError) return fail(err.message);
      throw err;
    }
  });
}

export async function createWebhookEndpointAction(form: FormData): Promise<ActionResult> {
  return withEndpointErrors(async () => {
    const user = await guard("developers.access");
    const input = await readInput(form);
    if (input.includePii && !user.can("contacts.pii")) return fail(PII_DENIED);
    const db = await getDb();
    const { endpoint, secret } = await createEndpoint(db, user.workspace.id, input, user.id);
    await audit(user, "webhook.created", hostOf(input.url), { endpointId: endpoint.id, events: input.events, includePii: input.includePii });
    refresh();
    return ok("Endpoint added. Copy the signing secret now.", { id: endpoint.id, secret });
  });
}

export async function updateWebhookEndpointAction(id: string, form: FormData): Promise<ActionResult> {
  return withEndpointErrors(async () => {
    const user = await guard("developers.access");
    if (!UUID_RE.test(id)) return fail("That endpoint no longer exists.");
    const db = await getDb();
    const before = await getEndpoint(db, user.workspace.id, id);
    if (!before) return fail("That endpoint no longer exists.");
    const input = await readInput(form);
    // Turning personal data on needs contacts.pii; keeping it on as it was, or turning it off, doesn't.
    if (input.includePii && !before.includePii && !user.can("contacts.pii")) return fail(PII_DENIED);
    await updateEndpoint(db, user.workspace.id, id, input);
    await audit(user, "webhook.updated", hostOf(input.url), {
      endpointId: id,
      events: input.events,
      includePii: input.includePii,
      ...(before.url !== input.url ? { urlChanged: true } : {}),
    });
    refresh(id);
    return ok("Endpoint saved.");
  });
}

export async function setWebhookEndpointEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("developers.access");
    if (!UUID_RE.test(id)) return fail("That endpoint no longer exists.");
    const row = await updateEndpoint(await getDb(), user.workspace.id, id, { enabled });
    if (!row) return fail("That endpoint no longer exists.");
    await audit(user, enabled ? "webhook.enabled" : "webhook.disabled", hostOf(row.url), { endpointId: id });
    refresh(id);
    return ok(enabled ? "Endpoint turned on." : "Endpoint paused. Nothing is sent until you turn it back on.");
  });
}

export async function deleteWebhookEndpointAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("developers.access");
    if (!UUID_RE.test(id)) return fail("That endpoint no longer exists.");
    const db = await getDb();
    const row = await getEndpoint(db, user.workspace.id, id);
    if (!row || !(await deleteEndpoint(db, user.workspace.id, id))) return fail("That endpoint no longer exists.");
    await audit(user, "webhook.deleted", hostOf(row.url), { endpointId: id });
    refresh();
    return ok("Endpoint deleted, with its delivery log.");
  });
}

export async function rollWebhookSecretAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("developers.access");
    if (!UUID_RE.test(id)) return fail("That endpoint no longer exists.");
    const secret = await rollEndpointSecret(await getDb(), user.workspace.id, id);
    if (!secret) return fail("That endpoint no longer exists.");
    await audit(user, "webhook.secret_rolled", null, { endpointId: id });
    return ok("New signing secret created. The old one stopped working.", { secret });
  });
}

export async function revealWebhookSecretAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("developers.access");
    if (!UUID_RE.test(id)) return fail("That endpoint no longer exists.");
    const db = await getDb();
    const row = await getEndpoint(db, user.workspace.id, id);
    if (!row) return fail("That endpoint no longer exists.");
    await audit(user, "webhook.secret_revealed", null, { endpointId: id });
    return ok(undefined, { secret: await revealEndpointSecret(db, row) });
  });
}

export async function sendWebhookTestAction(id: string, event: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("developers.access");
    if (!UUID_RE.test(id)) return fail("That endpoint no longer exists.");
    if (!isWebhookEvent(event)) return fail("Pick an event to send.");
    const db = await getDb();
    const row = await getEndpoint(db, user.workspace.id, id);
    if (!row) return fail("That endpoint no longer exists.");
    if (!row.enabled) return fail("Turn the endpoint on to send a test event.");
    const d = await sendTestEvent(db, row, event);
    await audit(user, "webhook.test_sent", null, { endpointId: id, event, status: d.responseCode });
    refresh(id);
    return d.status === "delivered"
      ? ok(`Test ${event} delivered (HTTP ${d.responseCode}).`, { deliveryId: d.id })
      : fail(`Test ${event} failed: ${d.lastError ?? "no response"}.`);
  });
}

export async function redeliverWebhookAction(deliveryId: string): Promise<ActionResult> {
  return run(async () => {
    const user = await guard("developers.access");
    if (!UUID_RE.test(deliveryId)) return fail("That delivery no longer exists.");
    const db = await getDb();
    const [original] = await db
      .select()
      .from(schema.webhookDeliveries)
      .where(and(eq(schema.webhookDeliveries.workspaceId, user.workspace.id), eq(schema.webhookDeliveries.id, deliveryId)));
    if (!original) return fail("That delivery no longer exists (logs are kept for 30 days).");
    const d = await redeliver(db, original);
    await audit(user, "webhook.redelivered", null, { endpointId: original.endpointId, event: original.event, eventId: original.eventId, status: d.responseCode });
    refresh(original.endpointId);
    return d.status === "delivered" ? ok(`Delivered again (HTTP ${d.responseCode}).`) : fail(`Redelivery failed: ${d.lastError ?? "no response"}.`);
  });
}
