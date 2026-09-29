"use client";

import { CheckCircle2Icon, Loader2Icon, PlusIcon, ShieldAlertIcon } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { createWebhookEndpointAction, updateWebhookEndpointAction } from "@/app/actions/developers";
import { useFormAction } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { WEBHOOK_EVENTS, type WebhookEventType } from "@/lib/webhooks/catalog";

export type EndpointFormValues = { url: string; description: string; events: WebhookEventType[]; includePii: boolean };

/**
 * The endpoint fields (URL, description, events, personal data). Posts `url`, `description`,
 * one `events` per checked event and `includePii` ("on").
 */
export function EndpointFields({ initial, canPii, lockedPii = false }: { initial?: EndpointFormValues; canPii: boolean; lockedPii?: boolean }) {
  const uid = useId();
  const [events, setEvents] = useState<Set<WebhookEventType>>(new Set(initial?.events ?? ["lead.created"]));
  const [pii, setPii] = useState(initial?.includePii ?? false);
  const all = events.size === WEBHOOK_EVENTS.length;
  // Without contacts.pii a member can keep an existing "on" (or turn it off) but never turn it on.
  const piiDisabled = !canPii && !(lockedPii && pii);
  return (
    <div className="grid gap-5">
      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-url`}>Endpoint URL</Label>
        <Input
          id={`${uid}-url`}
          name="url"
          type="url"
          inputMode="url"
          required
          autoComplete="off"
          spellCheck={false}
          defaultValue={initial?.url}
          placeholder="https://hooks.zapier.com/hooks/catch/…"
          aria-describedby={`${uid}-url-hint`}
          className="font-mono text-mono"
        />
        <p id={`${uid}-url-hint`} className="text-caption text-muted-foreground">
          Must be https and reachable from this server. Private and internal addresses are blocked.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${uid}-desc`}>
          Description <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input id={`${uid}-desc`} name="description" maxLength={200} autoComplete="off" defaultValue={initial?.description} placeholder="e.g. SMS new leads via Twilio…" />
      </div>
      <fieldset className="grid gap-2">
        <div className="flex items-center justify-between gap-3">
          <legend className="text-ui font-medium">Events to send</legend>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEvents(all ? new Set() : new Set(WEBHOOK_EVENTS.map((e) => e.type)))}>
            {all ? "Clear all" : "Select all"}
          </Button>
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border">
          {WEBHOOK_EVENTS.map((e) => (
            <label key={e.type} className="flex cursor-pointer items-start gap-3 bg-card px-3 py-2.5 transition-colors hover:bg-fill/60 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-focus-visible:ring-inset">
              <input
                type="checkbox"
                name="events"
                value={e.type}
                checked={events.has(e.type)}
                onChange={(ev) =>
                  setEvents((prev) => {
                    const next = new Set(prev);
                    if (ev.target.checked) next.add(e.type);
                    else next.delete(e.type);
                    return next;
                  })
                }
                className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="flex flex-wrap items-baseline gap-x-2 text-ui">
                  <span className="font-medium">{e.label}</span>
                  <code translate="no" className="font-mono text-caption text-muted-foreground">
                    {e.type}
                  </code>
                </span>
                <span className="block text-caption text-pretty text-muted-foreground">{e.description}</span>
              </span>
            </label>
          ))}
        </div>
        {events.size === 0 ? (
          <p role="status" className="text-caption text-warning-foreground">
            Pick at least one event.
          </p>
        ) : null}
      </fieldset>
      <div className={cn("flex items-start justify-between gap-4 rounded-lg border p-3", pii ? "border-warning/40 bg-warning-soft/50" : "bg-bg-subtle/60")}>
        <div className="min-w-0">
          <Label htmlFor={`${uid}-pii`} className="flex items-center gap-1.5">
            <ShieldAlertIcon aria-hidden className={cn("size-4", pii ? "text-warning-foreground" : "text-muted-foreground")} />
            Include personal data
          </Label>
          <p id={`${uid}-pii-desc`} className="mt-1 text-caption text-pretty text-muted-foreground">
            {piiDisabled
              ? "Only members who can see contact emails can turn this on."
              : "Sends the contact's real email and phone number (needed to text or email a lead). Off: masked email and SHA-256 hashes only."}
          </p>
        </div>
        {pii ? <input type="hidden" name="includePii" value="on" /> : null}
        <Switch id={`${uid}-pii`} checked={pii} onCheckedChange={setPii} disabled={piiDisabled} aria-describedby={`${uid}-pii-desc`} />
      </div>
    </div>
  );
}

