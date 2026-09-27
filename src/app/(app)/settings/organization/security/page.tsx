import { eq } from "drizzle-orm";
import { CheckIcon, MinusIcon } from "lucide-react";
import { headers } from "next/headers";
import { SettingsHeader } from "@/components/settings/section";
import { MembersTwoFactor, PolicyForm, PostureChecklist } from "@/components/settings/security-policy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { mediaUrl } from "@/lib/media";
import { ROLES, roleCan, roleLabel, type Permission } from "@/lib/permissions";
import { IDLE_CHOICES, MAX_DAYS_CHOICES, policyCan } from "@/lib/security/policy";
import { securityPosture } from "@/lib/security/posture";

export const metadata = { title: "Security policy" };

const ACCESS: { permission: Permission; label: string }[] = [
  { permission: "contacts.pii", label: "See contact emails" },
  { permission: "export.contacts", label: "Export contacts with emails" },
  { permission: "export.csv", label: "Download CSV exports" },
  { permission: "reports.pdf", label: "Download PDF reports" },
  { permission: "apikeys.manage", label: "Create API keys" },
  { permission: "audit.view", label: "Read the audit log" },
];

export default async function OrganizationSecurityPage() {
  const user = await requireUser("audit.view");
  const db = await getDb();
  const h = await headers();
  const https = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() === "https" || (process.env.PUBLIC_URL ?? "").startsWith("https://");
  const [posture, members] = await Promise.all([
    securityPosture(db, user.organization.id, user.security, { https }),
    db
      .select({ role: schema.memberships.role, id: schema.users.id, name: schema.users.name, email: schema.users.email, totp: schema.users.totpEnabledAt, avatarUpdatedAt: schema.users.avatarUpdatedAt, lastLoginAt: schema.users.lastLoginAt })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .where(eq(schema.memberships.organizationId, user.organization.id))
      .orderBy(schema.memberships.createdAt),
  ]);
  const editable = user.can("security.manage");

  return (
    <>
      <SettingsHeader title="Security policy" description={`Rules for everyone in ${user.organization.name}, and how this install is protected.`} />
      <PostureChecklist items={posture} />
      <PolicyForm policy={user.security} editable={editable} has2fa={user.has2fa} idleChoices={IDLE_CHOICES} maxDaysChoices={MAX_DAYS_CHOICES} />
      <MembersTwoFactor
        canReset={editable}
        required={user.security.require2fa}
        members={members.map((m) => ({
          userId: m.id,
          name: m.name,
          email: m.email,
          avatarUrl: mediaUrl("user", m.id, m.avatarUpdatedAt),
          role: roleLabel(m.role),
          has2fa: Boolean(m.totp),
          lastLoginAt: m.lastLoginAt?.toISOString() ?? null,
          me: m.id === user.id,
        }))}
      />
      <Card>
        <CardHeader>
          <CardTitle>Who can see and take data</CardTitle>
          <CardDescription>Fixed per role. Viewers and clients always see contact emails masked, like p•••@gmail.com.</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <div tabIndex={0} aria-label="Permissions by role" className="overflow-x-auto overscroll-x-contain rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <table className="w-full min-w-[34rem] text-sm">
              <caption className="sr-only">Permissions by role</caption>
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 pl-4 font-medium">
                    Permission
                  </th>
                  {ROLES.map((r) => (
                    <th key={r.role} scope="col" className="px-3 py-2 text-center font-medium">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {ACCESS.map((a) => (
                  <tr key={a.permission}>
                    <th scope="row" className="py-2.5 pr-3 pl-4 text-left font-normal">
                      {a.label}
                    </th>
                    {ROLES.map((r) => {
                      const yes = policyCan(r.role, a.permission, user.security) && roleCan(r.role, a.permission);
                      return (
                        <td key={r.role} className="px-3 py-2.5 text-center">
                          {yes ? <CheckIcon aria-label="Yes" className="mx-auto size-4" strokeWidth={2} /> : <MinusIcon aria-label="No" className="mx-auto size-4 text-muted-foreground/60" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
