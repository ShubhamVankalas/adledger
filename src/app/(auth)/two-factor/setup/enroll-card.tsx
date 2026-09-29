"use client";

import { useRouter } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";
import { TwoFactorEnroll } from "@/components/settings/two-factor-enroll";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { authCard, authLead, authTitle } from "../../styles";

export function EnrollCard({ organization }: { organization: string }) {
  const router = useRouter();
  return (
    <Card className={authCard} data-wide>
      <CardHeader>
        <CardTitle className={authTitle}>
          <h1>Set up two-factor sign-in</h1>
        </CardTitle>
        <CardDescription className={cn(authLead, "text-pretty")}>
          {organization} asks everyone to sign in with a code from an authenticator app as well as a password. It takes about a minute.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <TwoFactorEnroll
          finishLabel="Continue to AdLedger"
          onFinished={() => {
            router.replace("/");
            router.refresh();
          }}
        />
        <form action={logoutAction} className="border-t pt-4">
          <button
            type="submit"
            className="min-h-10 rounded-md px-1 text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            Sign out
          </button>
        </form>
      </CardContent>
    </Card>
  );
}
