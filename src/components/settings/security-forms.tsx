"use client";

import { Loader2Icon, MonitorIcon, ShieldCheckIcon, ShieldIcon, SmartphoneIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { changePasswordAction } from "@/app/actions/account";
import { disableTwoFactorAction, regenerateRecoveryCodesAction, revokeOtherSessionsAction, revokeSessionAction } from "@/app/actions/security";
import { ActionButton, useFormAction } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions";
import { cn } from "@/lib/utils";
import { PasswordField } from "./password-field";
import { CodeInput, RecoveryCodes, TwoFactorEnroll } from "./two-factor-enroll";

// Settings → Account → Security: two-factor sign-in, password and signed-in devices.

/** Dates render in the viewer's timezone after hydration; the server renders them in UTC. */
function useMounted() {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

function formatWhen(iso: string, mounted: boolean) {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: mounted ? undefined : "UTC" }).format(d);
}

function relative(iso: string, mounted: boolean) {
  if (!mounted) return formatWhen(iso, false);
  const diff = Date.now() - new Date(iso).getTime();
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (diff < 5 * 60_000) return "Active now";
  if (diff < 3_600_000) return `Active ${rtf.format(-Math.round(diff / 60_000), "minute")}`;
  if (diff < 86_400_000) return `Active ${rtf.format(-Math.round(diff / 3_600_000), "hour")}`;
  return `Active ${rtf.format(-Math.round(diff / 86_400_000), "day")}`;
}

// ---------------------------------------------------------------- two-factor

