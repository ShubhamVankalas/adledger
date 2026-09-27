import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { isEmbeddedDb, schema, type DB } from "../db";
import type { SecurityPolicy } from "./policy";

// The security posture checklist on Settings → Organization → Security: what this install and
// organization have hardened, and what is still open. Facts only; no scores.

export type PostureItem = {
  id: string;
  label: string;
  status: "ok" | "warn" | "info";
  detail: string;
  action?: { href: string; label: string };
};

const KEY_DOCS = "https://github.com/ShubhamVankalas/adledger/blob/main/docs/SECURITY.md#encryption-key";

export type TwoFactorCoverage = { total: number; enabled: number; ownersWithout: number };

export async function twoFactorCoverage(db: DB, organizationId: string): Promise<TwoFactorCoverage> {
  const rows = await db
    .select({ role: schema.memberships.role, enabled: schema.users.totpEnabledAt })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.organizationId, organizationId));
  return {
    total: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    ownersWithout: rows.filter((r) => r.role === "owner" && !r.enabled).length,
  };
}

export async function securityPosture(db: DB, organizationId: string, policy: SecurityPolicy, opts: { https: boolean; now?: Date }): Promise<PostureItem[]> {
  const now = opts.now ?? new Date();
  const coverage = await twoFactorCoverage(db, organizationId);
  const [verified] = await db
    .select({ at: schema.auditLog.createdAt, meta: schema.auditLog.meta })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.organizationId, organizationId), eq(schema.auditLog.action, "audit.verified")))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(1);
  const workspaceIds = (await db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(eq(schema.workspaces.organizationId, organizationId))).map((w) => w.id);
  const [piiKeys] = workspaceIds.length
    ? await db
        .select({ n: count() })
        .from(schema.apiKeys)
        .where(and(inArray(schema.apiKeys.workspaceId, workspaceIds), isNull(schema.apiKeys.revokedAt), isNotNull(schema.apiKeys.scopes), sql`'contacts:pii' = any(${schema.apiKeys.scopes})`))
    : [{ n: 0 }];

  const [storedKey] = await db.select({ key: schema.appMeta.key }).from(schema.appMeta).where(eq(schema.appMeta.key, "app_secret"));
  const keyDocs = { href: KEY_DOCS, label: "How to move it" };

  const items: PostureItem[] = [];
  items.push(
    !process.env.APP_SECRET
      ? {
          id: "key",
          label: "Encryption key is stored next to the data",
          status: "warn",
          detail:
            "APP_SECRET isn't set, so the key that encrypts connector credentials and 2FA secrets was generated and saved in the database. Anyone holding a database backup can decrypt them. Copy that key into APP_SECRET on the server (a new, different value would make saved credentials unreadable).",
          action: keyDocs,
        }
      : storedKey
        ? {
            id: "key",
            label: "An old encryption key is still in the database",
            status: "warn",
            detail: "APP_SECRET is set, but the key generated before it is still saved in the database. Once APP_SECRET holds that same value and everything works, delete the stored copy.",
            action: keyDocs,
          }
        : { id: "key", label: "Encryption key kept outside the database", status: "ok", detail: "APP_SECRET is set on the server, so a copy of the database alone can't decrypt stored credentials." },
  );
  items.push(
    opts.https
      ? { id: "https", label: "Served over HTTPS", status: "ok", detail: "Sessions and API keys travel encrypted." }
      : { id: "https", label: "Not served over HTTPS", status: "warn", detail: "Passwords, session cookies and API keys cross the network in plain text. Use the Caddy profile (docker compose --profile https) or your own TLS proxy." },
  );
  const allOn = coverage.total > 0 && coverage.enabled === coverage.total;
  items.push({
    id: "2fa",
    label: policy.require2fa ? "Two-factor sign-in required" : allOn ? "Everyone uses two-factor sign-in" : "Two-factor sign-in is optional",
    status: policy.require2fa || allOn ? "ok" : "warn",
    detail: `Turned on by ${coverage.enabled} of ${coverage.total} member${coverage.total === 1 ? "" : "s"}.${coverage.ownersWithout ? ` Not yet on for ${coverage.ownersWithout} owner${coverage.ownersWithout === 1 ? "" : "s"}.` : ""}`,
  });
  items.push(
    policy.sessionIdleMinutes <= 7 * 24 * 60
      ? { id: "idle", label: "Idle sessions expire", status: "ok", detail: `After ${describeMinutes(policy.sessionIdleMinutes)} without activity, and ${policy.sessionMaxDays} days at most.` }
      : { id: "idle", label: "Idle sessions stay signed in for long", status: "warn", detail: `Sessions last ${describeMinutes(policy.sessionIdleMinutes)} without activity. Seven days or less is a good default.` },
  );
  const verifiedRecently = verified && now.getTime() - verified.at.getTime() < 30 * 86_400_000;
  items.push(
    verified && verified.meta.ok === false
      ? { id: "audit", label: "Audit log failed verification", status: "warn", detail: `The last check found a broken entry (#${String(verified.meta.brokenAt ?? "?")}). Find out who has database access.`, action: { href: "/settings/organization/audit", label: "Open audit log" } }
      : verifiedRecently
        ? { id: "audit", label: "Audit log verified", status: "ok", detail: `Checked ${Math.max(0, Math.round((now.getTime() - verified.at.getTime()) / 86_400_000))} day(s) ago; every entry matched its hash.` }
        : { id: "audit", label: "Audit log not verified recently", status: "info", detail: "Run Verify on the audit log now and then to confirm no entry was edited or removed.", action: { href: "/settings/organization/audit", label: "Verify now" } },
  );
  items.push({
    id: "pii-keys",
    label: piiKeys.n ? `${piiKeys.n} API key${piiKeys.n === 1 ? "" : "s"} can read contact emails` : "No API key can read contact emails",
    status: piiKeys.n ? "info" : "ok",
    detail: piiKeys.n ? "Keys with the contact emails scope return raw addresses. Revoke the ones you no longer use." : "API keys only see masked emails.",
    action: piiKeys.n ? { href: "/settings/workspace/api", label: "Review keys" } : undefined,
  });
  items.push(
    isEmbeddedDb()
      ? { id: "backup", label: "Back up the data folder", status: "info", detail: "This install uses the embedded database. AdLedger doesn't make backups: copy the data folder (DATA_DIR) somewhere safe, or move to PostgreSQL." }
      : { id: "backup", label: "Back up PostgreSQL", status: "info", detail: "AdLedger doesn't make backups. Use your host's snapshots or a scheduled pg_dump, and test a restore." },
  );
  return items;
}

export function describeMinutes(minutes: number): string {
  if (minutes % (24 * 60) === 0) {
    const d = minutes / (24 * 60);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}
