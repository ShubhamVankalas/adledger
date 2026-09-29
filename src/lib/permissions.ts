import type { BuiltinRole, Role } from "./db/schema";

// Role-based access. Roles are per organization; workspace-scoped roles (clients) are additionally
// limited to the workspaces listed on their membership. The five built-in roles below are the
// defaults; an organization can edit or delete them (except Owner) and add custom roles
// (org_roles, see lib/roles.ts).

export const ROLES: { role: BuiltinRole; label: string; description: string }[] = [
  { role: "owner", label: "Owner", description: "Full access, including organization settings and removing admins." },
  { role: "admin", label: "Admin", description: "Manage workspaces, integrations, members and settings." },
  { role: "analyst", label: "Analyst", description: "View and export reports, generate insights, create API keys." },
  { role: "viewer", label: "Viewer", description: "Read-only access to every workspace's reports. Contact emails are masked." },
  { role: "client", label: "Client", description: "Read-only access to selected workspaces only (for agency clients). Contact emails are masked." },
];

/** Page access: a role without the key sees "You don't have access" instead of the page. */
export type PagePermission =
  | "page.overview"
  | "page.live"
  | "page.performance"
  | "page.attribution"
  | "page.customers"
  | "page.insights"
  | "page.reports"
  | "page.profit"
  | "page.contacts"
  | "page.pipeline"
  | "page.tasks"
  | "page.developers";

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
  | "insights.ask"
  | "alerts.manage"
  | "apikeys.manage"
  | "workspace.settings"
  | "workspace.data"
  | "workspaces.manage"
  | "members.manage"
  | "roles.manage"
  | "audit.view"
  | "org.branding"
  | "org.manage"
  | "dashboard.edit"
  | "pipeline.move"
  | "developers.access"
  | PagePermission;

const EVERYONE: BuiltinRole[] = ["owner", "admin", "analyst", "viewer", "client"];

const MATRIX: Record<Permission, BuiltinRole[]> = {
  // Pages: every built-in role sees every page (an organization can hide them per role).
  "page.overview": EVERYONE,
  "page.live": EVERYONE,
  "page.performance": EVERYONE,
  "page.attribution": EVERYONE,
  "page.customers": EVERYONE,
  "page.insights": EVERYONE,
  "page.reports": EVERYONE,
  "page.profit": EVERYONE,
  "page.contacts": EVERYONE,
  "page.pipeline": EVERYONE,
  "page.tasks": EVERYONE,
  // Developers area (quickstart, API keys, API reference, recipes). Admin-only by default: it is
  // the door to getting data out.
  "page.developers": ["owner", "admin"],
  // Outbound webhooks: create endpoints that receive lead, contact and payment events. Exports data.
  "developers.access": ["owner", "admin"],
  // Move contacts between pipeline stages (stage configuration itself is workspace.settings).
  "pipeline.move": ["owner", "admin", "analyst"],
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
  // Ask reads aggregates only; clients are left out so an agency's AI model isn't spent by client seats.
  "insights.ask": ["owner", "admin", "analyst", "viewer"],
  "alerts.manage": ["owner", "admin", "analyst"],
  "apikeys.manage": ["owner", "admin", "analyst"],
  "workspace.settings": ["owner", "admin"],
  "workspace.data": ["owner", "admin"],
  "workspaces.manage": ["owner", "admin"],
  "members.manage": ["owner", "admin"],
  // Create, edit and delete roles (never beyond the editor's own permissions; Owner is fixed).
  "roles.manage": ["owner", "admin"],
  "audit.view": ["owner", "admin"],
  "org.branding": ["owner", "admin"],
  "org.manage": ["owner"],
  // Personal Overview layouts: everyone. Editing the workspace default also needs workspace.settings.
  "dashboard.edit": ["owner", "admin", "analyst", "viewer", "client"],
};

export const ALL_PERMISSIONS = Object.keys(MATRIX) as Permission[];

export const isPermission = (p: string): p is Permission => p in MATRIX;

/** Built-in default: what a built-in role grants before an organization edits it. */
export function roleCan(role: Role, permission: Permission): boolean {
  return (MATRIX[permission] as string[]).includes(role);
}

/** A role as the organization defines it (built-in defaults merged with org_roles rows). */
export type RoleDef = {
  key: Role;
  name: string;
  description: string;
  permissions: Permission[];
  /** One of the five defaults (possibly edited). Owner is always built-in and fixed. */
  builtin: boolean;
  /** Limited to the workspaces picked on each membership (like Client). */
  workspaceScoped: boolean;
};

