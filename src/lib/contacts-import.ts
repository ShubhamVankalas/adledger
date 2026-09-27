import { and, eq, inArray, sql } from "drizzle-orm";
import { EMAIL_RE, hashEmail, hashPhone, normalizeEmail } from "./crypto";
import { schema, type DB } from "./db";
import { requestAttribution } from "./jobs";
import { normalizeDate, parseCsvTable } from "./imports";
import type { Workspace } from "./settings";

// Contacts CSV import (Settings → Import data): upload → map columns → preview
// "124 new · 38 update · 3 invalid" → import. People are deduplicated on the email hash (or the
// phone hash for rows without an email), exactly like leads from the pixel and webhooks, and an
// existing contact is only ever filled in, never overwritten.

export const CONTACT_FIELDS = {
  email: { label: "Email", hint: "jane@example.com" },
  phone: { label: "Phone", hint: "+1 415 555 0100" },
  name: { label: "Full name", hint: "Jane Doe" },
  first_name: { label: "First name", hint: "Jane" },
  last_name: { label: "Last name", hint: "Doe" },
  first_seen: { label: "Date added", hint: "2026-09-01" },
} as const;
export type ContactField = keyof typeof CONTACT_FIELDS;
export const CONTACT_FIELD_KEYS = Object.keys(CONTACT_FIELDS) as ContactField[];
/** Column index → field, for the columns that are imported. */
export type ColumnMapping = Partial<Record<ContactField, number>>;

const ALIASES: Record<ContactField, string[]> = {
  email: ["email", "e-mail", "email address", "e-mail address", "customer email", "contact email", "work email", "mail"],
  phone: ["phone", "phone number", "mobile", "mobile number", "cell", "telephone", "tel", "whatsapp", "contact number"],
  name: ["name", "full name", "fullname", "contact name", "customer name", "customer"],
  first_name: ["first name", "firstname", "given name", "first"],
  last_name: ["last name", "lastname", "surname", "family name", "last"],
  first_seen: ["date added", "created", "created at", "created on", "signup date", "signed up", "date", "first seen", "subscribed", "joined"],
};

const norm = (h: string) => h.replace(/^﻿/, "").trim().toLowerCase().replace(/[_\s]+/g, " ");

/** Best guess of which column holds which field, from the header row. */
export function guessMapping(headers: string[]): ColumnMapping {
  const out: ColumnMapping = {};
  const taken = new Set<number>();
  for (const field of CONTACT_FIELD_KEYS) {
    const aliases = ALIASES[field];
    let idx = headers.findIndex((h, i) => !taken.has(i) && aliases.includes(norm(h)));
    // Looser second pass: "Billing email", "Phone (mobile)".
    if (idx === -1 && (field === "email" || field === "phone")) idx = headers.findIndex((h, i) => !taken.has(i) && norm(h).includes(field));
    if (idx !== -1) {
      out[field] = idx;
      taken.add(idx);
    }
  }
  // A full name wins over first/last only when both halves are missing.
  if (out.name !== undefined && (out.first_name !== undefined || out.last_name !== undefined)) {
    delete out.first_name;
    delete out.last_name;
  }
  return out;
}

/** Validate a mapping sent from the browser against the file's columns. */
export function parseMapping(raw: unknown, columns: number): ColumnMapping {
  if (!raw || typeof raw !== "object") return {};
  const out: ColumnMapping = {};
  const used = new Set<number>();
  for (const field of CONTACT_FIELD_KEYS) {
    const v = (raw as Record<string, unknown>)[field];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < columns && !used.has(v)) {
      out[field] = v;
      used.add(v);
    }
  }
  return out;
}

export type ContactsTable = { headers: string[]; rows: string[][] };

