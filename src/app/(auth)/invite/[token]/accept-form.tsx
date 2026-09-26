"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";
import { acceptInviteAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AcceptInviteForm({ token, mode, email }: { token: string; mode: "signed-in" | "existing" | "new"; email: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction.bind(null, token), undefined);
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="grid gap-4">
      {mode === "new" ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-name">Your name</Label>
            <Input id="inv-name" name="name" autoComplete="name" required autoFocus defaultValue={state?.values?.name} />
            {e.name ? <p className="text-xs text-destructive">{e.name}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="inv-pw">Choose a password</Label>
            <Input id="inv-pw" name="password" type="password" autoComplete="new-password" minLength={8} required />
            {e.password ? <p className="text-xs text-destructive">{e.password}</p> : <p className="text-xs text-muted-foreground">At least 8 characters. You&apos;ll sign in with {email}.</p>}
          </div>
        </>
      ) : mode === "existing" ? (
        <div className="grid gap-1.5">
          <Label htmlFor="inv-pw">Password for {email}</Label>
          <Input id="inv-pw" name="password" type="password" autoComplete="current-password" required autoFocus />
          <p className="text-xs text-muted-foreground">You already have an AdLedger account on this install. Confirm your password to join.</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">You&apos;re signed in as {email}.</p>
      )}
      {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2Icon className="animate-spin" /> : null}
        {mode === "new" ? "Create account & join" : "Join"}
      </Button>
    </form>
  );
}