export function builtinRoleDef(role: BuiltinRole): RoleDef {
  const r = ROLES.find((x) => x.role === role)!;
  return {
    key: role,
    name: r.label,
    description: r.description,
    permissions: role === "owner" ? [...ALL_PERMISSIONS] : ALL_PERMISSIONS.filter((p) => MATRIX[p].includes(role)),
    builtin: true,
    workspaceScoped: role === "client",
  };
}

export const BUILTIN_ROLES: RoleDef[] = ROLES.map((r) => builtinRoleDef(r.role));

export const findRoleDef = (roles: RoleDef[], key: string): RoleDef | null => roles.find((r) => r.key === key) ?? null;

export const isBuiltinRole = (key: string): key is BuiltinRole => ROLES.some((r) => r.role === key);

/**
 * Does a role grant a permission? Owner always does. Workspace-scoped roles (clients) download
 * PDFs only while the organization's policy allows it.
 */
export function roleDefCan(def: RoleDef | null | undefined, permission: Permission, policy?: { clientsCanDownloadPdf: boolean }): boolean {
  if (!def) return false;
  if (def.key === "owner") return true;
  if (!def.permissions.includes(permission)) return false;
  if (permission === "reports.pdf" && def.workspaceScoped && policy) return policy.clientsCanDownloadPdf;
  return true;
}

/**
 * Can someone with role `actor` give (or take away) role `target`? Owners can assign anything.
 * Others need members.manage, can never hand out Owner, and can't grant a permission they don't
 * hold themselves (no escalation through a custom role).
 */
export function canAssign(actor: RoleDef | null | undefined, target: RoleDef | null | undefined): boolean {
  if (!actor || !target) return false;
  if (actor.key === "owner") return true;
  if (!actor.permissions.includes("members.manage") || target.key === "owner") return false;
  return target.permissions.every((p) => actor.permissions.includes(p));
}

/** Same rule for editing or deleting a role definition (needs roles.manage instead). Owner is fixed. */
export function canEditRole(actor: RoleDef | null | undefined, target: RoleDef | null | undefined): boolean {
  if (!actor || !target || target.key === "owner") return false;
  if (actor.key === "owner") return true;
  if (!actor.permissions.includes("roles.manage")) return false;
  return target.permissions.every((p) => actor.permissions.includes(p));
}

/** Built-in defaults only (see canAssign for an organization's roles). */
export function canAssignRole(actor: BuiltinRole, target: BuiltinRole): boolean {
  return canAssign(builtinRoleDef(actor), builtinRoleDef(target));
}

export const roleLabel = (role: Role, defs?: RoleDef[]) => defs?.find((r) => r.key === role)?.name ?? ROLES.find((r) => r.role === role)?.label ?? role;

// ---- pages

/** Dashboard areas and the routes each covers, in sidebar order (the first allowed one is "home"). */
export const PAGES: { permission: PagePermission; label: string; href: string; routes: string[] }[] = [
  { permission: "page.overview", label: "Overview", href: "/", routes: ["/"] },
  { permission: "page.live", label: "Live", href: "/live", routes: ["/live"] },
  { permission: "page.performance", label: "Performance", href: "/performance", routes: ["/performance"] },
  { permission: "page.attribution", label: "Attribution", href: "/attribution", routes: ["/attribution"] },
  { permission: "page.customers", label: "Customers", href: "/customers", routes: ["/customers"] },
  { permission: "page.insights", label: "Insights", href: "/insights", routes: ["/insights"] },
  { permission: "page.reports", label: "Reports", href: "/reports", routes: ["/reports"] },
  { permission: "page.profit", label: "Profit", href: "/profit", routes: ["/profit", "/receipts", "/truth"] },
  { permission: "page.contacts", label: "Contacts", href: "/contacts", routes: ["/contacts"] },
  { permission: "page.pipeline", label: "Pipeline", href: "/pipeline", routes: ["/pipeline"] },
  { permission: "page.tasks", label: "My tasks", href: "/tasks", routes: ["/tasks"] },
  { permission: "page.developers", label: "Developers", href: "/developers", routes: ["/developers"] },
];

