import { and, eq, sql } from "drizzle-orm";
import { schema, type DB } from "../../db";
import { linkVisitor, upsertContact } from "../../tracking/identity";
import { formatMoney } from "../../money";
import { notifyLater } from "../../notify";
import { autoWinOnPayment } from "../../pipeline";
import type { RevenueEventInput } from "../types";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

/** Resolve the paying person: visitor id -> email -> external customer id. */
export async function resolveRevenueContact(
  tx: Q,
  workspaceId: string,
  source: string,
  info: RevenueEventInput["customer"] & { at: Date },
): Promise<string | null> {
  let visitor: typeof schema.visitors.$inferSelect | undefined;
  if (info.visitorId) {
    [visitor] = await tx
      .select()
      .from(schema.visitors)
      .where(and(eq(schema.visitors.workspaceId, workspaceId), eq(schema.visitors.anonymousId, info.visitorId)));
    if (visitor?.contactId) return visitor.contactId;
  }
  if (info.email) {
    const c = await upsertContact(tx, workspaceId, { email: info.email, name: info.name, phone: info.phone }, info.at);
    if (c) {
      if (visitor) await linkVisitor(tx, visitor.id, c.id);
      return c.id;
    }
  }
  if (info.externalCustomerId) {
    const key = `${source}_customer_id`;
    const [c] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, workspaceId), sql`${schema.contacts.externalIds}->>${key} = ${info.externalCustomerId}`))
      .limit(1);
    if (c) return c.id;
  }
  if (info.phone) {
    const c = await upsertContact(tx, workspaceId, { phone: info.phone, name: info.name }, info.at);
    if (c) {
      if (visitor) await linkVisitor(tx, visitor.id, c.id);
      return c.id;
    }
  }
  return null;
}

export async function markCustomer(tx: Q, contactId: string, source: string, externalCustomerId?: string | null) {
  await tx
    .update(schema.contacts)
    .set({
      lifecycle: "customer",
      ...(externalCustomerId
        ? { externalIds: sql`${schema.contacts.externalIds} || ${JSON.stringify({ [`${source}_customer_id`]: externalCustomerId })}::jsonb` }
        : {}),
    })
    .where(eq(schema.contacts.id, contactId));
}

/**
 * Store a payment or refund from any source. Idempotent on (workspace, source, externalId):
 * replays update the amount and fill in a missing contact, never duplicate, and never re-notify.
 */
export async function ingestRevenue(db: DB, workspaceId: string, source: string, events: RevenueEventInput[]) {
  let stored = 0;
  const alerts: { kind: "new_customer" | "big_payment"; e: RevenueEventInput; contactId: string | null; name: string | null }[] = [];
  for (const e of events) {
    if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor < 0) throw new Error(`Invalid amount for ${source} ${e.externalId}`);
    await db.transaction(async (tx) => {
      const contactId = await resolveRevenueContact(tx, workspaceId, source, { ...e.customer, at: e.occurredAt });
      const amount = e.type === "refund" ? -e.amountMinor : e.amountMinor;
      const currency = e.currency.toUpperCase();
      // `xmax = 0` only for a freshly inserted row: a replayed webhook updates it instead, and must not re-notify.
      const [row] = await tx
        .insert(schema.revenueEvents)
        .values({
          workspaceId,
          contactId,
          source,
          externalId: e.externalId,
          relatedExternalId: e.relatedExternalId ?? null,
          type: e.type,
          amountMinor: amount,
          currency,
          occurredAt: e.occurredAt,
        })
        .onConflictDoUpdate({
          target: [schema.revenueEvents.workspaceId, schema.revenueEvents.source, schema.revenueEvents.externalId],
          set: {
            amountMinor: amount,
            currency,
            occurredAt: e.occurredAt,
            contactId: sql`coalesce(${schema.revenueEvents.contactId}, excluded.contact_id)`,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      const isNew = row?.inserted === true;
      if (e.type === "payment") {
        let name: string | null = null;
        if (contactId) {
          const [before] = await tx.select({ lifecycle: schema.contacts.lifecycle, name: schema.contacts.name, email: schema.contacts.email }).from(schema.contacts).where(eq(schema.contacts.id, contactId));
          name = before?.name ?? before?.email ?? null;
          if (isNew && before?.lifecycle !== "customer") alerts.push({ kind: "new_customer", e, contactId, name });
          await markCustomer(tx, contactId, source, e.customer.externalCustomerId);
          // Only a new payment wins the deal: a replayed webhook or re-sync must not undo a later manual move.
          if (isNew && amount > 0) await autoWinOnPayment(tx, workspaceId, contactId, e.occurredAt);
        }
        if (isNew) alerts.push({ kind: "big_payment", e, contactId, name });
      }
    });
    stored++;
  }
  for (const a of alerts) {
    const amount = formatMoney(a.e.amountMinor, a.e.currency.toUpperCase());
    const who = a.name ?? "Someone";
    if (a.kind === "new_customer") {
      notifyLater(workspaceId, "new_customer", () => ({
        title: `New customer: ${who} paid ${amount}`,
        text: `First payment via ${source}. Open the contact to see which ads brought them in.`,
        severity: "success",
        url: a.contactId ? process.env.PUBLIC_URL && `${process.env.PUBLIC_URL.replace(/\/$/, "")}/contacts/${a.contactId}` : undefined,
      }), db);
    } else {
      notifyLater(workspaceId, "big_payment", (settings) => {
        const threshold = Math.round(Number(settings.threshold ?? 1000) * 100);
        if (a.e.amountMinor < threshold) return null;
        return { title: `Large payment: ${amount} from ${who}`, text: `A single ${source} payment of **${amount}** just arrived.`, severity: "success" };
      }, db);
    }
  }
  return stored;
}
