"use client";

import { CircleAlertIcon, CircleCheckIcon, InfoIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { resetMemberTwoFactorAction, saveSecurityPolicyAction } from "@/app/actions/security";
import { ActionButton, useFormAction } from "@/components/action-button";
import { UserAvatar } from "@/components/avatars";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { PostureItem } from "@/lib/security/posture";
import { cn } from "@/lib/utils";

// Settings → Organization → Security policy.

const STATUS = {
  ok: { icon: CircleCheckIcon, label: "Done", className: "text-foreground" },
  warn: { icon: CircleAlertIcon, label: "Needs attention", className: "text-[oklch(0.55_0.13_65)] dark:text-warning" },
  info: { icon: InfoIcon, label: "Worth a look", className: "text-muted-foreground" },
} as const;

export function PostureChecklist({ items }: { items: PostureItem[] }) {
  const open = items.filter((i) => i.status === "warn").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist</CardTitle>
        <CardDescription>{open ? `${open} item${open === 1 ? " needs" : "s need"} attention.` : "Nothing needs attention right now."}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((item) => {
            const s = STATUS[item.status];
            const external = item.action?.href.startsWith("http");
            return (
              <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <s.icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", s.className)} strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <span className="sr-only">{s.label}: </span>
                    {item.label}
                  </p>
                  <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{item.detail}</p>
                </div>
                {item.action ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 self-center"
                    render={external ? <a href={item.action.href} target="_blank" rel="noreferrer" /> : <Link href={item.action.href} />}
                  >
                    {item.action.label}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

type Policy = { require2fa: boolean; sessionIdleMinutes: number; sessionMaxDays: number; clientsCanDownloadPdf: boolean };

function Row({ title, description, htmlFor, children }: { title: string; description: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 @xl/settings:flex-row @xl/settings:items-center @xl/settings:justify-between @xl/settings:gap-8">
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {title}
        </label>
        <p id={`${htmlFor}-desc`} className="mt-0.5 text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function PolicyForm({
  policy,
  editable,
  has2fa,
  idleChoices,
  maxDaysChoices,
}: {
  policy: Policy;
  editable: boolean;
  has2fa: boolean;
  idleChoices: { minutes: number; label: string }[];
  maxDaysChoices: { days: number; label: string }[];
}) {
  const save = useFormAction(saveSecurityPolicyAction);
  const [require2fa, setRequire2fa] = useState(policy.require2fa);
  const [pdf, setPdf] = useState(policy.clientsCanDownloadPdf);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in rules</CardTitle>
        <CardDescription>Apply to every member of the organization, in every workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={save.submit}>
          <fieldset disabled={!editable || save.pending} className="divide-y">
            <Row
              title="Require two-factor sign-in"
              htmlFor="require2fa"
              description={
                has2fa || !editable
                  ? "Members without it are asked to set it up the next time they open AdLedger, before they can see anything else."
                  : "Turn it on for your own account first (Account → Security), so you can’t lock yourself out."
              }
            >
              <Switch id="require2fa" name="require2fa" checked={require2fa} onCheckedChange={setRequire2fa} disabled={!editable || (!has2fa && !require2fa)} aria-describedby="require2fa-desc" />
            </Row>
            <Row title="Sign out after inactivity" htmlFor="sessionIdleMinutes" description="A session that hasn’t been used for this long ends. The next visit asks for a sign-in.">
              <NativeSelect id="sessionIdleMinutes" name="sessionIdleMinutes" defaultValue={String(policy.sessionIdleMinutes)} className="w-40" aria-describedby="sessionIdleMinutes-desc">
                {idleChoices.map((c) => (
                  <option key={c.minutes} value={c.minutes}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Row>
            <Row title="Longest a session can last" htmlFor="sessionMaxDays" description="Even an active session ends after this, and the member signs in again.">
              <NativeSelect id="sessionMaxDays" name="sessionMaxDays" defaultValue={String(policy.sessionMaxDays)} className="w-40" aria-describedby="sessionMaxDays-desc">
                {maxDaysChoices.map((c) => (
                  <option key={c.days} value={c.days}>
                    {c.label}
                  </option>
                ))}
              </NativeSelect>
            </Row>
            <Row title="Clients can download PDF reports" htmlFor="clientsCanDownloadPdf" description="Aggregate reports only. Contact details in a PDF are always masked.">
              <Switch id="clientsCanDownloadPdf" name="clientsCanDownloadPdf" checked={pdf} onCheckedChange={setPdf} aria-describedby="clientsCanDownloadPdf-desc" />
            </Row>
          </fieldset>
          {editable ? (
            <div className="mt-5 border-t pt-4">
              <Button type="submit" disabled={save.pending}>
                {save.pending ? <Loader2Icon className="animate-spin" /> : null}
                {save.pending ? "Saving…" : "Save rules"}
              </Button>
            </div>
          ) : (
            <p className="mt-5 border-t pt-4 text-sm text-muted-foreground">Only owners can change these rules.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

export type MemberRow = { userId: string; name: string | null; email: string; avatarUrl: string | null; role: string; has2fa: boolean; lastLoginAt: string | null; me: boolean };

export function MembersTwoFactor({ members, canReset, required }: { members: MemberRow[]; canReset: boolean; required: boolean }) {
  const on = members.filter((m) => m.has2fa).length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-factor sign-in by member</CardTitle>
        <CardDescription>
          {on} of {members.length} {members.length === 1 ? "member has" : "members have"} it on.
          {required && on < members.length ? " The others are asked to set it up when they next open AdLedger." : ""}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <UserAvatar id={m.userId} name={m.name} email={m.email} src={m.avatarUrl} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {m.name || m.email}
                  {m.me ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.role}</p>
              </div>
              {m.has2fa ? <Badge variant="outline">On</Badge> : <Badge variant="secondary">Off</Badge>}
              {canReset && m.has2fa && !m.me ? (
                <ActionButton
                  action={() => resetMemberTwoFactorAction(m.userId)}
                  variant="ghost"
                  size="sm"
                  confirm={`Reset two-factor sign-in for ${m.name || "this member"}? Use this when they’ve lost their phone and recovery codes. They’re signed out everywhere.`}
                  confirmLabel="Reset"
                >
                  Reset
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
