import { and, eq, isNull, sql } from "drizzle-orm";
import { EMAIL_RE, hashEmail, hashPhone, normalizeEmail, redactPii } from "../crypto";
import { schema, type DB } from "../db";
import type { ConsentState } from "../db/schema";

export type Traits = { email?: string | null; phone?: string | null; name?: string | null };

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;

/**
 * Find or create a contact by email (preferred) or phone. Contacts are never merged
 * automatically; a phone-only contact stays separate from an email contact.
 */
export async function upsertContact(
  db: Q,
  workspaceId: string,
  traits: Traits,
  at: Date,
): Promise<typeof schema.contacts.$inferSelect | null> {
  const email = traits.email && EMAIL_RE.test(traits.email.trim()) ? normalizeEmail(traits.email) : null;
  const phoneHash = traits.phone && traits.phone.replace(/\D/g, "").length >= 6 ? hashPhone(traits.phone) : null;
  const name = traits.name?.trim().slice(0, 200) || null;

  if (email) {
    const emailHash = hashEmail(email);
    const [row] = await db
      .insert(schema.contacts)
      .values({ workspaceId, email, emailHash, phoneHash, name, firstSeenAt: at })
      .onConflictDoUpdate({
        target: [schema.contacts.workspaceId, schema.contacts.emailHash],
        set: {
          phoneHash: sql`coalesce(${schema.contacts.phoneHash}, excluded.phone_hash)`,
          name: sql`coalesce(${schema.contacts.name}, excluded.name)`,
          firstSeenAt: sql`least(${schema.contacts.firstSeenAt}, excluded.first_seen_at)`,
        },
      })
      .returning();
    return row;
  }
  if (phoneHash) {
    const [existing] = await db
      .select()
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.workspaceId, workspaceId),
          eq(schema.contacts.phoneHash, phoneHash),
          isNull(schema.contacts.emailHash),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const [row] = await db
      .insert(schema.contacts)
      .values({ workspaceId, phoneHash, name, firstSeenAt: at })
      .returning();
    return row;
  }
  return null;
}

/** Link an anonymous visitor to a contact. The first link wins (no silent re-assignment). */
export async function linkVisitor(db: Q, visitorId: string, contactId: string) {
  await db
    .update(schema.visitors)
    .set({ contactId })
    .where(and(eq(schema.visitors.id, visitorId), isNull(schema.visitors.contactId)));
}

export async function recordLead(
  db: Q,
  args: {
    workspaceId: string;
    contactId: string;
    source: "pixel" | "webhook" | "api" | "csv";
    formName?: string | null;
    occurredAt: Date;
    raw: unknown;
  },
) {
  const [lead] = await db
    .insert(schema.leads)
    .values({
      workspaceId: args.workspaceId,
      contactId: args.contactId,
      source: args.source,
      formName: args.formName?.slice(0, 200) ?? null,
      occurredAt: args.occurredAt,
      raw: redactPii(args.raw) as Record<string, unknown>,
    })
    .returning();
  return lead;
}

export type ConsentSignals = { consent?: ConsentState; gpc?: boolean };

/**
 * Find (or create) a visitor by its pixel anonymous id. Consent signals from the pixel are stored
 * on the visitor: an explicit answer (granted / denied) is never overwritten by "unknown", and GPC
 * reflects the latest request (older pixels that don't send it leave it untouched).
 */
export async function upsertVisitor(db: Q, workspaceId: string, anonymousId: string, at: Date, signals: ConsentSignals = {}) {
  const [v] = await db
    .insert(schema.visitors)
    .values({
      workspaceId,
      anonymousId: anonymousId.slice(0, 64),
      firstSeenAt: at,
      lastSeenAt: at,
      consent: signals.consent ?? null,
      gpc: signals.gpc ?? false,
    })
    .onConflictDoUpdate({
      target: [schema.visitors.workspaceId, schema.visitors.anonymousId],
      set: {
        lastSeenAt: sql`greatest(${schema.visitors.lastSeenAt}, excluded.last_seen_at)`,
        firstSeenAt: sql`least(${schema.visitors.firstSeenAt}, excluded.first_seen_at)`,
        consent: sql`coalesce(nullif(excluded.consent, 'unknown'), ${schema.visitors.consent}, excluded.consent)`,
        ...(signals.gpc === undefined ? {} : { gpc: sql`excluded.gpc` }),
      },
    })
    .returning();
  return v;
}

/**
 * Carry an explicit answer from a visitor to its contact (contacts.ads_consent), which is what
 * conversion uploads read. The latest explicit answer wins.
 */
export async function syncContactConsent(db: Q, visitorId: string, consent: "granted" | "denied") {
  await db.execute(sql`
    update contacts set ads_consent = ${consent}
    where id = (select contact_id from visitors where id = ${visitorId})
      and ads_consent is distinct from ${consent}`);
}

/** Pull email/phone/name out of an arbitrary form payload (Typeform, Tally, Webflow, custom). */
export function extractTraits(payload: unknown, mapping: Record<string, string> = {}): Traits & { vid?: string } {
  const out: Traits & { vid?: string } = {};
  const byPath = (path: string): unknown =>
    path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[k] : undefined), payload);

  for (const field of ["email", "phone", "name", "vid"] as const) {
    const p = mapping[field];
    if (p) {
      const v = byPath(p);
      if (typeof v === "string" && v.trim()) out[field] = v.trim();
    }
  }
  const walk = (node: unknown, key: string) => {
    if (typeof node === "string") {
      const v = node.trim();
      const k = key.toLowerCase();
      if (!out.email && EMAIL_RE.test(v)) out.email = v;
      else if (!out.phone && /(phone|mobile|tel|whatsapp)/.test(k) && v.replace(/\D/g, "").length >= 6) out.phone = v;
      else if (!out.name && /^(name|full_?name|your_?name|first_?name)$/.test(k)) out.name = v;
      else if (!out.vid && /^(al_vid|adledger_vid|visitor_id)$/.test(k)) out.vid = v;
      return;
    }
    if (Array.isArray(node)) {
      // Typeform-style answers: [{ field: { ref: "phone" }, type: "phone_number", phone_number: "..." }]
      node.forEach((n) => walk(n, key));
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      const label = [obj.name, obj.label, obj.key, (obj.field as Record<string, unknown> | undefined)?.ref]
        .find((x) => typeof x === "string") as string | undefined;
      if (label && typeof obj.value === "string") walk(obj.value, label);
      for (const [k, v] of Object.entries(obj)) walk(v, k);
    }
  };
  walk(payload, "");
  return out;
}
