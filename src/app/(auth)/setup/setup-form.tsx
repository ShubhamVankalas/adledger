"use client";

import { CheckIcon, CompassIcon, Loader2Icon, RocketIcon } from "lucide-react";
import { useActionState, useRef, useState, useSyncExternalStore } from "react";
import { setupAction } from "@/app/actions/auth";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { AuthField as Field, FormError, PasswordInput, authButton, authInput, describedBy, useFocusFirstError } from "../fields";
import { authCard, authLead, authTitle } from "../styles";

// Native selects: 44px tall and 16px text on phones (smaller text makes iOS zoom in on focus).
const selectCls = "[&_select]:h-11 sm:[&_select]:h-10 lg:[&_select]:h-11 [&_select]:text-base sm:[&_select]:text-sm";

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
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstError(form, state);
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
    <Card data-wide className={authCard}>
      <CardHeader>
        <CardTitle className={authTitle}>
          <h1>Welcome to AdLedger</h1>
        </CardTitle>
        <CardDescription className={authLead}>Create your account. It takes 30 seconds, and nothing leaves your server.</CardDescription>
      </CardHeader>
      <CardContent>
        <form ref={form} action={action} className="grid gap-4">
          <Field label="Business or agency name" error={e.organizationName} htmlFor="organizationName" hint="Agencies can add a workspace for each client later.">
            <Input
              id="organizationName"
              name="organizationName"
              placeholder="Acme Inc…"
              required
              autoFocus
              autoComplete="organization"
              defaultValue={v.organizationName}
              aria-invalid={e.organizationName ? true : undefined}
              aria-describedby={describedBy("organizationName", e.organizationName, true)}
              className={authInput}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name" error={e.name} htmlFor="name">
              <Input
                id="name"
                name="name"
                placeholder="Alex…"
                autoComplete="name"
                spellCheck={false}
                defaultValue={v.name}
                aria-invalid={e.name ? true : undefined}
                aria-describedby={describedBy("name", e.name)}
                className={authInput}
              />
            </Field>
            <Field label="Email" error={e.email} htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="you@company.com…"
                required
                autoComplete="email"
                defaultValue={v.email}
                aria-invalid={e.email ? true : undefined}
                aria-describedby={describedBy("email", e.email)}
                className={authInput}
              />
            </Field>
          </div>
          <Field label="Password" error={e.password} hint="At least 15 characters. A few unrelated words work well; no symbols needed." htmlFor="password">
            <PasswordInput
              id="password"
              name="password"
              required
              minLength={15}
              autoComplete="new-password"
              aria-invalid={e.password ? true : undefined}
              aria-describedby={describedBy("password", e.password, true)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Reporting currency" error={e.currency} htmlFor="currency">
              <NativeSelect id="currency" name="currency" autoComplete="off" defaultValue={v.currency || "USD"} key={v.currency} className={selectCls}>
                {CURRENCIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {code} — {name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Timezone" error={e.timezone} htmlFor="timezone">
              <NativeSelect id="timezone" name="timezone" autoComplete="off" value={tz} onChange={(ev) => setTz(ev.target.value)} className={selectCls}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replaceAll("_", " ")}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">How do you want to start?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {STARTS.map((s) => {
                const on = start === s.value;
                return (
                  <label
                    key={s.value}
                    className={cn(
                      "relative flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors hover:border-brand/40 has-focus-visible:ring-2 has-focus-visible:ring-ring sm:flex-col sm:gap-1.5",
                      on && "border-brand bg-brand/5 ring-1 ring-brand/30",
                    )}
                  >
                    <input type="radio" name="start" value={s.value} checked={on} onChange={() => setStart(s.value)} className="sr-only" />
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md sm:hidden", on ? "bg-brand/15 text-brand-fg" : "bg-muted text-muted-foreground")}>
                      <s.icon aria-hidden className="size-4" />
                    </span>
                    <span className="grid min-w-0 gap-1">
                      <span className="flex items-center gap-2 pr-6 text-sm font-medium">
                        <s.icon aria-hidden className="hidden size-4 text-brand-fg sm:block" /> {s.title}
                      </span>
                      <span className="text-xs leading-relaxed text-muted-foreground">{s.body}</span>
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-3 right-3 flex size-4 items-center justify-center rounded-full border",
                        on ? "border-brand bg-brand text-white" : "border-muted-foreground/40",
                      )}
                    >
                      {on ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <FormError>{state?.error}</FormError>
          <Button type="submit" size="lg" disabled={pending} className={cn(authButton, "mt-1")}>
            {pending ? (
              <>
                <Loader2Icon aria-hidden className="animate-spin" /> {start === "demo" ? "Building your demo workspace…" : "Creating your account…"}
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
