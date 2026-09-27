"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useRef } from "react";
import { acceptInviteAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthField, FormError, PasswordInput, authButton, authInput, describedBy, useFocusFirstError } from "../../fields";

export function AcceptInviteForm({ token, mode, email }: { token: string; mode: "signed-in" | "existing" | "new"; email: string }) {
  const [state, action, pending] = useActionState(acceptInviteAction.bind(null, token), undefined);
  const e = state?.fieldErrors ?? {};
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstError(form, state);
  return (
    <form ref={form} action={action} className="grid gap-4">
      {mode === "new" ? (
        <>
          <AuthField label="Your name" htmlFor="inv-name" error={e.name}>
            <Input
              id="inv-name"
              name="name"
              autoComplete="name"
              spellCheck={false}
              required
              autoFocus
              defaultValue={state?.values?.name}
              aria-invalid={e.name ? true : undefined}
              aria-describedby={describedBy("inv-name", e.name)}
              className={authInput}
            />
          </AuthField>
          <AuthField
            label="Choose a password"
            htmlFor="inv-pw"
            error={e.password}
            hint="At least 8 characters. You’ll sign in with the email above."
          >
            <PasswordInput
              id="inv-pw"
              name="password"
              autoComplete="new-password"
              minLength={8}
              required
              aria-invalid={e.password ? true : undefined}
              aria-describedby={describedBy("inv-pw", e.password, true)}
            />
          </AuthField>
        </>
      ) : mode === "existing" ? (
        <AuthField label="Your AdLedger password" htmlFor="inv-pw" hint="You already have an account on this install. Confirm your password to join.">
          <PasswordInput id="inv-pw" name="password" autoComplete="current-password" required autoFocus aria-describedby="inv-pw-hint" />
        </AuthField>
      ) : (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You’re signed in as{" "}
          <span translate="no" className="font-medium break-all text-foreground">
            {email}
          </span>
          .
        </p>
      )}
      <FormError>{state?.error}</FormError>
      <Button type="submit" size="lg" disabled={pending} className={authButton}>
        {pending ? (
          <>
            <Loader2Icon aria-hidden className="animate-spin" /> {mode === "new" ? "Creating your account…" : "Joining…"}
          </>
        ) : mode === "new" ? (
          "Create account & join"
        ) : (
          "Join"
        )}
      </Button>
    </form>
  );
}
