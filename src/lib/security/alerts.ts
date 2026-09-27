import { eq } from "drizzle-orm";
import type { NotificationMessage } from "../connectors/types";
import { getDb, schema, type DB } from "../db";
import { log } from "../log";
import { appUrl, notify } from "../notify";
import { maskEmail } from "../reports";
import { scopeLabel } from "./scopes";

// Security alerts (notification event "security_alert"): a new API key, a role change, 2FA turned
// off, a bulk or full export, a contact erasure, a sign-in from a new device. They are raised from
// audit(), so every place that logs one of these actions alerts too. Messages carry names and
// counts only: never a contact's email, never a token.

export const BULK_EXPORT_ROWS = 1000;

type Entry = { organizationId: string; workspaceId: string | null; userId: string | null; action: string; target: string | null; meta: Record<string, unknown> };

async function actorName(db: DB, userId: string | null): Promise<string> {
  if (!userId) return "An API key";
  const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, userId));
  return u?.name || maskEmail(u?.email ?? null) || "Someone";
}

async function workspaceName(db: DB, id: string | null) {
  if (!id) return null;
  const [w] = await db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, id));
  return w?.name ?? null;
}

/** The alert for an audit entry, or null when the action isn't security-relevant. */
export async function alertFor(db: DB, e: Entry): Promise<NotificationMessage | null> {
  const m = e.meta;
  const who = () => actorName(db, e.userId);
  const where = async () => {
    const ws = await workspaceName(db, e.workspaceId);
    return ws ? ` in ${ws}` : "";
  };
  const url = appUrl("/settings/organization/audit");
  switch (e.action) {
    case "api_key.created": {
      const scopes = Array.isArray(m.scopes) ? (m.scopes as string[]).map(scopeLabel).join(", ") : "reports";
      return { title: `New API key${await where()}`, text: `${await who()} created the API key **${e.target ?? "API key"}** (${scopes}). If you didn't expect this, revoke it in Settings → API & MCP.`, severity: "warning", url };
    }
    case "member.updated": {
      if (typeof m.role !== "string") return null;
      const member = await actorName(db, e.target);
      return { title: "A member's role changed", text: `${await who()} changed ${member}'s role to **${m.role}**.`, severity: "warning", url };
    }
    case "account.2fa_disabled":
      return { title: "Two-factor sign-in turned off", text: `${await who()} turned off two-factor sign-in for their account.`, severity: "critical", url };
    case "security.2fa_reset": {
      const member = await actorName(db, e.target);
      const by = m.via === "break_glass" ? "The server operator (ADLEDGER_BREAK_GLASS)" : await who();
      return { title: "Two-factor sign-in reset", text: `${by} reset two-factor sign-in for ${member}.`, severity: "critical", url };
    }
    case "contacts.exported": {
      const rows = typeof m.rows === "number" ? m.rows : 0;
      if (rows <= BULK_EXPORT_ROWS) return null;
      const kind = m.masked ? "a masked contacts CSV" : "a contacts CSV with emails";
      return { title: `Bulk contact export${await where()}`, text: `${await who()} exported ${kind}: **${rows.toLocaleString("en-US")} contacts**.`, severity: "warning", url };
    }
    case "workspace.exported":
      return { title: `Full workspace export${await where()}`, text: `${await who()} downloaded every row of data in the workspace.`, severity: "warning", url };
    case "contact.erased":
      return { title: `Contact erased${await where()}`, text: `${await who()} permanently deleted a contact (erasure request).`, severity: "info", url };
    case "auth.new_device": {
      const device = typeof m.device === "string" ? m.device : "a new device";
      return { title: "Sign-in from a new device", text: `${await who()} signed in from **${device}** for the first time.`, severity: "warning", url: appUrl("/settings/account/security") };
    }
    default:
      return null;
  }
}

/**
 * Deliver the alert for an audit entry to the security_alert rules of the entry's workspace, or of
 * every workspace in the organization for organization-wide events. Never throws.
 */
export async function raiseSecurityAlert(e: Entry, db?: DB) {
  try {
    const d = db ?? (await getDb());
    const msg = await alertFor(d, e);
    if (!msg) return;
    const targets = e.workspaceId && !["member.updated", "auth.new_device", "account.2fa_disabled", "security.2fa_reset"].includes(e.action)
      ? [e.workspaceId]
      : (await d.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.organizationId, e.organizationId))).map((w) => w.id);
    for (const id of targets) await notify(id, "security_alert", () => msg, d);
  } catch (err) {
    log.warn("security alert failed", err);
  }
}

