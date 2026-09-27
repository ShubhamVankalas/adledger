"use client";

import { CopyIcon, Loader2Icon, LockKeyholeIcon, PencilIcon, PlusIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createRoleAction, deleteRoleAction, duplicateRoleAction, updateRoleAction } from "@/app/actions/roles";
import { ActionButton } from "@/components/action-button";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PAGES, PERMISSION_GROUPS, type Permission } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export type RoleRow = {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
  builtin: boolean;
  workspaceScoped: boolean;
  members: number;
  /** The viewer may edit/delete it (never Owner, never a role above their own access). */
  editable: boolean;
  /** The viewer may move members into it. */
  assignable: boolean;
};

/** "Basic read-only": every page and its numbers, nothing else. */
const BASIC: Permission[] = [...PAGES.map((p) => p.permission), "reports.view", "dashboard.edit"];

const TOTAL = PERMISSION_GROUPS.reduce((n, g) => n + g.items.length, 0);

export function RolesPanel({ roles, mine, myRole }: { roles: RoleRow[]; mine: Permission[]; myRole: string }) {
  const [editing, setEditing] = useState<RoleRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              Roles <Badge variant="secondary" className="tabular-nums">{roles.length}</Badge>
            </CardTitle>
            <CardDescription>Built-in roles can be edited or deleted too. Owner always has full access.</CardDescription>
          </div>
          <Button onClick={() => setEditing("new")} className="max-sm:w-full">
            <PlusIcon /> New role
          </Button>
        </CardHeader>
        <CardContent className="-mb-(--card-spacing) px-0">
          <ul className="divide-y border-t">
            {roles.map((r) => {
              const hidden = r.key === "owner" ? [] : PAGES.filter((p) => !r.permissions.includes(p.permission)).map((p) => p.label);
              return (
                <li key={r.key} className="grid gap-3 px-4 py-3.5 @3xl/settings:grid-cols-[minmax(0,1fr)_auto] @3xl/settings:items-center">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium break-words">{r.name}</span>
                      {r.key === myRole ? <Badge variant="secondary">Your role</Badge> : null}
                      <Badge variant="outline">{r.builtin ? "Built-in" : "Custom"}</Badge>
                      {r.workspaceScoped ? <Badge variant="outline">Selected workspaces</Badge> : null}
                    </div>
                    {r.description ? <p className="text-xs text-pretty text-muted-foreground">{r.description}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      <span className="tabular-nums">
                        {r.members} {r.members === 1 ? "member" : "members"}
                      </span>
                      {" · "}
                      {r.key === "owner" ? (
                        "every permission, always"
                      ) : (
                        <span className="tabular-nums">
                          {r.permissions.length} of {TOTAL} permissions
                        </span>
                      )}
                      {hidden.length ? <> · can&rsquo;t open {hidden.length === PAGES.length ? "any dashboard page" : hidden.join(", ")}</> : null}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {r.key === "owner" ? (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <ShieldCheckIcon className="size-4 text-success" aria-hidden /> Fixed
                      </span>
                    ) : r.editable ? (
                      <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                        <PencilIcon /> Edit
                      </Button>
                    ) : (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground" title="This role has permissions your own role doesn't have.">
                        <LockKeyholeIcon className="size-3.5" aria-hidden /> Above your access
                      </span>
                    )}
                    {r.key !== "owner" ? (
                      <ActionButton action={() => duplicateRoleAction(r.key)} variant="ghost" size="icon-sm" aria-label={`Duplicate ${r.name}`} title="Duplicate">
                        <CopyIcon />
                      </ActionButton>
                    ) : null}
                    {r.editable && r.key !== myRole ? (
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => setDeleting(r)}>
                        <Trash2Icon />
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {editing ? <RoleEditor key={editing === "new" ? "new" : editing.key} role={editing === "new" ? null : editing} roles={roles} mine={mine} onClose={() => setEditing(null)} /> : null}
      {deleting ? <DeleteRole key={deleting.key} role={deleting} roles={roles} onClose={() => setDeleting(null)} /> : null}
    </>
  );
}

function RoleEditor({ role, roles, mine, onClose }: { role: RoleRow | null; roles: RoleRow[]; mine: Permission[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Set<Permission>>(() => new Set(role?.permissions ?? BASIC));
  const [scoped, setScoped] = useState(role?.workspaceScoped ?? false);
  const may = (p: Permission) => mine.includes(p);

  const toggle = (p: Permission, on: boolean) =>
    setPerms((s) => {
      const next = new Set(s);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  const startFrom = (key: string) => {
    const src = roles.find((r) => r.key === key);
    setPerms(new Set((src?.permissions ?? BASIC).filter(may)));
    setScoped(src?.workspaceScoped ?? false);
    if (!src) return;
    if (!description) setDescription(src.description);
  };

  const save = () =>
    start(async () => {
      const f = new FormData();
      f.set("name", name);
      f.set("description", description);
      if (scoped) f.set("workspaceScoped", "on");
      for (const p of perms) f.append("permissions", p);
      const r = role ? await updateRoleAction(role.key, f) : await createRoleAction(f);
      if (r.ok) {
        toast.success(r.message ?? "Saved");
        onClose();
        router.refresh();
      } else toast.error(r.message ?? "Something went wrong. Try again.");
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl max-sm:p-0 max-sm:pb-0">
        <DialogHeader className="border-b p-4 sm:p-5">
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>Pick what people with this role can open and do. Changes apply on their next page load.</DialogDescription>
        </DialogHeader>
        <form
          id="role-form"
          className="grid min-h-0 flex-1 gap-5 overflow-y-auto overscroll-contain p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="role-name">Name</Label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required autoComplete="off" placeholder="e.g. Media buyer…" />
            </div>
            {!role ? (
              <div className="grid gap-1.5">
                <Label htmlFor="role-from">Start from</Label>
                <NativeSelect id="role-from" defaultValue="" onChange={(e) => startFrom(e.target.value)}>
                  <option value="">Basic read-only</option>
                  {roles
                    .filter((r) => r.key !== "owner")
                    .map((r) => (
                      <option key={r.key} value={r.key}>
                        Copy of {r.name}
                      </option>
                    ))}
                </NativeSelect>
              </div>
            ) : null}
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="role-desc">Description</Label>
              <Input id="role-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} autoComplete="off" placeholder="What this role is for (optional)…" />
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/30 p-3">
            <div className="min-w-0">
              <Label htmlFor="role-scoped">Only selected workspaces</Label>
              <p id="role-scoped-desc" className="mt-0.5 text-xs text-pretty text-muted-foreground">
                Like Client: you pick which workspaces each person can see when you invite them or change their role.
              </p>
            </div>
            <Switch id="role-scoped" checked={scoped} onCheckedChange={setScoped} aria-describedby="role-scoped-desc" />
          </div>

          {PERMISSION_GROUPS.map((g) => {
            const available = g.items.filter((i) => may(i.permission));
            const on = g.items.filter((i) => perms.has(i.permission)).length;
            const all = available.length > 0 && available.every((i) => perms.has(i.permission));
            return (
              <fieldset key={g.title} className="min-w-0">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <legend className="text-sm font-medium">
                    {g.title}{" "}
                    <span className="font-normal text-muted-foreground tabular-nums">
                      · {on} of {g.items.length}
                    </span>
                  </legend>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={available.length === 0}
                    onClick={() => setPerms((s) => {
                      const next = new Set(s);
                      for (const i of available) {
                        if (all) next.delete(i.permission);
                        else next.add(i.permission);
                      }
                      return next;
                    })}
                  >
                    {all ? "Clear all" : "Select all"}
                  </Button>
                </div>
                <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2">
                  {g.items.map((i) => {
                    const disabled = !may(i.permission);
                    return (
                      <label
                        key={i.permission}
                        className={cn("flex min-h-12 cursor-pointer items-start gap-3 bg-card px-3 py-2.5 hover:bg-muted/50", disabled && "cursor-not-allowed opacity-60 hover:bg-card")}
                        title={disabled ? "Your own role doesn't have this, so you can't grant it." : undefined}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                          checked={perms.has(i.permission)}
                          disabled={disabled}
                          onChange={(e) => toggle(i.permission, e.target.checked)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm leading-5">{i.label}</span>
                          <span className="block text-xs text-pretty text-muted-foreground">{i.description}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </form>
        <DialogFooter className="m-0 px-4 py-3 max-sm:m-0 max-sm:px-4 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5">
          <DialogClose render={<Button variant="outline" className="h-10 sm:h-8" disabled={pending} />}>Cancel</DialogClose>
          <Button type="submit" form="role-form" className="h-10 sm:h-8" disabled={pending || !name.trim()}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {pending ? "Saving…" : role ? "Save role" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRole({ role, roles, onClose }: { role: RoleRow; roles: RoleRow[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // Members move to a role the viewer can assign; a workspace-limited role only takes members that were already limited.
  const options = roles.filter((r) => r.key !== role.key && r.assignable && (!r.workspaceScoped || role.workspaceScoped));
  const [moveTo, setMoveTo] = useState(options.find((r) => r.key === "viewer")?.key ?? options[0]?.key ?? "");
  const inUse = role.members > 0;

  const run = () =>
    start(async () => {
      const r = await deleteRoleAction(role.key, moveTo || null);
      if (r.ok) {
        toast.success(r.message ?? "Deleted");
        onClose();
        router.refresh();
      } else toast.error(r.message ?? "Something went wrong. Try again.");
    });

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-balance">Delete {role.name}?</DialogTitle>
          <DialogDescription className="text-pretty">
            {inUse
              ? `${role.members} ${role.members === 1 ? "person has" : "people have"} this role. Choose the role they move to. Pending invitations move too.`
              : "Nobody has this role right now. This can't be undone."}
          </DialogDescription>
        </DialogHeader>
        <div className={cn("grid gap-1.5", !inUse && "hidden")}>
          <Label htmlFor="move-to">Move members to</Label>
          <NativeSelect id="move-to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            {options.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" className="h-10 sm:h-8" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" className="h-10 sm:h-8" disabled={pending || (inUse && !moveTo)} onClick={run}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            {pending ? "Deleting…" : "Delete role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