/** Parse an uploaded CSV into a header row and data rows. Throws a person-readable Error. */
export function readContactsCsv(text: string): ContactsTable {
  const table = parseCsvTable(text);
  if (table.length < 2) throw new Error("No rows found. The first line must be a header row, like email,name,phone.");
  const headers = table[0].map((h, i) => h.replace(/^﻿/, "").trim() || `Column ${i + 1}`);
  return { headers, rows: table.slice(1).map((r) => headers.map((_, i) => (r[i] ?? "").trim())) };
}

// ---------------------------------------------------------------- rows

type CleanRow = {
  /** 1-based line in the file (the header is line 1). */
  line: number;
  email: string | null;
  emailHash: string | null;
  phoneHash: string | null;
  name: string | null;
  firstSeenAt: Date | null;
};
export type InvalidRow = { line: number; reason: string };

const MAX_NAME = 200;

function parseDate(raw: string, now: Date): Date | null | "invalid" {
  if (!raw) return null;
  const d = normalizeDate(raw);
  const at = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00Z`) : new Date(raw);
  if (Number.isNaN(at.getTime()) || at.getUTCFullYear() < 1990) return "invalid";
  return at > now ? now : at;
}

function cleanRow(cells: string[], line: number, m: ColumnMapping, now: Date): CleanRow | InvalidRow {
  const get = (f: ContactField) => (m[f] === undefined ? "" : (cells[m[f]!] ?? "").trim());
  const rawEmail = get("email");
  const rawPhone = get("phone");
  let email: string | null = null;
  if (rawEmail) {
    if (!EMAIL_RE.test(rawEmail) || rawEmail.length > 320) return { line, reason: "The email address isn’t valid." };
    email = normalizeEmail(rawEmail);
  }
  let phoneHash: string | null = null;
  if (rawPhone) {
    const digits = rawPhone.replace(/\D/g, "");
    if (digits.length < 6 || digits.length > 20) return { line, reason: "The phone number is too short or too long." };
    phoneHash = hashPhone(rawPhone);
  }
  if (!email && !phoneHash) return { line, reason: "Needs an email or a phone number." };
  const date = parseDate(get("first_seen"), now);
  if (date === "invalid") return { line, reason: "The date isn’t one we can read. Use YYYY-MM-DD." };
  const name = (get("name") || [get("first_name"), get("last_name")].filter(Boolean).join(" ")).replace(/\s+/g, " ").slice(0, MAX_NAME) || null;
  return { line, email, emailHash: email ? hashEmail(email) : null, phoneHash, name, firstSeenAt: date };
}

/** One entry per person in the file: later rows for the same email (or phone) fill in the first. */
function dedupe(rows: CleanRow[]): { people: CleanRow[]; repeats: number } {
  const byKey = new Map<string, CleanRow>();
  const byPhone = new Map<string, CleanRow>();
  let repeats = 0;
  for (const r of rows) {
    // An email row whose phone matches an earlier phone-only row: that row gains the email.
    const phoneOnly = r.emailHash && r.phoneHash ? byPhone.get(r.phoneHash) : undefined;
    if (phoneOnly && !phoneOnly.emailHash && !byKey.has(`e:${r.emailHash}`)) {
      byKey.delete(`p:${phoneOnly.phoneHash}`);
      phoneOnly.email = r.email;
      phoneOnly.emailHash = r.emailHash;
      byKey.set(`e:${r.emailHash}`, phoneOnly);
    }
    const hit = (r.emailHash && byKey.get(`e:${r.emailHash}`)) || (!r.emailHash && r.phoneHash && byPhone.get(r.phoneHash)) || null;
    if (hit) {
      repeats++;
      hit.name ??= r.name;
      hit.phoneHash ??= r.phoneHash;
      if (r.firstSeenAt && (!hit.firstSeenAt || r.firstSeenAt < hit.firstSeenAt)) hit.firstSeenAt = r.firstSeenAt;
      if (hit.phoneHash && !byPhone.has(hit.phoneHash)) byPhone.set(hit.phoneHash, hit);
      continue;
    }
    const copy = { ...r };
    byKey.set(copy.emailHash ? `e:${copy.emailHash}` : `p:${copy.phoneHash}`, copy);
    if (copy.phoneHash && !byPhone.has(copy.phoneHash)) byPhone.set(copy.phoneHash, copy);
  }
  return { people: [...byKey.values()], repeats };
}

type Existing = { byEmail: Map<string, string>; byPhone: Map<string, string> };

const CHUNK = 1000;
const chunks = <T>(list: T[], n = CHUNK) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

/** Existing contacts matching the file, by email hash and by phone hash (oldest contact wins). */
async function findExisting(db: DB, workspaceId: string, people: CleanRow[]): Promise<Existing> {
  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const emails = people.flatMap((p) => (p.emailHash ? [p.emailHash] : []));
  const phones = people.flatMap((p) => (!p.emailHash && p.phoneHash ? [p.phoneHash] : []));
  for (const part of chunks(emails)) {
    const found = await db
      .select({ id: schema.contacts.id, h: schema.contacts.emailHash })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, workspaceId), inArray(schema.contacts.emailHash, part)));
    for (const f of found) if (f.h) byEmail.set(f.h, f.id);
  }
  for (const part of chunks(phones)) {
    const found = await db
      .select({ id: schema.contacts.id, h: schema.contacts.phoneHash })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.workspaceId, workspaceId), inArray(schema.contacts.phoneHash, part)))
      .orderBy(schema.contacts.firstSeenAt, schema.contacts.id);
    for (const f of found) if (f.h && !byPhone.has(f.h)) byPhone.set(f.h, f.id);
  }
  return { byEmail, byPhone };
}

const existingId = (p: CleanRow, ex: Existing) => (p.emailHash ? ex.byEmail.get(p.emailHash) : p.phoneHash ? ex.byPhone.get(p.phoneHash) : undefined);

function classify(table: ContactsTable, mapping: ColumnMapping, now: Date) {
  const valid: CleanRow[] = [];
  const invalid: InvalidRow[] = [];
  table.rows.forEach((cells, i) => {
    const r = cleanRow(cells, i + 2, mapping, now);
    if ("reason" in r) invalid.push(r);
    else valid.push(r);
  });
  return { valid, invalid, ...dedupe(valid) };
}

// ---------------------------------------------------------------- preview

export type ImportPreview = {
  rows: number;
  new: number;
  update: number;
  invalid: number;
  /** Rows that repeat an earlier row's email or phone; they are folded into it. */
  repeats: number;
  /** The first few invalid rows, with why. */
  problems: InvalidRow[];
  /** The first rows as they would be imported. */
  sample: { line: number; email: string | null; name: string | null; hasPhone: boolean; firstSeen: string | null; status: "new" | "update" }[];
  /** A mapping problem to show above the preview (no email or phone column). */
  warning: string | null;
};

export function mappingWarning(mapping: ColumnMapping): string | null {
  if (mapping.email === undefined && mapping.phone === undefined) return "Pick the column that holds the email address or phone number. Every contact needs one.";
  return null;
}

export async function previewContactsImport(db: DB, ws: Pick<Workspace, "id">, table: ContactsTable, mapping: ColumnMapping, now = new Date()): Promise<ImportPreview> {
  const warning = mappingWarning(mapping);
  const { invalid, people, repeats } = classify(table, mapping, now);
  const existing = await findExisting(db, ws.id, people);
  let update = 0;
  for (const p of people) if (existingId(p, existing)) update++;
  return {
    rows: table.rows.length,
    new: people.length - update,
    update,
    invalid: invalid.length,
    repeats,
    problems: invalid.slice(0, 5),
    sample: people.slice(0, 6).map((p) => ({
      line: p.line,
      email: p.email,
      name: p.name,
      hasPhone: Boolean(p.phoneHash),
      firstSeen: p.firstSeenAt ? p.firstSeenAt.toISOString().slice(0, 10) : null,
      status: existingId(p, existing) ? "update" : "new",
    })),
    warning,
  };
}

// ---------------------------------------------------------------- import

export type ImportOptions = {
  /** Also record each NEW contact as a lead on its date added (source "csv"). */
  recordLeads?: boolean;
  /** Form name on those leads. */
  formName?: string | null;
  now?: Date;
};
export type ImportResult = { created: number; updated: number; invalid: number; repeats: number; leads: number };

/**
 * Import the file: new people become contacts, existing ones get blank fields filled in (name,
 * phone, an earlier "date added"). Safe to run twice: the second run only updates.
 */
export async function runContactsImport(db: DB, ws: Pick<Workspace, "id">, table: ContactsTable, mapping: ColumnMapping, opts: ImportOptions = {}): Promise<ImportResult> {
  const now = opts.now ?? new Date();
  if (mappingWarning(mapping)) throw new Error(mappingWarning(mapping)!);
  const { invalid, people, repeats } = classify(table, mapping, now);
  const existing = await findExisting(db, ws.id, people);
  const formName = opts.formName?.trim().slice(0, 200) || "CSV import";
  let created = 0;
  let updated = 0;
  let leads = 0;

  for (const part of chunks(people, 500)) {
    await db.transaction(async (tx) => {
      const fresh: { contactId: string; at: Date }[] = [];
      // People with an email: one upsert on the (workspace, email hash) key, like upsertContact().
      const withEmail = part.filter((p) => p.emailHash);
      if (withEmail.length) {
        const out = await tx
          .insert(schema.contacts)
          .values(withEmail.map((p) => ({ workspaceId: ws.id, email: p.email, emailHash: p.emailHash, phoneHash: p.phoneHash, name: p.name, firstSeenAt: p.firstSeenAt ?? now })))
          .onConflictDoUpdate({
            target: [schema.contacts.workspaceId, schema.contacts.emailHash],
            set: {
              phoneHash: sql`coalesce(${schema.contacts.phoneHash}, excluded.phone_hash)`,
              name: sql`coalesce(${schema.contacts.name}, excluded.name)`,
              firstSeenAt: sql`least(${schema.contacts.firstSeenAt}, excluded.first_seen_at)`,
            },
          })
          .returning({ id: schema.contacts.id, emailHash: schema.contacts.emailHash, firstSeenAt: schema.contacts.firstSeenAt });
        for (const row of out) {
          if (existing.byEmail.has(row.emailHash!)) updated++;
          else {
            created++;
            fresh.push({ contactId: row.id, at: row.firstSeenAt });
          }
        }
      }
      // Phone-only people: fill in the matching contact, or create one.
      for (const p of part.filter((x) => !x.emailHash)) {
        const id = existingId(p, existing);
        if (id) {
          await tx
            .update(schema.contacts)
            .set({
              name: sql`coalesce(${schema.contacts.name}, ${p.name})`,
              ...(p.firstSeenAt ? { firstSeenAt: sql`least(${schema.contacts.firstSeenAt}, ${p.firstSeenAt.toISOString()}::timestamptz)` } : {}),
            })
            .where(and(eq(schema.contacts.id, id), eq(schema.contacts.workspaceId, ws.id)));
          updated++;
        } else {
          const [row] = await tx.insert(schema.contacts).values({ workspaceId: ws.id, phoneHash: p.phoneHash, name: p.name, firstSeenAt: p.firstSeenAt ?? now }).returning();
          created++;
          fresh.push({ contactId: row.id, at: row.firstSeenAt });
        }
      }
      if (opts.recordLeads && fresh.length) {
        await tx.insert(schema.leads).values(fresh.map((f) => ({ workspaceId: ws.id, contactId: f.contactId, source: "csv" as const, formName, occurredAt: f.at, raw: { import: "contacts_csv" } })));
        leads += fresh.length;
      }
    });
  }
  if (leads) await requestAttribution(ws.id);
  return { created, updated, invalid: invalid.length, repeats, leads };
}
