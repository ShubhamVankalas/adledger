import { and, count, desc, eq, isNotNull } from "drizzle-orm";
import { ChevronRightIcon, DownloadIcon, FileClockIcon, LinkIcon } from "lucide-react";
import Link from "next/link";
import { verifyAuditLogAction } from "@/app/actions/security";
import { ActionButton } from "@/components/action-button";
import { SettingsHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { allIntegrations } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";
import { AUDIT_CATEGORIES, AUDIT_LABELS, AUDIT_PERIODS, auditCursor, parseAuditFilters, queryAudit, targetNames, USER_TARGETS } from "@/lib/security/audit-query";
import { describeUserAgent } from "@/lib/security/device";
import { AuditFilters } from "./audit-filters";

export const metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({ searchParams }: PageProps<"/settings/organization/audit">) {
  const user = await requireUser("audit.view");
  const db = await getDb();
  const orgId = user.organization.id;
  const filters = parseAuditFilters(await searchParams);
  const [rows, members, [{ n: total }], [head], [lastVerify]] = await Promise.all([
    queryAudit(db, orgId, filters, PAGE + 1),
    db
      .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, orgId))
      .orderBy(schema.memberships.createdAt),
    db.select({ n: count() }).from(schema.auditLog).where(eq(schema.auditLog.organizationId, orgId)),
    db
      .select({ seq: schema.auditLog.seq, hash: schema.auditLog.hash })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.organizationId, orgId), isNotNull(schema.auditLog.seq)))
      .orderBy(desc(schema.auditLog.seq))
      .limit(1),
    db
      .select({ at: schema.auditLog.createdAt, meta: schema.auditLog.meta })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.organizationId, orgId), eq(schema.auditLog.action, "audit.verified")))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1),
  ]);
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const names = await targetNames(db, shown);

  const tz = user.workspace.timezone;
  const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz });
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: tz });
  const fullFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "medium", timeZone: tz });
  // Group entries by day (in the workspace timezone) so long logs are easy to scan.
  const days: { day: string; rows: typeof shown }[] = [];
  for (const r of shown) {
    const day = dayFmt.format(r.log.createdAt);
    if (days.at(-1)?.day !== day) days.push({ day, rows: [] });
    days.at(-1)!.rows.push(r);
  }
  // Integration entries store the provider id (e.g. notify_slack); show its display name.
  const integrationNames = new Map(allIntegrations().map((i) => [i.provider, i.name]));
  integrationNames.set("llm", "AI model");
  const target = (a: string, t: string | null) => {
    if (!t) return "";
    if (USER_TARGETS.has(a)) return names.get(t) ?? "a former member";
    if (/^[0-9a-f-]{36}$/i.test(t) || a === "member.invite_revoked") return "";
    return a.startsWith("integration.") ? (integrationNames.get(t) ?? t) : t;
  };
  const qs = new URLSearchParams(
    Object.entries({ category: filters.category, member: filters.member, workspace: filters.workspace, period: filters.period === "90d" ? null : filters.period }).filter(
      (e): e is [string, string] => Boolean(e[1]),
    ),
  );
  const olderHref = more ? `?${new URLSearchParams([...qs, ["before", auditCursor(shown.at(-1)!.log)]])}` : null;
  const verified = lastVerify ? { ok: lastVerify.meta.ok !== false, at: fullFmt.format(lastVerify.at), brokenAt: lastVerify.meta.brokenAt } : null;
  const filtered = Boolean(filters.category || filters.member || filters.workspace || filters.period !== "90d");

  return (
    <>
      <SettingsHeader title="Audit log" description="Who did what, in every workspace. Entries are hash-chained, so edits show up on Verify.">
        {user.can("export.csv") ? (
          <Button variant="outline" size="sm" render={<a href={`/api/v1/exports/audit${qs.size ? `?${qs}` : ""}`} download />}>
            <DownloadIcon /> Export CSV
          </Button>
        ) : null}
        <ActionButton action={verifyAuditLogAction} size="sm" variant="outline">
          <LinkIcon /> Verify chain
        </ActionButton>
      </SettingsHeader>

      <div className="flex flex-col gap-4 @3xl/settings:flex-row @3xl/settings:items-end @3xl/settings:justify-between">
        <AuditFilters
          values={{ category: filters.category ?? "", member: filters.member ?? "", workspace: filters.workspace ?? "", period: filters.period }}
          categories={AUDIT_CATEGORIES.map((c) => ({ value: c.id, label: c.label }))}
          members={[...members.map((m) => ({ value: m.id, label: m.name || m.email })), { value: "system", label: "System and API keys" }]}
          workspaces={user.workspaces.map((w) => ({ value: w.id, label: w.name }))}
          periods={AUDIT_PERIODS.map((p) => ({ value: p.id, label: p.label }))}
        />
        <div className="shrink-0 space-y-0.5 text-xs text-muted-foreground @3xl/settings:text-right">
          <p className="tabular-nums">
            {total.toLocaleString("en-US")} {total === 1 ? "entry" : "entries"}
            {head?.hash ? (
              <>
                {" · head "}
                <code className="font-mono text-foreground" translate="no" title={head.hash}>
                  #{head.seq} {head.hash.slice(0, 10)}
                </code>
              </>
            ) : null}
          </p>
          <p className={verified && !verified.ok ? "font-medium text-destructive" : undefined}>
            {verified ? (verified.ok ? `Verified ${verified.at}` : `Verification failed at #${String(verified.brokenAt ?? "?")} on ${verified.at}`) : "Not verified yet"}
          </p>
        </div>
      </div>

      {shown.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <FileClockIcon aria-hidden className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">{filtered ? "No entries match these filters" : "Nothing logged yet"}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {filtered ? "Try a longer period or a different kind of activity." : "Sign-ins and changes to settings, members, integrations and data show up here."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            {days.map((d) => (
              <section key={d.day} aria-label={d.day} className="[contain-intrinsic-size:auto_12rem] [content-visibility:auto]">
                <h3 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground [&:not(:first-child)]:border-t">{d.day}</h3>
                <ol className="divide-y">
                  {d.rows.map(({ log, name, workspace }) => {
                    const device = log.userAgent ? describeUserAgent(log.userAgent).label : null;
                    const failed = log.action === "auth.login_failed" || log.action === "account.2fa_disabled" || log.action === "security.2fa_reset";
                    return (
                      <li key={log.id} className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm @xl/settings:grid-cols-[minmax(0,1fr)_auto]">
                        <span className="min-w-0 break-words">
                          <span className="font-medium">{name || (log.userId ? "A former member" : log.meta.via === "break_glass" ? "Server operator" : log.meta.via === "api_key" ? "API key" : "System")}</span>{" "}
                          <span className={failed ? "font-medium" : undefined}>{AUDIT_LABELS[log.action] ?? log.action}</span> <span className="font-medium">{target(log.action, log.target)}</span>
                          {typeof log.meta.role === "string" ? <span className="text-muted-foreground"> ({log.meta.role})</span> : null}
                          {typeof log.meta.rows === "number" ? <span className="text-muted-foreground tabular-nums"> ({log.meta.rows.toLocaleString("en-US")} rows{log.meta.masked ? ", masked" : ""})</span> : null}
                          {typeof log.meta.count === "number" && log.action === "contact.pii_revealed" ? <span className="text-muted-foreground tabular-nums"> ({log.meta.count})</span> : null}
                          {workspace ? <span className="text-muted-foreground"> · {workspace}</span> : null}
                        </span>
                        <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground @xl/settings:justify-end">
                          <time className="tabular-nums" dateTime={log.createdAt.toISOString()} title={fullFmt.format(log.createdAt)}>
                            {timeFmt.format(log.createdAt)}
                          </time>
                          {device || log.ipTrunc ? (
                            <span className="truncate" title={log.userAgent ?? undefined}>
                              {[device, log.ipTrunc].filter(Boolean).join(", ")}
                            </span>
                          ) : null}
                          {log.seq ? <span className="font-mono tabular-nums">#{log.seq}</span> : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </CardContent>
        </Card>
      )}
      {olderHref ? (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" render={<Link href={olderHref} scroll={false} />}>
            Older entries <ChevronRightIcon />
          </Button>
        </div>
      ) : null}
    </>
  );
}
