"use client";

import { MailPlusIcon, ShieldCheckIcon, UserMinusIcon } from "lucide-react";
import { useState } from "react";
import { inviteMemberAction, removeMemberAction, revokeInvitationAction, updateMemberAction } from "@/app/actions/org";
import { ActionButton, useFormAction } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Role } from "@/lib/db/schema";
import { timeAgo } from "@/lib/format";

type RoleDef = { role: Role; label: string; description: string; assignable: boolean };
type Member = { id: string; userId: string; email: string; name: string | null; role: Role; workspaceIds: string[] | null; lastLoginAt: string | null; editable: boolean };

function WorkspacePicker({ workspaces, selected, name }: { workspaces: { id: string; name: string }[]; selected: string[]; name: string }) {
  return (
    <div className="grid gap-1.5 rounded-lg border bg-muted/30 p-3">
      <span className="text-xs font-medium">Workspaces this client can see</span>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {workspaces.map((w) => (
          <label key={w.id} className="flex min-h-8 items-center gap-2 text-sm max-md:min-h-10">
            <input type="checkbox" name={name} value={w.id} defaultChecked={selected.includes(w.id)} className="size-4 accent-[var(--primary)]" />
            {w.name}
          </label>
        ))}
      </div>
    </div>
  );
}

function MemberRow({ m, roles, workspaces, me }: { m: Member; roles: RoleDef[]; workspaces: { id: string; name: string }[]; me: string }) {
  const [role, setRole] = useState<Role>(m.role);
  const save = useFormAction((f) => updateMemberAction(m.id, f));
  const initials = (m.name || m.email).slice(0, 2).toUpperCase();
  return (
    <div className="grid gap-3 px-4 py-3 @3xl/settings:grid-cols-[minmax(0,1fr)_auto] @3xl/settings:items-center">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{initials}</span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className="min-w-0 break-all">{m.name || m.email}</span>
            {m.userId === me ? <Badge variant="secondary">You</Badge> : null}
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="break-all">{m.email}</span> <span className="whitespace-nowrap">· last active {timeAgo(m.lastLoginAt)}</span>
          </div>
        </div>
      </div>
      {m.editable ? (
        <form action={save.submit} className="grid gap-2">
          <div className="flex items-center gap-2 pl-12 @3xl/settings:pl-0">
            <NativeSelect name="role" value={role} onChange={(e) => setRole(e.target.value as Role)} className="min-w-0 flex-1 @3xl/settings:w-36 @3xl/settings:flex-none" aria-label="Role">
              {roles
                .filter((r) => r.assignable)
                .map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
            </NativeSelect>
            <Button type="submit" variant="outline" size="sm" disabled={save.pending}>
              Save
            </Button>
            <ActionButton action={() => removeMemberAction(m.id)} variant="ghost" size="icon-sm" aria-label={`Remove ${m.email}`} confirm={`Remove ${m.email} from the organization?`}>
              <UserMinusIcon />
            </ActionButton>
          </div>
          {role === "client" ? <WorkspacePicker workspaces={workspaces} selected={m.workspaceIds ?? []} name="workspaceIds" /> : null}
        </form>
      ) : (
        <Badge variant="outline" className="ml-12 justify-self-start @3xl/settings:ml-0 @3xl/settings:justify-self-end">
          {roles.find((r) => r.role === m.role)?.label}
        </Badge>
      )}
    </div>
  );
}

export function MembersPanel({
  me,
  roles,
  workspaces,
  members,
  invites,
}: {
  me: string;
  roles: RoleDef[];
  workspaces: { id: string; name: string }[];
  members: Member[];
  invites: { id: string; email: string; role: Role; expiresAt: string }[];
}) {
  const [inviteRole, setInviteRole] = useState<Role>("analyst");
  const [link, setLink] = useState<string | null>(null);
  const invite = useFormAction(inviteMemberAction, (r) => r.ok && setLink(String(r.data?.link ?? "")));
  const label = (r: Role) => roles.find((x) => x.role === r)?.label ?? r;

  return (
    <div className="grid grid-cols-1 items-start gap-5 md:gap-6 @6xl/settings:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5 md:space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailPlusIcon className="size-4 text-muted-foreground" /> Invite someone
            </CardTitle>
            <CardDescription>They get a link to create their account (or join with an existing one). Links expire after 7 days.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={invite.submit} className="grid gap-3">
              <div className="grid gap-3 @2xl/settings:grid-cols-[minmax(0,1fr)_11rem_auto] @2xl/settings:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor="inv-email">Email</Label>
                  <Input id="inv-email" name="email" type="email" placeholder="teammate@company.com" required />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="inv-role">Role</Label>
                  <NativeSelect id="inv-role" name="role" value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)}>
                    {roles
                      .filter((r) => r.assignable)
                      .map((r) => (
                        <option key={r.role} value={r.role}>
                          {r.label}
                        </option>
                      ))}
                  </NativeSelect>
                </div>
                <Button type="submit" disabled={invite.pending} className="md:h-9">
                  Send invite
                </Button>
              </div>
              {inviteRole === "client" ? <WorkspacePicker workspaces={workspaces} selected={[]} name="workspaceIds" /> : null}
            </form>
            {link ? (
              <div className="space-y-1.5 rounded-lg border border-primary/40 bg-primary/5 p-3">
                <div className="text-sm font-medium">Invitation link</div>
                <CopyField value={link} />
                <p className="text-xs text-muted-foreground">Connect an email channel in Notifications to have invites emailed automatically.</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Members <Badge variant="secondary">{members.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="-mb-(--card-spacing) px-0">
            <div className="divide-y border-t">
              {members.map((m) => (
                <MemberRow key={m.id} m={m} roles={roles} workspaces={workspaces} me={me} />
              ))}
            </div>
          </CardContent>
        </Card>

        {invites.length ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Pending invitations <Badge variant="secondary">{invites.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="-mb-(--card-spacing) divide-y border-t px-0">
              {invites.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3 py-2.5 pr-2 pl-4 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium break-all">{i.email}</div>
                    <div className="text-xs text-muted-foreground">
                      {label(i.role)} · expires {new Date(i.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <ActionButton action={() => revokeInvitationAction(i.id)} variant="ghost" size="sm">
                    Revoke
                  </ActionButton>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="self-start @6xl/settings:sticky @6xl/settings:top-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-success" /> What each role can do
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 @2xl/settings:grid-cols-2 @6xl/settings:grid-cols-1">
          {roles.map((r) => (
            <div key={r.role}>
              <div className="text-sm font-medium">{r.label}</div>
              <p className="text-xs text-muted-foreground">{r.description}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
