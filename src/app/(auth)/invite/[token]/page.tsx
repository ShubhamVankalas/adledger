import { eq } from "drizzle-orm";
import { LinkIcon, MailIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findInvitation, getSessionUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { AcceptInviteForm } from "./accept-form";
import { authCard, authTitle } from "../../styles";

export const metadata = { title: "Join" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const found = await findInvitation(token);
  if (!found) {
    return (
      <Card className={authCard}>
        <CardHeader>
          <span className="mb-2 flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <LinkIcon className="size-5" />
          </span>
          <CardTitle className={authTitle}>
            <h1>This invitation isn&apos;t valid</h1>
          </CardTitle>
          <CardDescription>It may have expired, been revoked, or already been used. Ask the person who invited you for a new link.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/login" />} variant="outline" size="lg" className="h-11 w-full sm:h-10">
            Go to sign in
          </Button>
        </CardContent>
      </Card>
    );
  }
  const { invitation, organization } = found;
  const db = await getDb();
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, invitation.email));
  const current = await getSessionUser();
  const mode = current?.email === invitation.email ? "signed-in" : existing ? "existing" : "new";
  return (
    <Card className={authCard}>
      <CardHeader>
        <CardTitle className={`${authTitle} break-words`}>
          <h1>Join {organization.name}</h1>
        </CardTitle>
        <CardDescription>You&apos;ve been invited to see which ads are making {organization.name} money.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <div className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 shrink-0 text-primary" />
            <dt className="text-muted-foreground">Role</dt>
            <dd className="ml-auto font-medium">{roleLabel(invitation.role)}</dd>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <MailIcon className="size-4 shrink-0 text-primary" />
            <dt className="text-muted-foreground">Email</dt>
            <dd className="ml-auto min-w-0 truncate font-medium" title={invitation.email}>
              {invitation.email}
            </dd>
          </div>
        </dl>
        <AcceptInviteForm token={token} mode={mode} email={invitation.email} />
      </CardContent>
    </Card>
  );
}
