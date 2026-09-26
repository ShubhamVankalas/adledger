import { and, desc, eq, gte, sql } from "drizzle-orm";
import { WHATSAPP_CLICK_EVENT, type WhatsAppInbound } from "../connectors/leads-whatsapp";
import { schema, type DB } from "../db";
import { linkVisitor, recordLead, upsertContact } from "./identity";

// Turns inbound WhatsApp messages that carry a pixel reference code into leads.
// Reference codes live in the `whatsapp_click` event's properties (no extra table).

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

/** How long after the click a reference code still links a conversation to the visitor. */
export const REF_TTL_MS = 30 * 86_400_000;

/** The visitor whose `whatsapp_click` produced `ref` (most recent within the TTL), or null. */
export async function findVisitorByRef(db: Q, workspaceId: string, ref: string, at: Date = new Date()): Promise<string | null> {
  const [row] = await db
    .select({ visitorId: schema.events.visitorId })
    .from(schema.events)
    .where(
      and(
        eq(schema.events.workspaceId, workspaceId),
        eq(schema.events.type, "custom"),
        eq(schema.events.name, WHATSAPP_CLICK_EVENT),
        gte(schema.events.occurredAt, new Date(at.getTime() - REF_TTL_MS)),
        sql`${schema.events.properties}->>'ref' = ${ref}`,
      ),
    )
    .orderBy(desc(schema.events.occurredAt))
    .limit(1);
  return row?.visitorId ?? null;
}

export type WhatsAppIngestResult = { leads: number; linked: number; skipped: number };

/**
 * One lead per reference code: upsert the contact by (hashed) phone, link the visitor that
 * generated the code, record a "WhatsApp" lead. Idempotent — webhook retries and follow-up
 * messages quoting the same code don't create duplicates. Messages without a code are ignored.
 */
export async function ingestWhatsAppMessages(db: DB, workspaceId: string, messages: WhatsAppInbound[]): Promise<WhatsAppIngestResult> {
  const result: WhatsAppIngestResult = { leads: 0, linked: 0, skipped: 0 };
  for (const m of messages) {
    const ref = m.ref;
    if (!ref) {
      result.skipped++;
      continue;
    }
    await db.transaction(async (tx) => {
      const [dupe] = await tx
        .select({ id: schema.leads.id })
        .from(schema.leads)
        .where(and(eq(schema.leads.workspaceId, workspaceId), eq(schema.leads.formName, "WhatsApp"), sql`${schema.leads.raw}->>'ref' = ${ref}`))
        .limit(1);
      if (dupe) {
        result.skipped++;
        return;
      }
      const contact = await upsertContact(tx, workspaceId, { phone: m.from, name: m.name }, m.occurredAt);
      if (!contact) {
        result.skipped++;
        return;
      }
      const visitorId = await findVisitorByRef(tx, workspaceId, ref, m.occurredAt);
      if (visitorId) {
        await linkVisitor(tx, visitorId, contact.id);
        result.linked++;
      }
      await recordLead(tx, {
        workspaceId,
        contactId: contact.id,
        source: "webhook",
        formName: "WhatsApp",
        occurredAt: m.occurredAt,
        // No message text or numbers: only what's needed for dedupe and debugging.
        raw: { channel: "whatsapp", ref, message_id: m.messageId, visitor_matched: Boolean(visitorId) },
      });
      result.leads++;
    });
  }
  return result;
}
