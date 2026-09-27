import type { Role } from "./db/schema";
import type { Permission } from "./permissions";

// The ONE place the CRM turns a contact's raw email or phone into what a viewer sees.
// Every CRM surface (table, peek, record page, tasks) renders through these helpers, so
// role-based masking (the `contacts.pii` permission) is wired here and nowhere else. Call them on
// the server, before data reaches the browser, so a masked viewer never receives the raw value.
//
// On screen the CRM masks emails for everyone (`screenEmail`). Members with `contacts.pii` see the
// real address only after "Show email", which asks revealContactEmailsAction (audited as
// contact.pii_revealed); see src/components/crm/reveal.tsx.

/** Who is looking. `can` is the session user's permission check (SessionUser.can). */
export type ContactViewer = { role: Role; can: (permission: Permission) => boolean } | null;

/** Whether this viewer may see raw contact emails and phones (`contacts.pii`). No viewer = masked. */
export function canSeeContactPii(viewer: ContactViewer): boolean {
  return !!viewer?.can("contacts.pii");
}

/** "priya@northwind.io" → "p•••••@northwind.io". Same shape as maskEmail() in lib/reports.ts. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (domain === undefined) return "•••";
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

/** The email as the viewer may see it: raw with `contacts.pii`, masked otherwise. */
export function displayEmail(email: string | null | undefined, viewer: ContactViewer): string | null {
  if (!email) return null;
  return canSeeContactPii(viewer) ? email : maskEmail(email);
}

/** An email as the CRM screens show it before a reveal: always masked, whoever is looking. */
export function screenEmail(email: string | null | undefined): string | null {
  return displayEmail(email, null);
}

/** The phone number as the viewer may see it: raw with `contacts.pii`, otherwise only the last two digits. */
export function displayPhone(phone: string | null | undefined, viewer: ContactViewer): string | null {
  if (!phone) return null;
  if (canSeeContactPii(viewer)) return phone;
  const digits = phone.replace(/\D/g, "");
  return digits.length > 2 ? `•••• ${digits.slice(-2)}` : "••••";
}

/** Name to show for a contact: their name, else the (display) email, else a neutral label. */
export function displayName(contact: { name: string | null; email: string | null }, viewer: ContactViewer): string {
  return contact.name?.trim() || displayEmail(contact.email, viewer) || "Anonymous contact";
}
