"use client";

import { ChevronRightIcon, LaptopIcon, Loader2Icon, MoonIcon, ShieldCheckIcon, ShieldIcon, SunIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { updateProfileAction } from "@/app/actions/account";
import { removeAvatarAction, setAvatarAction } from "@/app/actions/media";
import { useFormAction } from "@/components/action-button";
import { OrgLogo, UserAvatar } from "@/components/avatars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ImageUpload } from "./image-upload";

export function AccountForms({
  id,
  name,
  email,
  avatarUrl,
  memberships,
  has2fa,
  otherSessions,
}: {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  memberships: { id: string; org: string; logoUrl: string | null; role: string }[];
  has2fa: boolean;
  otherSessions: number;
}) {
  const profile = useFormAction(updateProfileAction);
  const { theme: activeTheme, setTheme } = useTheme();
  // The theme, locale and timezone are only known in the browser: render a neutral version on the
  // server (no theme selected, UTC dates) to avoid a hydration mismatch.
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  const theme = mounted ? activeTheme : undefined;

  return (
    <div className="grid grid-cols-1 gap-5 md:gap-6 @4xl/settings:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How teammates see you in AdLedger.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <ImageUpload
            src={avatarUrl}
            preview={(src) => <UserAvatar id={id} name={name} email={email} src={src} size="xl" />}
            upload={setAvatarAction}
            remove={removeAvatarAction}
            fit="cover"
            label="Profile picture"
            help="PNG, JPG or WebP, up to 2 MB. Cropped to a square."
          />
          <form action={profile.submit} className="grid gap-4 border-t pt-5">
            <div className="grid gap-1.5">
              <Label htmlFor="profile-name">Name</Label>
              <Input id="profile-name" name="name" autoComplete="name" defaultValue={name} placeholder="Your name…" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="profile-email">Email</Label>
              <Input id="profile-email" type="email" autoComplete="email" spellCheck={false} value={email} readOnly disabled />
              <p className="text-xs text-muted-foreground">Your email is your login. To use a different one, ask an admin to invite that address.</p>
            </div>
            <div>
              <Button type="submit" disabled={profile.pending}>
                {profile.pending ? <Loader2Icon className="animate-spin" /> : null}
                {profile.pending ? "Saving…" : "Save profile"}
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
              aria-pressed={theme === t.v}
              onClick={() => setTheme(t.v)}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-sm transition-[color,background-color,border-color,box-shadow] outline-none hover:border-primary/40 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50",
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
            <div key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
              <span className="flex min-w-0 items-center gap-3">
                <OrgLogo id={m.id} name={m.org} src={m.logoUrl} size="md" />
                <span className="min-w-0 truncate font-medium">{m.org}</span>
              </span>
              <Badge variant="secondary">{m.role}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Link
        href="/settings/account/security"
        className="group flex items-center gap-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-[box-shadow,background-color] outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {has2fa ? <ShieldCheckIcon className="size-4" /> : <ShieldIcon className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Password, two-factor sign-in and devices</span>
          <span className="block text-sm text-pretty text-muted-foreground">
            Two-factor sign-in is {has2fa ? "on" : "off"}.{" "}
            {otherSessions ? `Signed in on ${otherSessions} other device${otherSessions === 1 ? "" : "s"}.` : "Signed in on this device only."}
          </span>
        </span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
