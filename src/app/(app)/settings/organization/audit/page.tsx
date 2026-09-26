import { desc, eq } from "drizzle-orm";
import { SettingsHeader } from "@/components/settings/section";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
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
  const fmt = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: user.workspace.timezone });
  const target = (a: string, t: string | null) => (t && !/^[0-9a-f-]{36}$/i.test(t) && !["member.invite_revoked", "member.updated", "member.removed"].includes(a) ? t : "");

  return (
    <>
      <SettingsHeader title="Audit log" description="Who changed what, across every workspace in the organization. The latest 300 entries." />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nothing yet.</p> : null}
          <ol className="divide-y">
            {rows.map(({ log, email, name, workspace }) => (
              <li key={log.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span>
                  <span className="font-medium">{name || email || "System"}</span> {LABELS[log.action] ?? log.action}{" "}
                  <span className="font-medium">{target(log.action, log.target)}</span>
                  {typeof log.meta.role === "string" ? <span className="text-muted-foreground"> ({log.meta.role})</span> : null}
                  {workspace ? <span className="text-muted-foreground"> · {workspace}</span> : null}
                </span>
                <time className="text-xs text-muted-foreground tabular" dateTime={log.createdAt.toISOString()}>
                  {fmt.format(log.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
