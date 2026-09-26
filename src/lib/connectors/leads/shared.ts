import { createHash } from "node:crypto";
import { safeEqual, str } from "../revenue/shared";

// Helpers shared by the native lead-form connectors in this folder.

/** Constant-time comparison of two shared secrets (hashing first hides length differences). */
export function secretEquals(expected: string | undefined | null, given: string | undefined | null): boolean {
  if (!expected || !given) return false;
  const h = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return safeEqual(h(expected), h(given));
}

/**
 * Read a numeric id field as a string straight from the raw JSON, so int64 ids above 2^53
 * survive (JSON.parse would round them). Falls back to the parsed value.
 */
export function rawId(rawBody: string, key: string, parsed: unknown): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"?(\\d+)"?`).exec(rawBody);
  return m ? m[1] : str(parsed);
}

/** Parse a platform timestamp: unix seconds (number or digit string) or ISO-ish strings. */
export function parseTime(v: unknown, fallback = new Date()): Date {
  if (typeof v === "number" && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000);
  const s = str(v);
  if (!s) return fallback;
  if (/^\d{9,13}$/.test(s)) return parseTime(Number(s), fallback);
  // "2026-09-20T10:15:30+0000" (Graph API) and "2026-09-20 10:15:30Z" variants.
  const iso = s.replace(" ", "T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** Map of lower-cased question keys to answers, for picking email/phone/name out of form answers. */
export type Answers = Map<string, string>;

const EMAIL_KEYS = ["email", "work_email", "email_address", "user_email"];
const PHONE_KEYS = ["phone_number", "phone", "work_phone_number", "work_phone", "mobile", "mobile_phone", "user_phone"];
const NAME_KEYS = ["full_name", "name", "user_name"];

export function contactFromAnswers(a: Answers): { email: string | null; phone: string | null; name: string | null } {
  const first = (keys: string[]) => keys.map((k) => a.get(k)).find((v): v is string => Boolean(v)) ?? null;
  const joined = [a.get("first_name"), a.get("last_name")].filter(Boolean).join(" ");
  return { email: first(EMAIL_KEYS), phone: first(PHONE_KEYS), name: first(NAME_KEYS) ?? (joined || null) };
}