/** The page permission that guards a link (query string ignored), or null for everything else (settings…). */
export function pagePermissionFor(href: string): PagePermission | null {
  const path = href.split(/[?#]/)[0] || "/";
  for (const p of PAGES) {
    if (p.routes.some((r) => (r === "/" ? path === "/" : path === r || path.startsWith(`${r}/`)))) return p.permission;
  }
  return null;
}

/** Navigation filter: `allowed` lists the page permissions the viewer holds. */
export function hrefAllowed(href: string, allowed: readonly string[]): boolean {
  const p = pagePermissionFor(href);
  return !p || allowed.includes(p);
}

/** Where to send someone who can't open a page: their first allowed dashboard page, else their profile. */
export function firstAllowedPage(can: (p: Permission) => boolean): { href: string; label: string } {
  const p = PAGES.find((x) => can(x.permission));
  return p ? { href: p.href, label: p.label } : { href: "/settings/account", label: "Your profile" };
}

// ---- grouped catalogue for the role editor

/** `sensitive`: a short warning the role editor shows next to the permission (e.g. it exports data). */
export type PermissionItem = { permission: Permission; label: string; description: string; sensitive?: string };

export const PERMISSION_GROUPS: { title: string; items: PermissionItem[] }[] = [
  {
    title: "Pages & dashboards",
    items: [
      { permission: "page.overview", label: "Overview", description: "The home dashboard with KPIs and trends." },
      { permission: "page.live", label: "Live", description: "Visitors, leads and payments as they happen." },
      { permission: "page.performance", label: "Performance", description: "Campaigns, ad sets and ads with spend and ROAS." },
      { permission: "page.attribution", label: "Attribution", description: "Model comparison, journey paths and time to convert." },
      { permission: "page.customers", label: "Customers", description: "Lifetime value, cohorts and payback." },
      { permission: "page.insights", label: "Insights", description: "AI insights, Ask AI and alert history." },
      { permission: "page.reports", label: "Reports", description: "Report builder, PDFs and schedules." },
      { permission: "page.profit", label: "Money pages", description: "Profit, Receipts and Truth gap." },
      { permission: "reports.view", label: "Report data", description: "Read report numbers at all. Most pages need this." },
      { permission: "dashboard.edit", label: "Personal layouts", description: "Rearrange their own Overview." },
      { permission: "insights.generate", label: "Generate insights", description: "Run the AI analysis on demand." },
      { permission: "insights.ask", label: "Ask AI", description: "Ask questions about the numbers." },
    ],
  },
  {
    title: "Data & exports",
    items: [
      { permission: "reports.export", label: "Report CSVs", description: "Download campaign, channel and cohort tables." },
      { permission: "export.csv", label: "CSV downloads", description: "Any CSV download of aggregates or logs." },
      { permission: "reports.pdf", label: "PDF reports", description: "Download branded PDF reports." },
      { permission: "reports.share", label: "Share links", description: "Create read-only links to reports." },
      { permission: "reports.schedule", label: "Scheduled reports", description: "Email reports on a schedule." },
      { permission: "views.share", label: "Shared views", description: "Save and pin views for the whole workspace." },
      { permission: "export.contacts", label: "Export contacts", description: "Contact CSV with raw emails." },
    ],
  },
  {
    title: "CRM",
    items: [
      { permission: "page.contacts", label: "Contacts page", description: "Browse contacts and their journeys." },
      { permission: "page.pipeline", label: "Pipeline page", description: "The deal board and stage funnel." },
      { permission: "page.tasks", label: "My tasks page", description: "Follow-ups assigned to them." },
      { permission: "contacts.pii", label: "See emails", description: "Unmasked contact emails. Otherwise p•••@gmail.com." },
      { permission: "contacts.notes", label: "See notes and tasks", description: "Internal notes and tasks on contacts." },
      { permission: "contacts.edit", label: "Edit contacts", description: "Tags, owner, lifecycle, notes and tasks." },
      { permission: "pipeline.move", label: "Move deals", description: "Drag contacts between pipeline stages." },
    ],
  },
  {
    title: "Workspace settings",
    items: [
      { permission: "workspace.settings", label: "Workspace settings", description: "Tracking, integrations, notifications, AI model." },
      { permission: "workspace.data", label: "Workspace data", description: "Switch off demo data, merge duplicates, delete data." },
      { permission: "alerts.manage", label: "Alerts", description: "Create and edit alert rules." },
    ],
  },
  {
    title: "Developers",
    items: [
      { permission: "page.developers", label: "Developers page", description: "Quickstart, API reference and ready-made recipes." },
      { permission: "apikeys.manage", label: "API keys", description: "Keys for the REST API and MCP clients." },
      {
        permission: "developers.access",
        label: "Webhooks",
        description: "Send new leads, contacts and payments to outside URLs (Zapier, Make, n8n or their own code).",
        sensitive: "Exports data",
      },
    ],
  },
  {
    title: "Organization",
    items: [
      { permission: "workspaces.manage", label: "Create workspaces", description: "Add workspaces to the organization." },
      { permission: "members.manage", label: "Members", description: "Invite, change and remove members." },
      { permission: "roles.manage", label: "Roles & permissions", description: "Create, edit and delete roles." },
      { permission: "audit.view", label: "Audit log", description: "Security overview and the audit log." },
      { permission: "org.branding", label: "Branding", description: "Organization logo and report branding." },
      { permission: "security.manage", label: "Security policy", description: "Require 2FA, session limits, sign others out." },
      { permission: "org.manage", label: "Organization", description: "Rename the organization and delete workspaces." },
    ],
  },
];