/** A dialog that asks for a current code before a sensitive 2FA change. */
function CodeDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  destructive,
  action,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  destructive?: boolean;
  action: (f: FormData) => Promise<ActionResult>;
  onSuccess: (r: ActionResult) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const submit = (form: FormData) =>
    start(async () => {
      const r = await action(form);
      if (!r.ok) {
        setError(r.message ?? "That code didn't match.");
        return;
      }
      setError(null);
      onSuccess(r);
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (pending) return;
        setError(null);
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form action={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="text-pretty">{description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>Code from your authenticator app</Label>
            <CodeInput id={id} allowRecovery autoFocus aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : `${id}-hint`} />
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : (
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                A recovery code works too.
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Checking…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TwoFactorSection({ enabled, enabledAt, recoveryLeft, required }: { enabled: boolean; enabledAt: string | null; recoveryLeft: number; required: boolean }) {
  const router = useRouter();
  const mounted = useMounted();
  const [enrolling, setEnrolling] = useState(false);
  const [dialog, setDialog] = useState<"disable" | "codes" | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Two-factor sign-in</CardTitle>
          {enabled ? (
            <Badge variant="outline" className="gap-1">
              <ShieldCheckIcon aria-hidden /> On
            </Badge>
          ) : (
            <Badge variant="secondary">Off</Badge>
          )}
          {required ? <Badge variant="secondary">Required by your organization</Badge> : null}
        </div>
        <CardDescription className="text-pretty">
          {enabled
            ? "Signing in asks for a code from your authenticator app after your password."
            : "Add a code from an authenticator app to every sign-in, so a leaked password alone can’t open your account."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {newCodes ? (
          <RecoveryCodes
            codes={newCodes}
            onDone={() => {
              setNewCodes(null);
              router.refresh();
            }}
          />
        ) : enabled ? (
          <div className="flex flex-col gap-4 @xl/settings:flex-row @xl/settings:items-center @xl/settings:justify-between">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Turned on</dt>
              <dd className="tabular-nums">{enabledAt ? formatWhen(enabledAt, mounted) : "—"}</dd>
              <dt className="text-muted-foreground">Recovery codes</dt>
              <dd className={cn("tabular-nums", recoveryLeft <= 2 && "font-medium")}>
                {recoveryLeft} of 10 left{recoveryLeft <= 2 ? ". Create new ones soon." : ""}
              </dd>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setDialog("codes")}>
                New recovery codes
              </Button>
              {!required ? (
                <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDialog("disable")}>
                  Turn off
                </Button>
              ) : null}
            </div>
          </div>
        ) : enrolling ? (
          <TwoFactorEnroll
            onCancel={() => setEnrolling(false)}
            onFinished={() => {
              setEnrolling(false);
              toast.success("Two-factor sign-in is on.");
              router.refresh();
            }}
          />
        ) : (
          <Button onClick={() => setEnrolling(true)}>
            <ShieldIcon /> Set up two-factor sign-in
          </Button>
        )}
      </CardContent>
      <CodeDialog
        open={dialog === "disable"}
        onOpenChange={(o) => setDialog(o ? "disable" : null)}
        title="Turn off two-factor sign-in?"
        description="Your password alone will be enough to sign in. Your recovery codes stop working."
        submitLabel="Turn off"
        destructive
        action={disableTwoFactorAction}
        onSuccess={(r) => {
          setDialog(null);
          toast.success(r.message ?? "Two-factor sign-in is off.");
          router.refresh();
        }}
      />
      <CodeDialog
        open={dialog === "codes"}
        onOpenChange={(o) => setDialog(o ? "codes" : null)}
        title="Create new recovery codes?"
        description="You’ll get ten new codes. The ones you have now stop working."
        submitLabel="Create codes"
        action={regenerateRecoveryCodesAction}
        onSuccess={(r) => {
          setDialog(null);
          setNewCodes((r.data?.codes as string[]) ?? []);
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------- password

export function PasswordSection({ minLength, has2fa, email, name }: { minLength: number; has2fa: boolean; email: string; name: string }) {
  // A new key clears the fields after a successful change.
  const [formKey, setFormKey] = useState(0);
  const pw = useFormAction(changePasswordAction, (r) => r.ok && setFormKey((k) => k + 1));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>Changing it signs you out of every other device.</CardDescription>
      </CardHeader>
      <CardContent>
        <form key={formKey} action={pw.submit} className="grid max-w-md gap-4">
          {/* Lets password managers attach the new password to the right account. */}
          <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
          <PasswordField id="pw-current" name="current" label="Current password" autoComplete="current-password" />
          <PasswordField
            id="pw-next"
            name="next"
            label="New password"
            autoComplete="new-password"
            minLength={minLength}
            strength={{ minLength, email, name }}
            hint={has2fa ? `At least ${minLength} characters.` : `At least ${minLength} characters, or 8 with two-factor sign-in on. A few unrelated words work well; no symbols needed.`}
          />
          <div>
            <Button type="submit" variant="outline" disabled={pw.pending}>
              {pw.pending ? <Loader2Icon className="animate-spin" /> : null}
              {pw.pending ? "Changing password…" : "Change password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- sessions

export type SessionRow = { id: string; device: string; mobile: boolean; ip: string | null; createdAt: string; lastSeenAt: string; method: string | null; workspace: string; current: boolean };

export function SessionsSection({ sessions, idle, maxDays }: { sessions: SessionRow[]; idle: string; maxDays: number }) {
  const mounted = useMounted();
  const others = sessions.filter((s) => !s.current).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signed-in devices</CardTitle>
        <CardDescription className="text-pretty">
          Sessions end after {idle} without activity, and after {maxDays} days at most. Sign out any you don&rsquo;t recognise.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-lg border">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-3">
              <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                {s.mobile ? <SmartphoneIcon className="size-4" /> : <MonitorIcon className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  <span className="truncate">{s.device}</span>
                  {s.current ? <Badge>This device</Badge> : null}
                  {s.method?.includes("+") ? (
                    <Badge variant="outline" title="Signed in with two-factor">
                      2FA
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span suppressHydrationWarning>{s.current ? "Active now" : relative(s.lastSeenAt, mounted)}</span>
                  {s.ip ? (
                    <span className="font-mono tabular-nums" title="IP address, last part hidden" translate="no">
                      {s.ip}
                    </span>
                  ) : null}
                  <span className="hidden truncate @md/settings:inline" suppressHydrationWarning>
                    Signed in {formatWhen(s.createdAt, mounted)}
                  </span>
                </div>
              </div>
              {!s.current ? (
                <ActionButton action={() => revokeSessionAction(s.id)} variant="ghost" size="sm">
                  Sign out
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
        {others > 0 ? (
          <ActionButton
            action={revokeOtherSessionsAction}
            variant="outline"
            confirm={`Sign out everywhere else? ${others} other device${others === 1 ? "" : "s"} will need to sign in again.`}
            confirmLabel="Sign out everywhere else"
          >
            Sign out everywhere else
          </ActionButton>
        ) : (
          <p className="text-xs text-muted-foreground">You&rsquo;re only signed in here.</p>
        )}
      </CardContent>
    </Card>
  );
}
