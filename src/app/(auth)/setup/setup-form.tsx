"use client";

import { CompassIcon, Loader2Icon, RocketIcon } from "lucide-react";
import { useActionState, useState, useSyncExternalStore } from "react";
import { setupAction } from "@/app/actions/auth";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";
import { cn } from "@/lib/utils";

function Field({ label, error, children, hint, htmlFor }: { label: string; error?: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const STARTS = [
  {
    value: "demo",
    icon: CompassIcon,
    title: "Explore with demo data",
    body: "90 days of realistic ads, leads and Stripe revenue across 5 ad platforms. Clear it anytime.",
  },
  {
    value: "setup",
    icon: RocketIcon,
    title: "Set up my business",
    body: "Start empty and follow a guided checklist to connect your site, payments and ad accounts.",
  },
] as const;

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
  const e = state?.fieldErrors ?? {};
  const v = state?.values ?? {};
  const [start, setStart] = useState<string>(v.start || "demo");
  const zones = TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES];

  return (
    <Card className="shadow-xl shadow-primary/5">
      <CardHeader>
        <CardTitle className="text-xl">Welcome to AdLedger</CardTitle>
        <CardDescription>Create your account. It takes 30 seconds, and nothing leaves your server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <Field label="Business or agency name" error={e.organizationName} htmlFor="organizationName" hint="Agencies can add a workspace for each client later.">
            <Input id="organizationName" name="organizationName" placeholder="Acme Inc." required autoFocus defaultValue={v.organizationName} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" error={e.name} htmlFor="name">
              <Input id="name" name="name" placeholder="Alex" autoComplete="name" defaultValue={v.name} />
            </Field>
            <Field label="Email" error={e.email} htmlFor="email">
              <Input id="email" name="email" type="email" placeholder="you@company.com" required autoComplete="email" defaultValue={v.email} />
            </Field>
          </div>
          <Field label="Password" error={e.password} hint="At least 8 characters." htmlFor="password">
            <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reporting currency" error={e.currency} htmlFor="currency">
              <NativeSelect id="currency" name="currency" defaultValue={v.currency || "USD"} key={v.currency}>
                {CURRENCIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Timezone" error={e.timezone} htmlFor="timezone">
              <NativeSelect id="timezone" name="timezone" value={tz} onChange={(ev) => setTz(ev.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">How do you want to start?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {STARTS.map((s) => (
                <label
                  key={s.value}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-3 transition-colors hover:border-primary/40 has-focus-visible:ring-2 has-focus-visible:ring-ring",
                    start === s.value && "border-primary bg-primary/5 ring-1 ring-primary/30",
                  )}
                >
                  <input type="radio" name="start" value={s.value} checked={start === s.value} onChange={() => setStart(s.value)} className="sr-only" />
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <s.icon className="size-4 text-primary" /> {s.title}
                  </span>
                  <span className="text-xs text-muted-foreground">{s.body}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {state?.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
          <Button type="submit" size="lg" disabled={pending} className="mt-1">
            {pending ? (
              <>
                <Loader2Icon className="animate-spin" /> {start === "demo" ? "Building your demo workspace…" : "Creating your account…"}
              </>
            ) : start === "demo" ? (
              "Create account & explore"
            ) : (
              "Create account & start setup"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
