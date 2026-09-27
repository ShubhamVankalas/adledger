import { and, desc, eq, gte, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import { schema, type DB } from "../db";

// Filters, labels and queries shared by the audit log page and its CSV export.

export const AUDIT_LABELS: Record<string, string> = {
  "organization.created": "created the organization",
  "organization.updated": "renamed the organization to",
  "workspace.created": "created workspace",
  "workspace.updated": "updated workspace settings for",
  "workspace.deleted": "deleted workspace",
  "workspace.data_cleared": "cleared all data in",
  "workspace.demo_loaded": "loaded demo data into",
  "member.invited": "invited",
  "member.invite_revoked": "revoked an invitation",
  "member.joined": "joined as",
  "member.updated": "changed the role of",
  "member.removed": "removed",
  "integration.saved": "connected or updated",
  "integration.disconnected": "disconnected",
  "ai_model.saved": "set the AI model to",
  "api_key.created": "created API key",
  "api_key.revoked": "revoked an API key",
  "pixel_site.created": "added website",
  "pixel_site.deleted": "removed a website",
  "lead_webhook.created": "created lead webhook",
  "lead_webhook.deleted": "deleted a lead webhook",
  "notifications.updated": "updated notification rules",
  "import.spend_csv": "imported a spend CSV",
  "import.revenue_csv": "imported a payments CSV",
  "account.password_changed": "changed their password",
  "account.avatar_updated": "updated their profile picture",
  "account.avatar_removed": "removed their profile picture",
  "account.2fa_enabled": "turned on two-factor sign-in",
  "account.2fa_disabled": "turned off two-factor sign-in",
  "account.recovery_codes_regenerated": "created new recovery codes",
  "account.recovery_code_used": "signed in with a recovery code",
  "auth.login": "signed in",
  "auth.login_failed": "failed to sign in",
  "auth.new_device": "signed in from a new device",
  "auth.logout": "signed out",
  "session.revoked": "signed out one of their devices",
  "session.revoked_all": "signed out everywhere else",
  "security.policy_updated": "updated the security policy",
  "security.2fa_reset": "reset two-factor sign-in for",
  "organization.logo_updated": "uploaded a new logo for",
  "organization.logo_removed": "removed the logo of",
  "contact.erased": "deleted a contact (erasure request)",
  "contact.exported": "exported a contact’s data",
  "contact.pii_revealed": "revealed contact emails",
  "contacts.exported": "exported contacts as CSV",
  "workspace.exported": "exported all data from",
  "retention.updated": "set raw event retention to",
  "audit.verified": "verified the audit log",
  "audit.exported": "exported the audit log",
};

/** Actions whose target is a user id: shown as that member's name. */
export const USER_TARGETS = new Set(["member.updated", "member.removed", "security.2fa_reset"]);

export const AUDIT_CATEGORIES = [
  { id: "signin", label: "Sign-ins", match: ["auth.%"] },
  { id: "security", label: "Security", match: ["account.2fa%", "account.recovery%", "account.password%", "security.%", "session.%", "api_key.%", "audit.%", "contact.pii_revealed"] },
  { id: "members", label: "Members", match: ["member.%"] },
  { id: "data", label: "Data & exports", match: ["contacts.exported", "contact.%", "workspace.exported", "workspace.data_cleared", "workspace.demo_loaded", "import.%", "retention.%"] },
  { id: "settings", label: "Settings", match: ["workspace.created", "workspace.updated", "workspace.deleted", "organization.%", "notifications.%", "pixel_site.%", "lead_webhook.%", "ai_model.%", "account.avatar%"] },
  { id: "integrations", label: "Integrations", match: ["integration.%"] },
] as const;

export const AUDIT_PERIODS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "all", label: "All time", days: null },
] as const;

export type AuditFilters = { category: string | null; member: string | null; workspace: string | null; period: string; before: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAuditFilters(sp: Record<string, string | string[] | undefined> | URLSearchParams): AuditFilters {
  const get = (k: string) => {
    const v = sp instanceof URLSearchParams ? sp.get(k) : sp[k];
    return typeof v === "string" ? v : null;
  };
  const category = get("category");
  const member = get("member");
  const workspace = get("workspace");
  const period = get("period");
  const before = get("before");
  return {
    category: AUDIT_CATEGORIES.some((c) => c.id === category) ? category : null,
    member: member === "system" || (member && UUID.test(member)) ? member : null,
    workspace: workspace && UUID.test(workspace) ? workspace : null,
    period: AUDIT_PERIODS.some((p) => p.id === period) ? period! : "90d",
    before: parseCursor(before) ? before : null,
  };
}

/** Keyset cursor "ISO-timestamp~entry-id": entries strictly older than that one. */
export const auditCursor = (r: { createdAt: Date; id: string }) => `${r.createdAt.toISOString()}~${r.id}`;

function parseCursor(v: string | null): { at: Date; id: string } | null {
  const [iso, id] = (v ?? "").split("~");
  if (!iso || !id || !UUID.test(id) || Number.isNaN(Date.parse(iso))) return null;
  return { at: new Date(iso), id };
}

export function auditWhere(organizationId: string, f: AuditFilters, now = new Date()): SQL | undefined {
  const parts: (SQL | undefined)[] = [eq(schema.auditLog.organizationId, organizationId)];
  const cat = AUDIT_CATEGORIES.find((c) => c.id === f.category);
  if (cat) parts.push(or(...cat.match.map((m) => (m.includes("%") ? like(schema.auditLog.action, m) : eq(schema.auditLog.action, m)))));
  if (f.member === "system") parts.push(sql`${schema.auditLog.userId} is null`);
  else if (f.member) parts.push(eq(schema.auditLog.userId, f.member));
  if (f.workspace) parts.push(eq(schema.auditLog.workspaceId, f.workspace));
  const days = AUDIT_PERIODS.find((p) => p.id === f.period)?.days;
  if (days) parts.push(gte(schema.auditLog.createdAt, new Date(now.getTime() - days * 86_400_000)));
  const cursor = parseCursor(f.before);
  if (cursor) parts.push(or(lt(schema.auditLog.createdAt, cursor.at), and(eq(schema.auditLog.createdAt, cursor.at), lt(schema.auditLog.id, cursor.id))));
  return and(...parts);
}

export async function queryAudit(db: DB, organizationId: string, f: AuditFilters, limit: number) {
  return db
    .select({ log: schema.auditLog, name: schema.users.name, workspace: schema.workspaces.name })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.auditLog.workspaceId))
    .where(auditWhere(organizationId, f))
    .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
    .limit(limit);
}

/** Names for user-id targets (member changes), keyed by id. */
export async function targetNames(db: DB, rows: { log: { action: string; target: string | null } }[]) {
  const ids = [...new Set(rows.filter((r) => USER_TARGETS.has(r.log.action) && r.log.target && UUID.test(r.log.target)).map((r) => r.log.target!))];
  if (!ids.length) return new Map<string, string>();
  const users = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids));
  return new Map(users.map((u) => [u.id, u.name || "a member"]));
}
