// Client-safe parts of the contacts CSV import (field list and result shapes). The import
// itself lives in src/lib/contacts-import.ts, which re-exports everything here.

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

export type InvalidRow = { line: number; reason: string };

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

export type ImportResult = { created: number; updated: number; invalid: number; repeats: number; leads: number };
