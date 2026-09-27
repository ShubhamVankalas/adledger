import { createHash } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { schema, type DB } from "../db";

// Tamper-evident audit log. Entries form one hash chain per organization:
//   hash(n) = sha256(hash(n-1) + "\n" + canonical(entry n))
// Editing, deleting or reordering a row by hand breaks the chain from that row on, and Verify
// reports the first broken sequence number. It detects tampering; it can't prevent someone with
// database access from rewriting the whole chain (the head hash is printed on reports so a copy
// held elsewhere can be compared).

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type Q = DB | Tx;
type Row = typeof schema.auditLog.$inferSelect;

export const GENESIS = "0".repeat(64);

export type AuditEntry = {
  organizationId: string;
  workspaceId: string | null;
  userId: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown>;
  ipTrunc: string | null;
  userAgent: string | null;
};

/** JSON with object keys sorted at every level (jsonb doesn't keep key order). */
export function canonicalJson(value: unknown): string {
  const normalized = JSON.parse(JSON.stringify(value ?? null)) as unknown;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, walk((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(walk(normalized));
}

/** The fields a hash covers. `refs` (not the nullable FK columns) carries who and where. */
function payload(r: { seq: number; organizationId: string; refs: { u: string | null; w: string | null }; action: string; target: string | null; meta: unknown; ipTrunc: string | null; userAgent: string | null; createdAt: Date }) {
  return canonicalJson({
    seq: r.seq,
    org: r.organizationId,
    user: r.refs.u,
    workspace: r.refs.w,
    action: r.action,
    target: r.target,
    meta: r.meta,
    ip: r.ipTrunc,
    ua: r.userAgent,
    at: r.createdAt.toISOString(),
  });
}

export const chainHash = (prevHash: string, body: string) => createHash("sha256").update(`${prevHash}\n${body}`).digest("hex");

const lock = (tx: Q, organizationId: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`audit:${organizationId}`}))`);

async function head(tx: Q, organizationId: string): Promise<{ seq: number; hash: string }> {
  const [last] = await tx
    .select({ seq: schema.auditLog.seq, hash: schema.auditLog.hash })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.organizationId, organizationId), sql`${schema.auditLog.seq} is not null`))
    .orderBy(sql`${schema.auditLog.seq} desc`)
    .limit(1);
  return last?.seq != null && last.hash ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS };
}

/**
 * Chain rows written before the chain existed (or by code paths that bypassed it), oldest first.
 * Runs under the organization's lock.
 */
async function sealUnchained(tx: Q, organizationId: string, from: { seq: number; hash: string }) {
  let { seq, hash } = from;
  const loose = await tx
    .select()
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.organizationId, organizationId), isNull(schema.auditLog.seq)))
    .orderBy(asc(schema.auditLog.createdAt), asc(schema.auditLog.id));
  for (const r of loose) {
    seq += 1;
    const refs = r.refs ?? { u: r.userId, w: r.workspaceId };
    const next = chainHash(hash, payload({ ...r, seq, refs }));
    await tx.update(schema.auditLog).set({ seq, refs, prevHash: hash, hash: next }).where(eq(schema.auditLog.id, r.id));
    hash = next;
  }
  return { seq, hash };
}

/** Append one entry to its organization's chain (serialized per organization). */
export async function appendAudit(db: DB, entry: AuditEntry): Promise<Row> {
  return db.transaction(async (tx) => {
    await lock(tx, entry.organizationId);
    const tip = await sealUnchained(tx, entry.organizationId, await head(tx, entry.organizationId));
    const seq = tip.seq + 1;
    // Millisecond precision so the timestamp read back from Postgres is identical to the one hashed.
    const createdAt = new Date(Math.floor(Date.now()));
    const refs = { u: entry.userId, w: entry.workspaceId };
    const meta = JSON.parse(JSON.stringify(entry.meta ?? {})) as Record<string, unknown>;
    const hash = chainHash(tip.hash, payload({ ...entry, meta, seq, refs, createdAt }));
    const [row] = await tx
      .insert(schema.auditLog)
      .values({ ...entry, meta, refs, seq, prevHash: tip.hash, hash, createdAt })
      .returning();
    return row;
  });
}

export type ChainReport = {
  ok: boolean;
  /** Entries checked. */
  checked: number;
  /** First sequence number that doesn't verify (edited, deleted or out of order), when not ok. */
  brokenAt: number | null;
  reason: "edited" | "missing" | "relinked" | null;
  /** Hash of the newest entry: publish or print it to pin the log's state. */
  headHash: string;
  headSeq: number;
};

/** Recompute the whole chain for an organization. */
export async function verifyAuditChain(db: DB, organizationId: string): Promise<ChainReport> {
  // Chain any loose rows first so they are covered from now on.
  await db.transaction(async (tx) => {
    await lock(tx, organizationId);
    await sealUnchained(tx, organizationId, await head(tx, organizationId));
  });
  let prev = GENESIS;
  let expectedSeq = 1;
  let checked = 0;
  const PAGE = 1000;
  for (;;) {
    const batch = await db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.organizationId, organizationId), gt(schema.auditLog.seq, expectedSeq - 1)))
      .orderBy(asc(schema.auditLog.seq))
      .limit(PAGE);
    for (const r of batch) {
      const seq = r.seq!;
      const fail = (reason: ChainReport["reason"], at: number) => ({ ok: false, checked, brokenAt: at, reason, headHash: prev, headSeq: expectedSeq - 1 });
      if (seq !== expectedSeq) return fail("missing", expectedSeq);
      if (r.prevHash !== prev) return fail("relinked", seq);
      const refs = r.refs ?? { u: r.userId, w: r.workspaceId };
      if (chainHash(prev, payload({ ...r, seq, refs })) !== r.hash) return fail("edited", seq);
      prev = r.hash!;
      expectedSeq += 1;
      checked += 1;
    }
    if (batch.length < PAGE) break;
  }
  return { ok: true, checked, brokenAt: null, reason: null, headHash: prev, headSeq: expectedSeq - 1 };
}
