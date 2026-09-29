import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { WHATSAPP_CLICK_EVENT, type WhatsAppInbound } from "../connectors/leads-whatsapp";
import { hashPhone } from "../crypto";
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
 * One lead per reference code: link the conversation to the visitor that generated the code and
 * record a "WhatsApp" lead. If that visitor already identified themselves (e.g. an email form),
 * the lead goes on that contact so it keeps the visitor's ad touchpoints; otherwise a contact is
 * found or created by (hashed) phone. Idempotent — webhook retries and follow-up messages quoting
 * the same code don't create duplicates. Messages without a code are ignored.
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
      // Serialize concurrent deliveries of the same code (Meta retries can overlap a slow response).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`wa:${workspaceId}:${ref}`}))`);
      const [dupe] = await tx
        .select({ id: schema.leads.id })
        .from(schema.leads)
        .where(
          and(
            eq(schema.leads.workspaceId, workspaceId),
            eq(schema.leads.formName, "WhatsApp"),
            // Codes are only unique within the TTL; an old lead with a recycled code isn't a duplicate.
            gte(schema.leads.occurredAt, new Date(m.occurredAt.getTime() - REF_TTL_MS)),
            sql`${schema.leads.raw}->>'ref' = ${ref}`,
          ),
        )
        .limit(1);
      if (dupe) {
        result.skipped++;
        return;
      }
      const visitorId = await findVisitorByRef(tx, workspaceId, ref, m.occurredAt);
      const [visitor] = visitorId
        ? await tx.select({ contactId: schema.visitors.contactId }).from(schema.visitors).where(eq(schema.visitors.id, visitorId))
        : [];
      let contactId = visitor?.contactId ?? null;
      if (contactId) {
        // The visitor is already a known contact: keep the lead (and its touchpoints) on it.
        await tx
          .update(schema.contacts)
          .set({ phoneHash: hashPhone(m.from) })
          .where(and(eq(schema.contacts.id, contactId), isNull(schema.contacts.phoneHash)));
      } else {
        const contact = await upsertContact(tx, workspaceId, { phone: m.from, name: m.name }, m.occurredAt);
        if (!contact) {
          result.skipped++;
          return;
        }
        contactId = contact.id;
        if (visitorId) await linkVisitor(tx, visitorId, contactId);
      }
      if (visitorId) result.linked++;
      await recordLead(tx, {
        workspaceId,
        contactId,
        source: "webhook",
        formName: "WhatsApp",
        occurredAt: m.occurredAt,
        // No message text or numbers: only what's needed for dedupe and debugging.
        raw: { channel: "whatsapp", ref, message_id: m.messageId, visitor_matched: Boolean(visitorId) },
        phone: m.from,
      });
      result.leads++;
    });
  }
  return result;
}
