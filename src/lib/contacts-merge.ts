import { and, eq, inArray, sql } from "drizzle-orm";
import { schema, rows, type DB } from "./db";
import { requestAttribution } from "./jobs";
import type { Workspace } from "./settings";

// Duplicate detection and merging (Settings → Import data → Duplicates).
//
// Contacts are never merged automatically: a phone-only lead (a WhatsApp or call form) and the
// email the same person later pays with stay two contacts, which splits their journey and leaves
// the payment unattributed. This finds likely pairs, and a merge moves everything that points at
// one contact (devices, leads, payments, credits, and any table added later with a foreign key to
// contacts) onto the other, then recomputes attribution.

export type DuplicateReason = "same_phone" | "same_email" | "same_name";

export type DuplicateContact = {
  id: string;
  email: string | null;
  hasPhone: boolean;
  name: string | null;
  lifecycle: "lead" | "customer";
  firstSeenAt: string;
  lastActivityAt: string | null;
  devices: number;
  leads: number;
  payments: number;
  revenueMinor: number;
  /** Revenue in currencies other than the reporting currency is left out of revenueMinor. */
  otherCurrencies: boolean;
};

export type DuplicatePair = {
  a: DuplicateContact;
  b: DuplicateContact;
  reasons: DuplicateReason[];
  /** strong: the same phone or email. possible: only the name matches. */
  strength: "strong" | "possible";
  /** Which of the two we suggest keeping: the one with an email, then more history, then the older. */
  suggestedKeepId: string;
};

/** Groups bigger than this are ignored for a reason (a shared office phone, a common name). */
const MAX_GROUP = { phone: 6, email: 6, name: 3 } as const;

/** Candidate pairs (a.id < b.id) with their reasons, strongest first, minus dismissed pairs. */
async function candidatePairs(db: DB, workspaceId: string, limit: number) {
  return rows<{ a_id: string; b_id: string; reasons: DuplicateReason[] }>(
    await db.execute(sql`
      with c as (
        select id, email, phone_hash, first_seen_at,
          case when email is null then null
            when split_part(lower(email), '@', 2) in ('gmail.com', 'googlemail.com')
              then replace(split_part(split_part(lower(email), '@', 1), '+', 1), '.', '') || '@gmail.com'
            else split_part(split_part(lower(email), '@', 1), '+', 1) || '@' || split_part(lower(email), '@', 2)
          end as canon,
          nullif(regexp_replace(lower(btrim(coalesce(name, ''))), '\\s+', ' ', 'g'), '') as nname
        from contacts where workspace_id = ${workspaceId}
      ),
      g as (
        select c.*,
          count(*) over (partition by phone_hash) as n_phone,
          count(*) over (partition by canon) as n_canon,
          count(*) over (partition by nname) as n_name
        from c
      ),
      pairs as (
        select a.id as a_id, b.id as b_id, 'same_phone' as reason
          from g a join g b on a.phone_hash = b.phone_hash and a.id < b.id
          where a.n_phone <= ${MAX_GROUP.phone}
        union all
        select a.id, b.id, 'same_email'
          from g a join g b on a.canon = b.canon and a.id < b.id
          where a.n_canon <= ${MAX_GROUP.email}
        union all
        select a.id, b.id, 'same_name'
          from g a join g b on a.nname = b.nname and a.id < b.id
          where a.n_name <= ${MAX_GROUP.name} and position(' ' in a.nname) > 0 and (a.email is null or b.email is null)
      )
      select p.a_id, p.b_id, array_agg(distinct p.reason order by p.reason) as reasons
      from pairs p
      where not exists (
        select 1 from contact_duplicate_dismissals d
        where d.workspace_id = ${workspaceId} and d.contact_a_id = p.a_id and d.contact_b_id = p.b_id)
      group by p.a_id, p.b_id
      order by bool_or(p.reason <> 'same_name') desc, count(*) desc, p.a_id, p.b_id
      limit ${limit}`),
  ).map((r) => ({ ...r, reasons: parseArray(r.reasons) as DuplicateReason[] }));
}

/** node-postgres returns text[] as an array; PGlite may return the '{a,b}' literal. */
function parseArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") return v.replace(/^\{|\}$/g, "").split(",").filter(Boolean).map((s) => s.replace(/^"|"$/g, ""));
  return [];
}

