import { and, eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { schema, type DB } from "../db";
import { buildDemoWorld, DAY, isoDate } from "../demo/world";
import { linkVisitor, upsertContact } from "../tracking/identity";
import type { Connection } from "../settings";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

/** The subset of a Stripe Charge we rely on (works for webhooks, API lists and mocks). */
export type ChargeLike = {
  id: string;
  amount: number;
  amount_captured?: number;
  amount_refunded: number;
  currency: string;
  created: number;
  paid?: boolean;
  status?: string;
  payment_intent?: string | { id: string } | null;
  customer?: string | { id: string; email?: string | null; deleted?: boolean } | null;
  billing_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  receipt_email?: string | null;
  metadata?: Record<string, string> | null;
  refunds?: { data?: { created: number }[] } | null;
};

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

async function resolveContact(
  tx: Q,
  workspaceId: string,
  info: { vid?: string | null; email?: string | null; name?: string | null; phone?: string | null; customerId?: string | null; at: Date },
): Promise<string | null> {
  let visitor: typeof schema.visitors.$inferSelect | undefined;
  if (info.vid) {
    [visitor] = await tx
      .select()
      .from(schema.visitors)
      .where(and(eq(schema.visitors.workspaceId, workspaceId), eq(schema.visitors.anonymousId, info.vid)));
    if (visitor?.contactId) return visitor.contactId;
  }
  if (info.email) {
    const c = await upsertContact(tx, workspaceId, { email: info.email, name: info.name, phone: info.phone }, info.at);
    if (c) {
      if (visitor) await linkVisitor(tx, visitor.id, c.id);
      return c.id;
    }
  }
  if (info.customerId) {
    const [c] = await tx
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.workspaceId, workspaceId),
          sql`${schema.contacts.externalIds}->>'stripe_customer_id' = ${info.customerId}`,
        ),
      )
      .limit(1);
    if (c) return c.id;
  }
  return null;
}

async function markCustomer(tx: Q, contactId: string, customerId: string | null) {
  await tx
    .update(schema.contacts)
    .set({
      lifecycle: "customer",
      ...(customerId
        ? { externalIds: sql`${schema.contacts.externalIds} || ${JSON.stringify({ stripe_customer_id: customerId })}::jsonb` }
        : {}),
    })
    .where(eq(schema.contacts.id, contactId));
}

/** Upsert the payment (and cumulative refund) for a charge. Idempotent. */
export async function ingestCharge(db: DB, workspaceId: string, charge: ChargeLike, opts: { refundedAt?: Date } = {}) {
  const succeeded = charge.status ? charge.status === "succeeded" : charge.paid !== false;
  if (!succeeded && !charge.amount_refunded) return { payment: false, refund: false };
  const paymentId = idOf(charge.payment_intent) ?? charge.id;
  const currency = charge.currency.toUpperCase();
  const customer = typeof charge.customer === "object" && charge.customer && !charge.customer.deleted ? charge.customer : null;
  const customerId = idOf(charge.customer);
  const email = charge.billing_details?.email || charge.receipt_email || customer?.email || null;
  const at = new Date(charge.created * 1000);

  return db.transaction(async (tx) => {
    const contactId = await resolveContact(tx, workspaceId, {
      vid: charge.metadata?.adledger_vid,
      email,
      name: charge.billing_details?.name,
      phone: charge.billing_details?.phone,
      customerId,
      at,
    });
    const amount = charge.amount_captured || charge.amount;
    await tx
      .insert(schema.revenueEvents)
      .values({ workspaceId, contactId, source: "stripe", externalId: paymentId, type: "payment", amountMinor: amount, currency, occurredAt: at })
      .onConflictDoUpdate({
        target: [schema.revenueEvents.workspaceId, schema.revenueEvents.source, schema.revenueEvents.externalId],
        set: {
          amountMinor: amount,
          currency,
          occurredAt: at,
          contactId: sql`coalesce(${schema.revenueEvents.contactId}, excluded.contact_id)`,
        },
      });
    if (contactId) await markCustomer(tx, contactId, customerId);

    const refundKey = `refunds:${charge.id}`;
    if (charge.amount_refunded > 0) {
      const lastRefund = Math.max(0, ...(charge.refunds?.data ?? []).map((r) => r.created));
      const refundedAt = lastRefund ? new Date(lastRefund * 1000) : (opts.refundedAt ?? new Date());
      await tx
        .insert(schema.revenueEvents)
        .values({
          workspaceId,
          contactId,
          source: "stripe",
          externalId: refundKey,
          relatedExternalId: paymentId,
          type: "refund",
          amountMinor: -charge.amount_refunded,
          currency,
          occurredAt: refundedAt,
        })
        .onConflictDoUpdate({
          target: [schema.revenueEvents.workspaceId, schema.revenueEvents.source, schema.revenueEvents.externalId],
          set: { amountMinor: -charge.amount_refunded, contactId: sql`coalesce(${schema.revenueEvents.contactId}, excluded.contact_id)` },
        });
    }
    return { payment: true, refund: charge.amount_refunded > 0 };
  });
}

