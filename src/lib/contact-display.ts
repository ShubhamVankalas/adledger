import type { Role } from "./db/schema";
import type { Permission } from "./permissions";

// The ONE place the CRM turns a contact's raw email or phone into what a viewer sees.
// Every CRM surface (table, peek, record page, tasks) renders through these helpers, so
// role-based masking (the `contacts.pii` permission) is wired here and nowhere else. Call them on
// the server, before data reaches the browser, so a masked viewer never receives the raw value.

/** Who is looking. `can` is the session user's permission check (SessionUser.can). */
export type ContactViewer = { role: Role; can: (permission: Permission) => boolean } | null;

/** The email as the viewer may see it. Today every signed-in viewer sees the raw value. */
export function displayEmail(email: string | null | undefined, viewer: ContactViewer): string | null {
  void viewer;
  return email ?? null;
}

/** The phone number as the viewer may see it. Today every signed-in viewer sees the raw value. */
export function displayPhone(phone: string | null | undefined, viewer: ContactViewer): string | null {
  void viewer;
  return phone ?? null;
}

/** Name to show for a contact: their name, else the (display) email, else a neutral label. */
export function displayName(contact: { name: string | null; email: string | null }, viewer: ContactViewer): string {
  return contact.name?.trim() || displayEmail(contact.email, viewer) || "Anonymous contact";
}