/** "Add endpoint" button + dialog. After creating, shows the signing secret once. */
export function CreateEndpointDialog({ canPii, disabled = false }: { canPii: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ id: string; secret: string } | null>(null);
  const create = useFormAction(createWebhookEndpointAction, (r) => {
    if (r.ok && r.data) setCreated({ id: String(r.data.id), secret: String(r.data.secret) });
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (create.pending) return;
        setOpen(o);
        if (!o) setCreated(null);
      }}
    >
      <DialogTrigger render={<Button disabled={disabled} className="h-10 max-sm:w-full sm:h-8" />}>
        <PlusIcon aria-hidden /> Add endpoint
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] gap-0 overflow-hidden p-0 sm:max-w-xl">
        {created ? (
          <>
            <DialogHeader className="px-4 pt-4 pb-3 sm:px-5">
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2Icon aria-hidden className="size-5 text-positive" /> Endpoint added
              </DialogTitle>
              <DialogDescription>Copy the signing secret now and store it with your receiver. You can reveal or roll it later.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 px-4 pb-4 sm:px-5">
              <div className="text-caption font-medium text-muted-foreground">Signing secret</div>
              <CopyField value={created.secret} />
              <p className="text-caption text-muted-foreground">
                Every request carries <code translate="no">AdLedger-Signature: t=…,v1=…</code>. Check it before trusting the body.
              </p>
            </div>
            <DialogFooter className="m-0 px-4 py-3 sm:px-5">
              <DialogClose render={<Button variant="outline" className="h-10 sm:h-8" />}>Close</DialogClose>
              <Button className="h-10 sm:h-8" render={<Link href={`/developers/webhooks/${created.id}`} />}>
                Send a test event
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="border-b px-4 pt-4 pb-3 sm:px-5">
              <DialogTitle>Add a webhook endpoint</DialogTitle>
              <DialogDescription>AdLedger will POST a signed JSON event to this URL each time one of the picked events happens.</DialogDescription>
            </DialogHeader>
            <form id="endpoint-create" action={create.submit} className="min-h-0 overflow-y-auto px-4 py-4 sm:px-5">
              <EndpointFields canPii={canPii} />
            </form>
            <DialogFooter className="m-0 px-4 py-3 max-sm:pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5">
              <DialogClose render={<Button variant="outline" className="h-10 sm:h-8" disabled={create.pending} />}>Cancel</DialogClose>
              <Button type="submit" form="endpoint-create" className="h-10 sm:h-8" disabled={create.pending}>
                {create.pending ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
                {create.pending ? "Checking URL…" : "Add endpoint"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Edit form on the endpoint page. */
export function EditEndpointForm({ id, initial, canPii }: { id: string; initial: EndpointFormValues; canPii: boolean }) {
  const save = useFormAction((f) => updateWebhookEndpointAction(id, f));
  return (
    <form action={save.submit} className="grid gap-5">
      <EndpointFields initial={initial} canPii={canPii} lockedPii={initial.includePii} />
      <div className="flex justify-end">
        <Button type="submit" disabled={save.pending} className="h-10 max-sm:w-full sm:h-8">
          {save.pending ? <Loader2Icon aria-hidden className="animate-spin" /> : null}
          {save.pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