async function summaries(db: DB, ws: Pick<Workspace, "id" | "reportingCurrency">, ids: string[]): Promise<Map<string, DuplicateContact>> {
  if (!ids.length) return new Map();
  const list = rows<{
    id: string;
    email: string | null;
    has_phone: boolean;
    name: string | null;
    lifecycle: "lead" | "customer";
    first_seen_at: string | Date;
    last_activity_at: string | Date | null;
    devices: string | number;
    leads: string | number;
    payments: string | number;
    revenue_minor: string | number;
    other_currencies: boolean;
  }>(
    await db.execute(sql`
      select c.id, c.email, c.phone_hash is not null as has_phone, c.name, c.lifecycle, c.first_seen_at,
        greatest(v.last_seen, l.last_at, r.last_at) as last_activity_at,
        coalesce(v.n, 0) as devices, coalesce(l.n, 0) as leads, coalesce(r.payments, 0) as payments,
        coalesce(r.revenue, 0) as revenue_minor, coalesce(r.other, false) as other_currencies
      from contacts c
      left join lateral (select count(*) n, max(last_seen_at) last_seen from visitors where contact_id = c.id) v on true
      left join lateral (select count(*) n, max(occurred_at) last_at from leads where contact_id = c.id) l on true
      left join lateral (
        select count(*) filter (where type = 'payment') payments,
          sum(amount_minor) filter (where currency = ${ws.reportingCurrency}) revenue,
          bool_or(currency <> ${ws.reportingCurrency}) other,
          max(occurred_at) last_at
        from revenue_events where contact_id = c.id) r on true
      where c.workspace_id = ${ws.id} and c.id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`),
  );
  const iso = (d: string | Date | null) => (d === null ? null : new Date(d).toISOString());
  return new Map(
    list.map((r) => [
      r.id,
      {
        id: r.id,
        email: r.email,
        hasPhone: Boolean(r.has_phone),
        name: r.name,
        lifecycle: r.lifecycle,
        firstSeenAt: iso(r.first_seen_at)!,
        lastActivityAt: iso(r.last_activity_at),
        devices: Number(r.devices),
        leads: Number(r.leads),
        payments: Number(r.payments),
        revenueMinor: Number(r.revenue_minor),
        otherCurrencies: Boolean(r.other_currencies),
      },
    ]),
  );
}

/** Suggest which contact to keep: the one with an email, then more history, then the older one. */
export function suggestKeep(a: DuplicateContact, b: DuplicateContact): string {
  const score = (c: DuplicateContact) => [c.email ? 1 : 0, c.payments, c.leads + c.devices, -Date.parse(c.firstSeenAt)];
  const sa = score(a);
  const sb = score(b);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] > sb[i] ? a.id : b.id;
  return a.id;
}

/** Likely duplicate pairs in a workspace, strongest first (at most `limit`). */
export async function findDuplicates(db: DB, ws: Pick<Workspace, "id" | "reportingCurrency">, opts: { limit?: number } = {}): Promise<DuplicatePair[]> {
  const pairs = await candidatePairs(db, ws.id, Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const info = await summaries(db, ws, [...new Set(pairs.flatMap((p) => [p.a_id, p.b_id]))]);
  return pairs.flatMap((p) => {
    const a = info.get(p.a_id);
    const b = info.get(p.b_id);
    if (!a || !b) return [];
    return [{ a, b, reasons: p.reasons, strength: p.reasons.some((r) => r !== "same_name") ? "strong" : "possible", suggestedKeepId: suggestKeep(a, b) } satisfies DuplicatePair];
  });
}

/** Remember that two contacts are different people, so the pair stops being suggested. */
export async function dismissDuplicate(db: DB, ws: Pick<Workspace, "id">, idA: string, idB: string): Promise<boolean> {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA];
  const found = await db
    .select({ id: schema.contacts.id })
    .from(schema.contacts)
    .where(and(eq(schema.contacts.workspaceId, ws.id), inArray(schema.contacts.id, [a, b])));
  if (a === b || found.length !== 2) return false;
  await db.insert(schema.contactDuplicateDismissals).values({ workspaceId: ws.id, contactAId: a, contactBId: b }).onConflictDoNothing();
  return true;
}

// ---------------------------------------------------------------- merge

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Columns that reference contacts(id), found in the catalog so tables added later are covered too. */
async function contactReferences(tx: Tx): Promise<{ table: string; column: string }[]> {
  const found = rows<{ tbl: string; col: string }>(
    await tx.execute(sql`
      select cl.relname as tbl, a.attname as col
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.contype = 'f' and c.confrelid = 'contacts'::regclass and cl.relname <> 'contacts'
      order by cl.relname, a.attname`),
  ).map((r) => ({ table: r.tbl, column: r.col }));
  // attribution_credits.contact_id has no foreign key (credits are rebuilt), so name it here.
  if (!found.some((f) => f.table === "attribution_credits")) found.push({ table: "attribution_credits", column: "contact_id" });
  return found;
}

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`unexpected identifier ${s}`);
  return sql.raw(`"${s}"`);
};

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/**
 * Move one column's rows from `from` to `to`. When a unique key makes a row collide with one the
 * kept contact already has (a tag both had, a one-row-per-contact roll-up), the moved row is
 * dropped: the kept contact already holds the same fact.
 */