type CheckoutSessionLike = {
  id: string;
  mode?: string;
  payment_status?: string;
  payment_intent?: string | { id: string } | null;
  customer?: string | { id: string } | null;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
  customer_email?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  created: number;
};

/**
 * Checkout sessions carry the visitor id (client_reference_id or metadata.adledger_vid).
 * We use them to link the buyer to their visitor; the money itself comes from the charge.
 */
export async function ingestCheckoutSession(db: DB, workspaceId: string, s: CheckoutSessionLike) {
  const vid = s.metadata?.adledger_vid || s.client_reference_id || null;
  const email = s.customer_details?.email || s.customer_email || null;
  const at = new Date(s.created * 1000);
  await db.transaction(async (tx) => {
    const contactId = await resolveContact(tx, workspaceId, {
      vid,
      email,
      name: s.customer_details?.name,
      phone: s.customer_details?.phone,
      customerId: idOf(s.customer),
      at,
    });
    if (!contactId) return;
    const customerId = idOf(s.customer);
    if (customerId) {
      await tx
        .update(schema.contacts)
        .set({ externalIds: sql`${schema.contacts.externalIds} || ${JSON.stringify({ stripe_customer_id: customerId })}::jsonb` })
        .where(eq(schema.contacts.id, contactId));
    }
    // If the charge arrived first, attach the contact to it now.
    const pi = idOf(s.payment_intent);
    if (pi) {
      await tx
        .update(schema.revenueEvents)
        .set({ contactId })
        .where(
          and(
            eq(schema.revenueEvents.workspaceId, workspaceId),
            eq(schema.revenueEvents.source, "stripe"),
            sql`${schema.revenueEvents.contactId} is null`,
            sql`(${schema.revenueEvents.externalId} = ${pi} or ${schema.revenueEvents.relatedExternalId} = ${pi})`,
          ),
        );
    }
  });
}

export const HANDLED_STRIPE_EVENTS = ["charge.succeeded", "charge.refunded", "checkout.session.completed"] as const;

export async function handleStripeEvent(db: DB, workspaceId: string, event: { type: string; created: number; data: { object: unknown } }) {
  switch (event.type) {
    case "charge.succeeded":
    case "charge.refunded":
    case "charge.captured":
      await ingestCharge(db, workspaceId, event.data.object as ChargeLike, { refundedAt: new Date(event.created * 1000) });
      return true;
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await ingestCheckoutSession(db, workspaceId, event.data.object as CheckoutSessionLike);
      return true;
    default:
      return false;
  }
}

export function stripeClient(apiKey?: string) {
  // The key is only needed for API calls; webhook verification works with any placeholder.
  return new Stripe(apiKey || "sk_test_placeholder", { appInfo: { name: "AdLedger" } });
}

export function verifyStripeSignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature) throw new Error("Missing Stripe-Signature header");
  return stripeClient().webhooks.constructEvent(rawBody, signature, secret);
}

/** Demo charges from the demo world, shaped like Stripe Charge objects. */
export function mockStripeCharges(anchor: string, currency: string, sinceMs: number): ChargeLike[] {
  const world = buildDemoWorld(anchor, currency);
  return world.payments
    .filter((p) => p.at.getTime() >= sinceMs)
    .map((p) => ({
      id: p.chargeId,
      amount: p.amountMinor,
      amount_captured: p.amountMinor,
      amount_refunded: p.refundedMinor,
      currency: p.currency.toLowerCase(),
      created: Math.floor(p.at.getTime() / 1000),
      paid: true,
      status: "succeeded",
      payment_intent: p.paymentIntent,
      customer: p.customerId,
      billing_details: { email: p.email },
      metadata: (p.vid ? { adledger_vid: p.vid } : {}) as Record<string, string>,
      refunds: p.refundedAt ? { data: [{ created: Math.floor(p.refundedAt.getTime() / 1000) }] } : { data: [] },
    }));
}

/** Pull historic charges (and refunds) so revenue appears right after connecting. */
export async function backfillStripe(
  db: DB,
  workspaceId: string,
  conn: Connection,
  opts: { days: number; mock: boolean; currency: string },
): Promise<number> {
  const sinceMs = Date.now() - opts.days * DAY;
  let n = 0;
  if (opts.mock) {
    const anchor = conn.config.demoAnchor || isoDate(new Date());
    for (const ch of mockStripeCharges(anchor, opts.currency, 0)) {
      await ingestCharge(db, workspaceId, ch);
      n++;
    }
    return n;
  }
  if (!conn.secrets.apiKey) throw new Error("Stripe secret key is missing");
  const stripe = stripeClient(conn.secrets.apiKey);
  for await (const ch of stripe.charges.list({
    created: { gte: Math.floor(sinceMs / 1000) },
    limit: 100,
    expand: ["data.customer", "data.refunds"],
  })) {
    await ingestCharge(db, workspaceId, ch as unknown as ChargeLike);
    n++;
  }
  return n;
}
