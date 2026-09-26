import { eq } from "drizzle-orm";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { findInvitation, getSessionUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { AcceptInviteForm } from "./accept-form";

export const metadata = { title: "Join" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const found = await findInvitation(token);
  if (!found) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">This invitation isn&apos;t valid</CardTitle>
          <CardDescription>It may have expired, been revoked, or already been used. Ask the person who invited you for a new link.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button render={<Link href="/login" />} variant="outline">
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
    <Card className="shadow-xl shadow-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">Join {organization.name}</CardTitle>
        <CardDescription>
          You&apos;ve been invited as <strong>{roleLabel(invitation.role)}</strong> with <strong>{invitation.email}</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInviteForm token={token} mode={mode} email={invitation.email} />
      </CardContent>
    </Card>
  );
}
