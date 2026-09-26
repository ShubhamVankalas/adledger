"use client";

import { Loader2Icon } from "lucide-react";
import { useActionState } from "react";
import { loginAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <Card className="shadow-xl shadow-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">
          <h1>Welcome back</h1>
        </CardTitle>
        <CardDescription>Sign in to see which ads are making you money.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <input type="hidden" name="next" value={next} />
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" autoFocus={!state?.values?.email} defaultValue={state?.values?.email} key={state?.values?.email} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" autoFocus={!!state?.values?.email} />
          </div>
          {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <Loader2Icon className="animate-spin" /> : null} Sign in
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Forgot your password? Set <code className="rounded bg-muted px-1 py-0.5">RESET_PASSWORD=true</code> with <code className="rounded bg-muted px-1 py-0.5">ADMIN_EMAIL</code> and <code className="rounded bg-muted px-1 py-0.5">ADMIN_PASSWORD</code> on the server and restart.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
