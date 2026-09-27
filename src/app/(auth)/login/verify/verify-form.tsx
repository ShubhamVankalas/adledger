"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { cancelLoginAction, verifyLoginAction } from "@/app/actions/auth";
import { CodeInput } from "@/components/settings/two-factor-enroll";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthField, FormError, authButton, useFocusFirstError } from "../../fields";
import { authCard, authTitle } from "../../styles";

export function VerifyForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(verifyLoginAction, undefined);
  const [recovery, setRecovery] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstError(form, state);
  return (
    <Card className={authCard}>
      <CardHeader>
        <CardTitle className={authTitle}>
          <h1>Enter your code</h1>
        </CardTitle>
        <CardDescription>
          {recovery ? "Type one of the recovery codes you saved. Each one works once." : "Open your authenticator app and enter the 6-digit code for AdLedger."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} action={action} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          <AuthField label={recovery ? "Recovery code" : "Authentication code"} htmlFor="code">
            <CodeInput
              key={recovery ? "recovery" : "totp"}
              id="code"
              allowRecovery={recovery}
              placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
              autoFocus
              aria-invalid={state?.error ? true : undefined}
            />
          </AuthField>
          <FormError>{state?.error}</FormError>
          <Button type="submit" size="lg" disabled={pending} className={authButton}>
            {pending ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" /> Checking…
              </>
            ) : (
              "Continue"
            )}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              onClick={() => setRecovery((r) => !r)}
              className="min-h-10 rounded-md px-1 font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {recovery ? "Use your authenticator app" : "Use a recovery code"}
            </button>
            <button
              type="submit"
              formAction={cancelLoginAction}
              formNoValidate
              className="min-h-10 rounded-md px-1 text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Back to sign in
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