async function repoint(tx: Tx, workspaceId: string, table: string, column: string, from: string, to: string): Promise<number> {
  const t = ident(table);
  const c = ident(column);
  try {
    return await tx.transaction(async (sp) => rows(await sp.execute(sql`update ${t} set ${c} = ${to} where ${c} = ${from} and workspace_id = ${workspaceId} returning 1`)).length);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
  }
  let moved = 0;
  const ids = rows<{ id: string }>(await tx.execute(sql`select id from ${t} where ${c} = ${from} and workspace_id = ${workspaceId}`));
  for (const { id } of ids) {
    try {
      await tx.transaction(async (sp) => {
        await sp.execute(sql`update ${t} set ${c} = ${to} where id = ${id}`);
      });
      moved++;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await tx.execute(sql`delete from ${t} where id = ${id}`);
    }
  }
  return moved;
}

/** Contact columns the merge handles itself; every other column is filled from the merged contact when the kept one is blank. */
const HANDLED = new Set(["id", "workspace_id", "email", "email_hash", "phone_hash", "name", "first_seen_at", "lifecycle", "external_ids", "ads_consent", "created_at"]);

export type MergeResult = {
  keptId: string;
  mergedId: string;
  /** Rows moved per table (only tables where something moved). */
  moved: Record<string, number>;
  emailAdded: boolean;
};

export class MergeError extends Error {}

/**
 * Merge `mergeId` into `keepId` (same workspace): everything that points at the merged contact
 * moves to the kept one, blank fields on the kept contact are filled from the merged one, the
 * merged contact is deleted, and attribution is recomputed.
 */
export async function mergeContacts(db: DB, ws: Pick<Workspace, "id">, keepId: string, mergeId: string): Promise<MergeResult> {
  if (keepId === mergeId) throw new MergeError("Pick two different contacts.");
  const result = await db.transaction(async (tx) => {
    const both = await tx
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, ws.id), inArray(schema.contacts.id, [keepId, mergeId])))
      .for("update");
    const keep = both.find((c) => c.id === keepId);
    const merge = both.find((c) => c.id === mergeId);
    if (!keep || !merge) throw new MergeError("One of these contacts no longer exists. Refresh the page.");

    const moved: Record<string, number> = {};
    for (const ref of await contactReferences(tx)) {
      if (ref.table === "contact_duplicate_dismissals") continue; // cascades away with the merged contact
      if (ref.table === "contact_stats") {
        // Derived per-contact roll-up (keyed by contact_id): drop the merged copy; the kept one is rebuilt after attribution recomputes.
        await tx.execute(sql`delete from contact_stats where contact_id = ${mergeId} and workspace_id = ${ws.id}`);
        continue;
      }
      const n = await repoint(tx, ws.id, ref.table, ref.column, mergeId, keepId);
      if (n) moved[ref.table] = (moved[ref.table] ?? 0) + n;
    }

    // Fill the kept contact's blanks from the merged one. Columns added by later features
    // (owner, stage, tags…) are filled the same way.
    const extra = rows<{ column_name: string }>(
      await tx.execute(sql`select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'contacts' order by ordinal_position`),
    )
      .map((r) => r.column_name)
      .filter((c) => !HANDLED.has(c));
    const fill = extra.map((c) => sql`, ${ident(c)} = coalesce(k.${ident(c)}, m.${ident(c)})`);
    await tx.execute(sql`
      update contacts k set
        phone_hash = coalesce(k.phone_hash, m.phone_hash),
        name = coalesce(k.name, m.name),
        first_seen_at = least(k.first_seen_at, m.first_seen_at),
        lifecycle = case when k.lifecycle = 'customer' or m.lifecycle = 'customer' then 'customer' else k.lifecycle end,
        external_ids = m.external_ids || k.external_ids,
        ads_consent = case when k.ads_consent = 'denied' or m.ads_consent = 'denied' then 'denied' else coalesce(k.ads_consent, m.ads_consent) end
        ${sql.join(fill, sql``)}
      from contacts m
      where k.id = ${keepId} and m.id = ${mergeId} and k.workspace_id = ${ws.id}`);

    await tx.delete(schema.contacts).where(and(eq(schema.contacts.id, mergeId), eq(schema.contacts.workspaceId, ws.id)));
    // The email moves only when the kept contact has none (the unique key is free once the merged row is gone).
    const emailAdded = !keep.email && Boolean(merge.email);
    if (emailAdded) await tx.update(schema.contacts).set({ email: merge.email, emailHash: merge.emailHash }).where(eq(schema.contacts.id, keepId));
    return { keptId: keepId, mergedId: mergeId, moved, emailAdded };
  });
  await requestAttribution(ws.id);
  return result;
}
