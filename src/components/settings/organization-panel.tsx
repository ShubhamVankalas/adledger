"use client";

import { ArrowRightLeftIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { switchWorkspaceAction } from "@/app/actions/account";
import { removeOrganizationLogoAction, setOrganizationLogoAction } from "@/app/actions/media";
import { createWorkspaceAction, deleteWorkspaceAction, updateOrganizationAction } from "@/app/actions/org";
import { useFormAction } from "@/components/action-button";
import { OrgLogo } from "@/components/avatars";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";
import { plural } from "@/lib/format";
import { ImageUpload } from "./image-upload";
import { TOUCH_TARGETS } from "./touch";

type WS = { id: string; name: string; currency: string; timezone: string; isDemo: boolean; contacts: number; createdAt: string };

export function OrganizationPanel({
  organization,
  workspaces,
  currentWorkspaceId,
  defaults,
  canManageOrg,
  canBrandOrg,
  canManageWorkspaces,
}: {
  organization: { id: string; name: string; logoUrl: string | null; members: number };
  workspaces: WS[];
  currentWorkspaceId: string;
  defaults: { currency: string; timezone: string };
  canManageOrg: boolean;
  canBrandOrg: boolean;
  canManageWorkspaces: boolean;
}) {
  const router = useRouter();
  const org = useFormAction(updateOrganizationAction);
  const [creating, setCreating] = useState(false);
  const create = useFormAction(createWorkspaceAction, (r) => r.ok && setCreating(false));
  const [deleting, setDeleting] = useState<WS | null>(null);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const zones = TIMEZONES.includes(defaults.timezone) ? TIMEZONES : [defaults.timezone, ...TIMEZONES];

  const switchTo = (id: string) =>
    start(async () => {
      const r = await switchWorkspaceAction(id);
      if (!r.ok) toast.error(r.message);
      router.push("/");
      router.refresh();
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            {plural(organization.members, "member")} · {plural(workspaces.length, "workspace")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <ImageUpload
            src={organization.logoUrl}
            preview={(src) => <OrgLogo id={organization.id} name={organization.name} src={src} size="xl" />}
            upload={setOrganizationLogoAction}
            remove={removeOrganizationLogoAction}
            fit="contain"
            label="Logo"
            help={
              canBrandOrg
                ? "Shown in the sidebar for everyone in the organization. PNG, JPG or WebP, up to 2 MB."
                : "Shown in the sidebar for everyone. Owners and admins can change it."
            }
            disabled={!canBrandOrg}
          />
          <form action={org.submit} className="grid gap-3 border-t pt-5 @lg/settings:grid-cols-[minmax(0,1fr)_auto] @lg/settings:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" name="name" autoComplete="off" defaultValue={organization.name} disabled={!canManageOrg} />
            </div>
            {canManageOrg ? (
              <Button type="submit" disabled={org.pending} className="md:h-9">
                {org.pending ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Workspaces</CardTitle>
            <CardDescription>Separate data, integrations and reports for each brand or client.</CardDescription>
          </div>
          {canManageWorkspaces ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <PlusIcon /> New workspace
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-lg border">
            {workspaces.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 py-3 pr-2 pl-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="min-w-0 break-words">{w.name}</span>
                    {w.id === currentWorkspaceId ? <Badge>Current</Badge> : null}
                    {w.isDemo ? <Badge variant="secondary">Demo data</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <span translate="no">{w.currency}</span> · <span translate="no">{w.timezone}</span> · <span className="tabular-nums">{plural(w.contacts, "contact")}</span>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {w.id !== currentWorkspaceId ? (
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => switchTo(w.id)} aria-label={`Switch to ${w.name}`}>
                      <ArrowRightLeftIcon /> Switch
                    </Button>
                  ) : null}
                  {canManageOrg && workspaces.length > 1 ? (
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${w.name}`} onClick={() => (setDeleting(w), setConfirm(""))}>
                      <Trash2Icon />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className={`max-h-[90dvh] overflow-y-auto sm:max-w-md ${TOUCH_TARGETS}`}>
          <DialogHeader className="pr-8">
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>For another brand, store or client. You can invite a client to see only this workspace.</DialogDescription>
          </DialogHeader>
          <form action={create.submit} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="nw-name">Name</Label>
              <Input id="nw-name" name="name" autoComplete="off" placeholder="Client name or brand…" required />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="nw-cur">Currency</Label>
                <NativeSelect id="nw-cur" name="reportingCurrency" defaultValue={defaults.currency}>
                  {CURRENCIES.map(([c]) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nw-tz">Timezone</Label>
                <NativeSelect id="nw-tz" name="timezone" defaultValue={defaults.timezone}>
                  {zones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={create.pending}>
                {create.pending ? <Loader2Icon className="animate-spin" /> : null}
                {create.pending ? "Creating…" : "Create & switch to it"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className={`max-h-[90dvh] overflow-y-auto sm:max-w-md ${TOUCH_TARGETS}`}>
          <DialogHeader className="pr-8">
            <DialogTitle className="leading-snug text-balance break-words">Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>This permanently deletes the workspace and all of its visitors, contacts, revenue, ad data and settings. It cannot be undone.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="del-confirm">Type the workspace name to confirm</Label>
            <Input
              id="del-confirm"
              name="confirm"
              autoComplete="off"
              spellCheck={false}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={deleting?.name}
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending || confirm !== deleting?.name}
              onClick={() =>
                start(async () => {
                  const r = await deleteWorkspaceAction(deleting!.id, confirm);
                  if (r.ok) toast.success(r.message);
                  else toast.error(r.message);
                  setDeleting(null);
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2Icon className="animate-spin" /> : null}
              {pending ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
