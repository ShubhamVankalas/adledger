import { and, eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { schema, type DB } from "../db";
import { buildDemoWorld, DAY, isoDate } from "../demo/world";
import { ingestRevenue, resolveRevenueContact } from "./revenue/ingest";
import type { IntegrationMeta, RevenueEventInput } from "./types";
import type { Connection } from "../settings";


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

/** Convert a Stripe charge into revenue events (payment + cumulative refund). */
export function chargeToEvents(charge: ChargeLike, opts: { refundedAt?: Date } = {}): RevenueEventInput[] {
  const succeeded = charge.status ? charge.status === "succeeded" : charge.paid !== false;
  if (!succeeded && !charge.amount_refunded) return [];
  const paymentId = idOf(charge.payment_intent) ?? charge.id;
  const customer = typeof charge.customer === "object" && charge.customer && !charge.customer.deleted ? charge.customer : null;
  const who = {
    email: charge.billing_details?.email || charge.receipt_email || customer?.email || null,
    name: charge.billing_details?.name ?? null,
    phone: charge.billing_details?.phone ?? null,
    visitorId: charge.metadata?.adledger_vid ?? null,
    externalCustomerId: idOf(charge.customer),
  };
  const events: RevenueEventInput[] = [
    {
      type: "payment",
      externalId: paymentId,
      amountMinor: charge.amount_captured || charge.amount,
      currency: charge.currency,
      occurredAt: new Date(charge.created * 1000),
      customer: who,
    },
  ];
  if (charge.amount_refunded > 0) {
    const lastRefund = Math.max(0, ...(charge.refunds?.data ?? []).map((r) => r.created));
    events.push({
      type: "refund",
      // Cumulative refund total per charge: partial refunds update the same row.
      externalId: `refunds:${charge.id}`,
      relatedExternalId: paymentId,
      amountMinor: charge.amount_refunded,
      currency: charge.currency,
      occurredAt: lastRefund ? new Date(lastRefund * 1000) : (opts.refundedAt ?? new Date()),
      customer: who,
    });
  }
  return events;
}

/** Upsert the payment (and cumulative refund) for a charge. Idempotent. */
export async function ingestCharge(db: DB, workspaceId: string, charge: ChargeLike, opts: { refundedAt?: Date } = {}) {
  const events = chargeToEvents(charge, opts);
  await ingestRevenue(db, workspaceId, "stripe", events);
  return { payment: events.some((e) => e.type === "payment"), refund: events.some((e) => e.type === "refund") };
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
    const contactId = await resolveRevenueContact(tx, workspaceId, "stripe", {
      visitorId: vid,
      email,
      name: s.customer_details?.name,
      phone: s.customer_details?.phone,
      externalCustomerId: idOf(s.customer),
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

export const stripeIntegration: IntegrationMeta = {
  provider: "stripe",
  name: "Stripe",
  category: "revenue",
  description: "Payments, renewals and refunds via webhooks, plus a 90-day backfill.",
  status: "stable",
  color: "#635bff",
  docsUrl: "https://dashboard.stripe.com/apikeys",
  fields: [
    { name: "apiKey", label: "Secret or restricted key", secret: true, placeholder: "rk_live_… or sk_test_…", hint: "Read access to Charges, Customers and Checkout Sessions is enough." },
    { name: "webhookSecret", label: "Webhook signing secret", secret: true, placeholder: "whsec_…", optional: true, hint: "Leave empty — AdLedger creates the webhook in Stripe for you when this install has a public https address." },
  ],
  steps: [
    "In Stripe open Developers → API keys (use Test mode to try it free) and copy the Secret key (sk_…).",
    "Paste it below and click Connect. AdLedger imports the last 90 days and creates the webhook in Stripe automatically.",
    "Prefer least privilege? Use a restricted key with Read on Charges, Customers, Checkout Sessions and Write on Webhook Endpoints.",
  ],
};

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

/**
 * Create (or replace) AdLedger's webhook endpoint in the merchant's Stripe account so the
 * user only has to paste an API key. Returns the signing secret, or an explanation when the
 * install isn't reachable from the internet (Stripe needs a public https URL).
 */
export async function ensureStripeWebhook(apiKey: string, url: string): Promise<{ secret: string } | { error: string }> {
  if (!/^https:\/\//.test(url) || /\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(url)) {
    return { error: "Stripe can only send webhooks to a public https address. Payments are still imported with “Sync now”; for local testing use the Stripe CLI." };
  }
  try {
    const stripe = stripeClient(apiKey);
    // A signing secret is only returned on creation, so replace any previous AdLedger endpoint.
    for await (const ep of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (ep.url === url) await stripe.webhookEndpoints.del(ep.id);
    }
    const created = await stripe.webhookEndpoints.create({
      url,
      enabled_events: [...HANDLED_STRIPE_EVENTS],
      description: "AdLedger — revenue attribution",
    });
    return created.secret ? { secret: created.secret } : { error: "Stripe didn't return a signing secret." };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Couldn't create the webhook automatically (${msg.slice(0, 160)}). Add it by hand, or give the key “Webhook Endpoints: Write” permission.` };
  }
}
