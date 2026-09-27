import type { Role } from "./db/schema";

// Role-based access. Roles are per organization; clients are additionally limited to the
// workspaces listed on their membership.

export const ROLES: { role: Role; label: string; description: string }[] = [
  { role: "owner", label: "Owner", description: "Full access, including organization settings and removing admins." },
  { role: "admin", label: "Admin", description: "Manage workspaces, integrations, members and settings." },
  { role: "analyst", label: "Analyst", description: "View and export reports, generate insights, create API keys." },
  { role: "viewer", label: "Viewer", description: "Read-only access to every workspace's reports. Contact emails are masked." },
  { role: "client", label: "Client", description: "Read-only access to selected workspaces only (for agency clients). Contact emails are masked." },
];

export type Permission =
  | "reports.view"
  | "reports.export"
  | "reports.pdf"
  | "reports.share"
  | "reports.schedule"
  | "export.csv"
  | "export.contacts"
  | "contacts.pii"
  | "security.manage"
  | "views.share"
  | "contacts.edit"
  | "contacts.notes"
  | "insights.generate"
  | "apikeys.manage"
  | "workspace.settings"
  | "workspace.data"
  | "workspaces.manage"
  | "members.manage"
  | "audit.view"
  | "org.branding"
  | "org.manage"
  | "dashboard.edit";

const MATRIX: Record<Permission, Role[]> = {
  "reports.view": ["owner", "admin", "analyst", "viewer", "client"],
  // Aggregate report CSVs (campaigns, channels, cohorts). Does not cover contact-level data.
  "reports.export": ["owner", "admin", "analyst"],
  // Branded aggregate PDFs. Clients only while the organization allows it (see lib/security/policy.ts).
  "reports.pdf": ["owner", "admin", "analyst", "viewer", "client"],
  "reports.share": ["owner", "admin", "analyst"],
  "reports.schedule": ["owner", "admin", "analyst"],
  // Any CSV download of aggregates or logs (the audit log CSV also needs audit.view).
  "export.csv": ["owner", "admin", "analyst"],
  // Contact CSV with raw emails. Others with export.csv get a masked, hashed export instead.
  "export.contacts": ["owner", "admin"],
  // Unmasked contact email on screen and in API responses. Everyone else sees p•••@gmail.com.
  "contacts.pii": ["owner", "admin", "analyst"],
  // Organization security policy (require 2FA, session limits) and other members' sessions.
  "security.manage": ["owner"],
  // Create, edit, pin and delete views shared with the whole workspace (personal views only need reports.view).
  "views.share": ["owner", "admin", "analyst"],
  // CRM: tags, owner, lifecycle, notes, tasks and saved views. Notes and tasks are internal: clients never see them.
  "contacts.edit": ["owner", "admin", "analyst"],
  "contacts.notes": ["owner", "admin", "analyst", "viewer"],
  "insights.generate": ["owner", "admin", "analyst"],
  "apikeys.manage": ["owner", "admin", "analyst"],
  "workspace.settings": ["owner", "admin"],
  "workspace.data": ["owner", "admin"],
  "workspaces.manage": ["owner", "admin"],
  "members.manage": ["owner", "admin"],
  "audit.view": ["owner", "admin"],
  "org.branding": ["owner", "admin"],
  "org.manage": ["owner"],
  // Personal Overview layouts: everyone. Editing the workspace default also needs workspace.settings.
  "dashboard.edit": ["owner", "admin", "analyst", "viewer", "client"],
};

export function roleCan(role: Role, permission: Permission): boolean {
  return MATRIX[permission].includes(role);
}

/** Admins can manage everyone except owners; only owners can create/remove/change owners. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return target !== "owner";
  return false;
}

export const roleLabel = (role: Role) => ROLES.find((r) => r.role === role)?.label ?? role;
