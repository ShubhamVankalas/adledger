"use client";

import { LaptopIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { changePasswordAction, revokeOtherSessionsAction, revokeSessionAction, updateProfileAction } from "@/app/actions/account";
import { ActionButton, useFormAction } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function AccountForms({
  name,
  email,
  memberships,
  sessions,
}: {
  name: string;
  email: string;
  memberships: { org: string; role: string }[];
  sessions: { id: string; createdAt: string; workspace: string; current: boolean }[];
}) {
  const profile = useFormAction(updateProfileAction);
  const pw = useFormAction(changePasswordAction);
  const { theme, setTheme } = useTheme();
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How teammates see you in AdLedger.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={profile.submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" name="name" defaultValue={name} placeholder="Your name" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" value={email} disabled />
              <p className="text-[11px] text-muted-foreground">Your email is your login. To use a different one, ask an admin to invite that address.</p>
            </div>
            <div>
              <Button type="submit" disabled={profile.pending}>
                Save profile
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing it signs you out everywhere else.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={pw.submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pw-next">New password</Label>
              <Input id="pw-next" name="next" type="password" autoComplete="new-password" minLength={8} required />
            </div>
            <div>
              <Button type="submit" variant="outline" disabled={pw.pending}>
                Change password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose a theme for this browser.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-2">
          {[
            { v: "light", label: "Light", icon: SunIcon },
            { v: "dark", label: "Dark", icon: MoonIcon },
            { v: "system", label: "System", icon: LaptopIcon },
          ].map((t) => (
            <button
              key={t.v}
              type="button"
              onClick={() => setTheme(t.v)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:border-primary/40",
                theme === t.v && "border-primary bg-primary/5 ring-1 ring-primary/30",
              )}
            >
              <t.icon className="size-5" />
              {t.label}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>Where you have access, and your role in each.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {memberships.map((m) => (
            <div key={m.org} className="flex items-center justify-between py-2 text-sm">
              <span className="font-medium">{m.org}</span>
              <Badge variant="secondary">{m.role}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>Signed-in devices</CardTitle>
          <CardDescription>Sessions last 30 days. Sign out any you don&apos;t recognise.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="divide-y rounded-lg border">
            {sessions.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <MonitorIcon className="size-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">
                      Signed in {fmt.format(new Date(s.createdAt))} {s.current ? <Badge className="ml-1">This device</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">Last workspace: {s.workspace}</div>
                  </div>
                </div>
                {!s.current ? (
                  <ActionButton action={() => revokeSessionAction(s.id)} variant="ghost" size="sm">
                    Sign out
                  </ActionButton>
                ) : null}
              </div>
            ))}
          </div>
          {sessions.length > 1 ? (
            <ActionButton action={revokeOtherSessionsAction} variant="outline" size="sm" confirm="Sign out of every other device?">
              Sign out of all other devices
            </ActionButton>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
