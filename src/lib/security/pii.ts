import type { Principal, SessionUser } from "../auth";
import { maskEmail } from "../reports";

// Contact PII masking by role and API key scope. Owners, admins and analysts (contacts.pii) and
// keys with contacts:pii see raw emails; everyone else sees "p•••@gmail.com". Contacts carry no
// raw phone number (only its hash), so there is nothing else to mask.

export { maskEmail };

/** Can this caller see unmasked contact emails? */
export function canSeePii(who: Principal | SessionUser | { via: "api_key"; scopes: readonly string[] } | { via: "session"; user: SessionUser }): boolean {
  if ("kind" in who) return who.kind === "session" ? who.user.can("contacts.pii") : who.key.scopes.includes("contacts:pii");
  if ("via" in who) return who.via === "session" ? who.user.can("contacts.pii") : who.scopes.includes("contacts:pii");
  return who.can("contacts.pii");
}

/** Mask the `email` field of rows unless the caller may see it. */
export function maskRows<T extends { email: string | null }>(rows: T[], pii: boolean): T[] {
  return pii ? rows : rows.map((r) => ({ ...r, email: maskEmail(r.email) }));
}

/** What to show for a contact's name when the name itself is missing and the email is masked. */
export const displayName = (c: { name: string | null; email: string | null }, fallback = "Anonymous") => c.name || c.email || fallback;
