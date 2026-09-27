import { desc, eq } from "drizzle-orm";
import { FileClockIcon } from "lucide-react";
import { SettingsHeader } from "@/components/settings/section";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { allIntegrations } from "@/lib/connectors/registry";
import { getDb, schema } from "@/lib/db";

export const metadata = { title: "Audit log" };

const LABELS: Record<string, string> = {
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
  "member.updated": "changed a member's access",
  "member.removed": "removed a member",
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
  "organization.logo_updated": "uploaded a new logo for",
  "organization.logo_removed": "removed the logo of",
  "contact.erased": "deleted a contact (erasure request)",
  "contact.exported": "exported a contact's data",
  "contacts.exported": "exported contacts as CSV",
  "workspace.exported": "exported all data from",
  "retention.updated": "set raw event retention to",
};

export default async function AuditPage() {
  const user = await requireUser("audit.view");
  const db = await getDb();
  const rows = await db
    .select({ log: schema.auditLog, email: schema.users.email, name: schema.users.name, workspace: schema.workspaces.name })
    .from(schema.auditLog)
    .leftJoin(schema.users, eq(schema.users.id, schema.auditLog.userId))
    .leftJoin(schema.workspaces, eq(schema.workspaces.id, schema.auditLog.workspaceId))
    .where(eq(schema.auditLog.organizationId, user.organization.id))
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(300);
  const tz = user.workspace.timezone;
  const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: tz });
  const timeFmt = new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: tz });
  const fullFmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz });
  // Group entries by day (in the workspace timezone) so long logs are easy to scan.
  const days: { day: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const day = dayFmt.format(r.log.createdAt);
    if (days.at(-1)?.day !== day) days.push({ day, rows: [] });
    days.at(-1)!.rows.push(r);
  }
  // Integration entries store the provider id (e.g. notify_slack); show its display name.
  const names = new Map(allIntegrations().map((i) => [i.provider, i.name]));
  names.set("llm", "AI model");
  const target = (a: string, t: string | null) => {
    if (!t || /^[0-9a-f-]{36}$/i.test(t) || ["member.invite_revoked", "member.updated", "member.removed"].includes(a)) return "";
    return a.startsWith("integration.") ? (names.get(t) ?? t) : t;
  };

  return (
    <>
      <SettingsHeader title="Audit log" description="Who changed what, across every workspace in the organization. The latest 300 entries." />
      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <FileClockIcon className="size-5 text-muted-foreground" />
            <p className="text-sm font-medium">Nothing logged yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">Changes to settings, members, integrations and data will show up here.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="p-0">
            {days.map((d) => (
              <section key={d.day} aria-label={d.day}>
                <h3 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground [&:not(:first-child)]:border-t">{d.day}</h3>
                <ol className="divide-y">
                  {d.rows.map(({ log, email, name, workspace }) => (
                    <li key={log.id} className="grid gap-x-4 gap-y-0.5 px-4 py-2.5 text-sm @xl/settings:grid-cols-[minmax(0,1fr)_auto] @xl/settings:items-baseline">
                      <span className="min-w-0 break-words">
                        <span className="font-medium">{name || email || "System"}</span> {LABELS[log.action] ?? log.action}{" "}
                        <span className="font-medium">{target(log.action, log.target)}</span>
                        {typeof log.meta.role === "string" ? <span className="text-muted-foreground"> ({log.meta.role})</span> : null}
                        {workspace ? <span className="text-muted-foreground"> · {workspace}</span> : null}
                      </span>
                      <time className="text-xs text-muted-foreground tabular-nums" dateTime={log.createdAt.toISOString()} title={fullFmt.format(log.createdAt)}>
                        {timeFmt.format(log.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
