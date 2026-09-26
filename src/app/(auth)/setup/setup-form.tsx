"use client";

import { Loader2Icon, SparklesIcon } from "lucide-react";
import { useActionState, useState, useSyncExternalStore } from "react";
import { setupAction } from "@/app/actions/auth";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";

function Field({ label, error, children, hint }: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, undefined);
  // Default to the browser's timezone (server render uses UTC).
  const browserTz = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    () => "UTC",
  );
  const [picked, setTz] = useState<string | null>(null);
  const tz = picked ?? browserTz;
  const [demo, setDemo] = useState(true);
  const e = state?.fieldErrors ?? {};

  const zones = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];

  return (
    <Card className="shadow-xl shadow-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">Set up AdLedger</CardTitle>
        <CardDescription>Create your admin account. Takes 30 seconds, and nothing leaves your server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <Field label="Business / workspace name" error={e.workspaceName}>
            <Input name="workspaceName" placeholder="Acme Inc." required autoFocus />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" error={e.name}>
              <Input name="name" placeholder="Alex" autoComplete="name" />
            </Field>
            <Field label="Email" error={e.email}>
              <Input name="email" type="email" placeholder="you@company.com" required autoComplete="email" />
            </Field>
          </div>
          <Field label="Password" error={e.password} hint="At least 8 characters.">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reporting currency" error={e.currency}>
              <NativeSelect name="currency" defaultValue="USD">
                {CURRENCIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Timezone" error={e.timezone}>
              <NativeSelect name="timezone" value={tz} onChange={(ev) => setTz(ev.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-accent/40 p-3">
            <Switch checked={demo} onCheckedChange={setDemo} className="mt-0.5" />
            <input type="hidden" name="demo" value={demo ? "on" : "off"} />
            <span className="grid gap-0.5">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <SparklesIcon className="size-3.5 text-primary" /> Start with demo data
              </span>
              <span className="text-xs text-muted-foreground">
                90 days of realistic Meta, Google Ads and Stripe data so you can explore right away. Clear it anytime in Settings.
              </span>
            </span>
          </label>
          {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" size="lg" disabled={pending} className="mt-1">
            {pending ? (
              <>
                <Loader2Icon className="animate-spin" /> {demo ? "Building your demo workspace…" : "Creating your workspace…"}
              </>
            ) : (
              "Create workspace"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
