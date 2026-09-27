"use client";

import { CheckIcon, CopyIcon, ExternalLinkIcon, Link2Icon, Loader2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createShareLinkAction, revokeShareLinkAction } from "@/app/actions/sharing";
import { useCopy } from "@/components/copy-field";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Segmented } from "../segmented";

export type ShareLinkView = {
  id: string;
  label: string;
  /** "Last 30 days · Linear attribution · Meta only" */
  filters: string;
  status: "active" | "expired" | "revoked";
  /** Formatted dates in the workspace timezone. */
  expires: string;
  created: string;
  createdBy: string | null;
  views: number;
  lastViewed: string | null;
};

const PERIODS = [
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "custom", label: "Fixed dates…" },
];

export function ShareLinks({
  links,
  platforms,
  canShare,
  defaultEnd,
}: {
  links: ShareLinkView[];
  platforms: { id: string; label: string }[];
  canShare: boolean;
  /** Latest day with data (YYYY-MM-DD), to prefill fixed dates. */
  defaultEnd: string;
}) {
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [period, setPeriod] = useState("30d");
  const [saving, startSave] = useTransition();
  const [revoking, setRevoking] = useState<ShareLinkView | null>(null);
  const [revokePending, startRevoke] = useTransition();
  const { copied, copy } = useCopy();
  const router = useRouter();
  const [showInactive, setShowInactive] = useState(false);
  const active = links.filter((l) => l.status === "active");
  const inactive = links.filter((l) => l.status !== "active");
  const defaultStart = new Date(Date.parse(`${defaultEnd}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);

  const submit = (form: FormData) =>
    startSave(async () => {
      const r = await createShareLinkAction(form);
      if (!r.ok) {
        toast.error(r.message ?? "Couldn’t create the link.");
        return;
      }
      setCreated(String(r.data?.url ?? ""));
      router.refresh();
    });

  const revoke = (l: ShareLinkView) =>
    startRevoke(async () => {
      const r = await revokeShareLinkAction(l.id);
      if (r.ok) toast.success(r.message ?? "Revoked");
      else toast.error(r.message ?? "Couldn’t revoke the link.");
      setRevoking(null);
      router.refresh();
    });

  const closeCreate = (o: boolean) => {
    if (saving) return;
    setCreating(o);
    if (!o) {
      setCreated(null);
      setPeriod("30d");
    }
  };

  return (
    <section aria-labelledby="links-title" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="links-title" className="text-title-sm">
            Links
          </h3>
          <p className="text-ui text-muted-foreground">{active.length ? `${active.length} active` : "No active links"}</p>
        </div>
        {canShare ? (
          <Button onClick={() => setCreating(true)} className="max-sm:h-10">
            <PlusIcon aria-hidden /> New share link
          </Button>
        ) : null}
      </div>

      {active.length ? (
        <LinkList links={active} onRevoke={canShare ? setRevoking : undefined} />
      ) : (
        <div className="flex items-start gap-3 rounded-xl bg-card px-4 py-4 shadow-(--elev-card) md:px-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-fill text-muted-foreground">
            <Link2Icon aria-hidden className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-ui font-medium">Share results without sharing a login</p>
            <p className="text-ui text-pretty text-muted-foreground">
              A share link opens a read-only page with your KPIs, spend against revenue and top campaigns. Never contacts or personal data.
            </p>
          </div>
        </div>
      )}

      {inactive.length ? (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowInactive((v) => !v)}
            aria-expanded={showInactive}
            className="rounded-sm text-ui text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {showInactive ? "Hide" : "Show"} {inactive.length} expired or revoked
          </button>
          {showInactive ? <LinkList links={inactive} className="mt-3" /> : null}
        </div>
      ) : null}

      <Dialog open={creating} onOpenChange={closeCreate}>
        <DialogContent className="sm:max-w-md">
          {created ? (
            <>
              <DialogHeader>
                <DialogTitle>Link ready</DialogTitle>
                <DialogDescription>Copy it now. For your security it is stored hashed and can’t be shown again.</DialogDescription>
              </DialogHeader>
              <div className="flex items-center gap-2 rounded-lg border bg-fill/60 py-1 pr-1 pl-3">
                <code translate="no" className="min-w-0 flex-1 truncate font-mono text-mono" title={created}>
                  {created}
                </code>
                <Button type="button" size="sm" onClick={() => copy(created)} className="max-sm:h-9">
                  {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <span className="sr-only" aria-live="polite">
                {copied ? "Link copied" : ""}
              </span>
              <DialogFooter>
                <Button variant="outline" render={<a href={created} target="_blank" rel="noopener noreferrer" />} className="max-sm:h-10">
                  <ExternalLinkIcon aria-hidden /> Open
                </Button>
                <DialogClose render={<Button className="max-sm:h-10" />}>Done</DialogClose>
              </DialogFooter>
            </>
          ) : (
            <form action={submit} className="grid gap-5">
              <DialogHeader>
                <DialogTitle>New share link</DialogTitle>
                <DialogDescription>The viewer sees exactly this view. They can’t change the dates, model or platform.</DialogDescription>
              </DialogHeader>
              <label className="grid gap-1.5">
                <span className="text-caption font-medium">Name</span>
                <Input name="label" required maxLength={120} autoComplete="off" placeholder="Monthly results for Northwind…" className="h-9" />
              </label>
              <div className="grid gap-1.5">
                <label htmlFor="share-period" className="text-caption font-medium">
                  Period
                </label>
                <NativeSelect id="share-period" name="period" value={period} onChange={(e) => setPeriod(e.target.value)}>
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </NativeSelect>
                {period === "custom" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="grid gap-1">
                      <span className="text-caption text-muted-foreground">From</span>
                      <Input type="date" name="start" required defaultValue={defaultStart} className="h-9" />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-caption text-muted-foreground">To</span>
                      <Input type="date" name="end" required defaultValue={defaultEnd} className="h-9" />
                    </label>
                  </div>
                ) : (
                  <span className="text-caption text-muted-foreground">Rolling: always ends on the latest day with data.</span>
                )}
              </div>
              <div className="grid gap-1.5">
                <span className="text-caption font-medium">Attribution</span>
                <Segmented
                  name="model"
                  label="Attribution model"
                  defaultValue="linear"
                  options={[
                    { value: "last_touch", label: "Last" },
                    { value: "first_touch", label: "First" },
                    { value: "linear", label: "Linear" },
                  ]}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-caption font-medium">Platform</span>
                  <NativeSelect name="platform" defaultValue="">
                    <option value="">All platforms</option>
                    {platforms.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label} only
                      </option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-caption font-medium">Expires after</span>
                  <NativeSelect name="expires" defaultValue="30">
                    <option value="7">7 days</option>
                    <option value="30">30 days</option>
                    <option value="90">90 days</option>
                  </NativeSelect>
                </label>
              </div>
              <DialogFooter>
                <DialogClose render={<Button type="button" variant="outline" className="max-sm:h-10" disabled={saving} />}>Cancel</DialogClose>
                <Button type="submit" disabled={saving} className="max-sm:h-10">
                  {saving ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
                  {saving ? "Creating…" : "Create link"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(o) => !o && !revokePending && setRevoking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this link?</DialogTitle>
            <DialogDescription>
              Anyone opening <span className="font-medium text-foreground">{revoking?.label}</span> will see “link not available” from now on. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" className="max-sm:h-10" disabled={revokePending} />}>Cancel</DialogClose>
            <Button variant="destructive" className="max-sm:h-10" disabled={revokePending} onClick={() => revoking && revoke(revoking)}>
              {revokePending ? "Revoking…" : "Revoke link"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function LinkList({ links, onRevoke, className }: { links: ShareLinkView[]; onRevoke?: (l: ShareLinkView) => void; className?: string }) {
  return (
    <ul className={cn("divide-y overflow-hidden rounded-xl bg-card shadow-(--elev-card)", className)}>
      {links.map((l) => (
        <li key={l.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-3.5 md:px-5", l.status !== "active" && "text-muted-foreground")}>
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="min-w-0 truncate text-ui font-medium text-foreground">{l.label}</p>
              {l.status === "active" ? <Badge variant="positive">Active</Badge> : <Badge variant="secondary">{l.status === "expired" ? "Expired" : "Revoked"}</Badge>}
            </div>
            <p className="text-caption text-pretty text-muted-foreground">{l.filters}</p>
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground">
              <span>{l.status === "active" ? `Expires ${l.expires}` : l.status === "expired" ? `Expired ${l.expires}` : `Created ${l.created}`}</span>
              <span className="num">
                {l.views === 1 ? "1 view" : `${l.views.toLocaleString("en-US")} views`}
                {l.lastViewed ? `, last ${l.lastViewed}` : ""}
              </span>
              {l.createdBy ? <span>By {l.createdBy}</span> : null}
            </p>
          </div>
          {onRevoke && l.status === "active" ? (
            <Button variant="outline" size="sm" onClick={() => onRevoke(l)} className="max-sm:h-9">
              Revoke
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
