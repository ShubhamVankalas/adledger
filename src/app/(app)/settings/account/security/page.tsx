import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsHeader } from "@/components/settings/section";
import { PasswordSection, SessionsSection, TwoFactorSection, type SessionRow } from "@/components/settings/security-forms";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { describeUserAgent } from "@/lib/security/device";
import { minPasswordLength } from "@/lib/security/password-policy";
import { describeMinutes } from "@/lib/security/posture";
import { sessionExpired } from "@/lib/security/policy";
import { twoFactorStatus } from "@/lib/security/two-factor";

export const metadata = { title: "Security" };

const ACTIVITY: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in attempt",
  "auth.new_device": "Signed in from a new device",
  "auth.logout": "Signed out",
  "account.password_changed": "Changed password",
  "account.2fa_enabled": "Turned on two-factor sign-in",
  "account.2fa_disabled": "Turned off two-factor sign-in",
  "account.recovery_codes_regenerated": "Created new recovery codes",
  "account.recovery_code_used": "Signed in with a recovery code",
  "session.revoked": "Signed out a device",
  "session.revoked_all": "Signed out everywhere else",
};

export default async function AccountSecurityPage() {
  const user = await requireUser();
  const db = await getDb();
  const [status, sessionRows, activity] = await Promise.all([
    twoFactorStatus(user.id),
    db
      .select({ session: schema.sessions, workspace: schema.workspaces.name })
      .from(schema.sessions)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.sessions.workspaceId))
      .where(and(eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date())))
      .orderBy(desc(schema.sessions.lastSeenAt)),
    db
      .select({ action: schema.auditLog.action, meta: schema.auditLog.meta, at: schema.auditLog.createdAt, ip: schema.auditLog.ipTrunc, ua: schema.auditLog.userAgent })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, user.id), eq(schema.auditLog.organizationId, user.organization.id), inArray(schema.auditLog.action, Object.keys(ACTIVITY))))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(12),
  ]);
  const policy = user.security;
  const sessions: SessionRow[] = sessionRows
    // Sessions past this organization's idle or lifetime limit are already dead; don't list them.
    .filter(({ session: s }) => s.id === user.sessionId || !sessionExpired(s, policy))
    .map(({ session: s, workspace }) => {
      const d = describeUserAgent(s.userAgent);
      return {
        id: s.id,
        device: s.userAgent ? d.label : "Unknown device",
        mobile: d.mobile,
        ip: s.ipTrunc,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: (s.lastSeenAt ?? s.createdAt).toISOString(),
        method: s.authMethod,
        workspace,
        current: s.id === user.sessionId,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));
  const tz = user.workspace.timezone;
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz });

  return (
    <>
      <SettingsHeader title="Security" description="How you sign in, and where you’re signed in." />
      <TwoFactorSection enabled={status.enabled} enabledAt={status.enabledAt?.toISOString() ?? null} recoveryLeft={status.recoveryLeft} required={policy.require2fa} />
      <PasswordSection minLength={minPasswordLength(status.enabled)} has2fa={status.enabled} email={user.email} name={user.name ?? ""} />
      <SessionsSection sessions={sessions} idle={describeMinutes(policy.sessionIdleMinutes)} maxDays={policy.sessionMaxDays} />
      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>Sign-ins and security changes on your account in {user.organization.name}.</CardDescription>
        </CardHeader>
        <CardContent>
          {activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet. Sign-ins and security changes will appear here.</p>
          ) : (
            <ol className="divide-y text-sm">
              {activity.map((a, i) => {
                const device = typeof a.meta.device === "string" ? a.meta.device : a.ua ? describeUserAgent(a.ua).label : null;
                return (
                  <li key={i} className="grid gap-x-4 gap-y-0.5 py-2.5 first:pt-0 last:pb-0 @xl/settings:grid-cols-[minmax(0,1fr)_auto] @xl/settings:items-baseline">
                    <span className="min-w-0">
                      <span className={a.action === "auth.login_failed" || a.action === "account.2fa_disabled" ? "font-medium" : undefined}>{ACTIVITY[a.action]}</span>
                      {device || a.ip ? (
                        <span className="text-muted-foreground">
                          {" "}
                          {device ? `on ${device}` : null}
                          {a.ip ? (
                            <span className="ml-2 font-mono text-xs tabular-nums" translate="no">
                              {a.ip}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </span>
                    <time className="text-xs text-muted-foreground tabular-nums" dateTime={a.at.toISOString()}>
                      {fmt.format(a.at)}
                    </time>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
