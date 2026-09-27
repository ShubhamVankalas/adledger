import type { Role } from "./db/schema";

// Role-based access. Roles are per organization; clients are additionally limited to the
// workspaces listed on their membership.

export const ROLES: { role: Role; label: string; description: string }[] = [
  { role: "owner", label: "Owner", description: "Full access, including organization settings and removing admins." },
  { role: "admin", label: "Admin", description: "Manage workspaces, integrations, members and settings." },
  { role: "analyst", label: "Analyst", description: "View and export reports, generate insights, create API keys." },
  { role: "viewer", label: "Viewer", description: "Read-only access to every workspace's reports." },
  { role: "client", label: "Client", description: "Read-only access to selected workspaces only (for agency clients)." },
];

export type Permission =
  | "reports.view"
  | "reports.export"
  | "insights.generate"
  | "apikeys.manage"
  | "workspace.settings"
  | "workspace.data"
  | "workspaces.manage"
  | "members.manage"
  | "audit.view"
  | "org.branding"
  | "org.manage"
  | "dashboard.edit"
  | "pipeline.move";

const MATRIX: Record<Permission, Role[]> = {
  // Move contacts between pipeline stages (stage configuration itself is workspace.settings).
  "pipeline.move": ["owner", "admin", "analyst"],
  "reports.view": ["owner", "admin", "analyst", "viewer", "client"],
  "reports.export": ["owner", "admin", "analyst"],
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
