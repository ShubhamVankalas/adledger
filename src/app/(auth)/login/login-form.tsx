"use client";

import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AuthField, FormError, PasswordInput, authButton, authInput } from "../fields";
import { authCard, authTitle } from "../styles";

const code = "rounded bg-muted px-1 py-0.5 font-mono text-[0.7rem] break-all";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <Card className={authCard}>
      <CardHeader>
        <CardTitle className={authTitle}>
          <h1>Welcome back</h1>
        </CardTitle>
        <CardDescription>Sign in to see which ads are making you money.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          <AuthField label="Email" htmlFor="email">
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoComplete="email"
              autoFocus={!state?.values?.email}
              defaultValue={state?.values?.email}
              key={state?.values?.email}
              className={authInput}
            />
          </AuthField>
          <AuthField label="Password" htmlFor="password">
            <PasswordInput id="password" name="password" required autoComplete="current-password" autoFocus={!!state?.values?.email} aria-invalid={state?.error ? true : undefined} />
          </AuthField>
          <FormError>{state?.error}</FormError>
          <Button type="submit" size="lg" disabled={pending} className={authButton}>
            {pending ? <Loader2Icon className="animate-spin" /> : null} Sign in
          </Button>
          <details className="group rounded-lg text-xs text-muted-foreground">
            <summary className="mx-auto flex min-h-10 w-fit cursor-pointer list-none items-center gap-1 rounded-md px-2 font-medium hover:text-foreground [&::-webkit-details-marker]:hidden">
              Forgot your password?
              <ChevronRightIcon className="size-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <p className="mt-1 rounded-lg border bg-muted/40 p-3 leading-relaxed">
              Ask the server admin to set <code className={code}>RESET_PASSWORD=true</code> with <code className={code}>ADMIN_EMAIL</code> and <code className={code}>ADMIN_PASSWORD</code> on the server, then restart AdLedger.
            </p>
          </details>
        </form>
      </CardContent>
    </Card>
  );
}
