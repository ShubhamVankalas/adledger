"use client";

import { ChevronRightIcon, EyeIcon, Loader2Icon, RefreshCwIcon, RotateCcwIcon, SendIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  deleteWebhookEndpointAction,
  redeliverWebhookAction,
  revealWebhookSecretAction,
  rollWebhookSecretAction,
  sendWebhookTestAction,
  setWebhookEndpointEnabledAction,
} from "@/app/actions/developers";
import { ActionButton } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { NativeSelect } from "@/components/native-select";
import { Snippet } from "@/components/settings/code-snippet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { WEBHOOK_EVENTS, type WebhookEventType } from "@/lib/webhooks/catalog";

/** On/off switch for an endpoint (paused endpoints get no new events). */
export function EndpointEnabledSwitch({ id, enabled }: { id: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  const router = useRouter();
  const uid = useId();
  return (
    <div className="flex items-center gap-2.5">
      <Switch
        id={uid}
        checked={on}
        disabled={pending}
        onCheckedChange={(v) => {
          setOn(v);
          start(async () => {
            const r = await setWebhookEndpointEnabledAction(id, v);
            if (r.ok) toast.success(r.message ?? "Saved");
            else {
              setOn(!v);
              toast.error(r.message ?? "Couldn't save. Try again.");
            }
            router.refresh();
          });
        }}
      />
      <Label htmlFor={uid} className="text-ui">
        {on ? "Sending events" : "Paused"}
      </Label>
    </div>
  );
}

export function DeleteEndpointButton({ id }: { id: string }) {
  const router = useRouter();
  return (
    <ActionButton
      action={() => deleteWebhookEndpointAction(id)}
      variant="outline"
      className="h-10 text-negative hover:text-negative sm:h-8"
      confirm="Delete this endpoint? It stops receiving events right away and its delivery log is deleted too."
      confirmLabel="Delete endpoint"
      onDone={(r) => r.ok && router.push("/developers/webhooks")}
    >
      Delete endpoint
    </ActionButton>
  );
}

/** Reveal (audited) or roll the signing secret. */
export function SigningSecret({ id }: { id: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const reveal = () =>
    start(async () => {
      const r = await revealWebhookSecretAction(id);
      if (r.ok) setSecret(String(r.data?.secret ?? ""));
      else toast.error(r.message ?? "Couldn't reveal the secret.");
    });
  return (
    <div className="space-y-2">
      {secret ? (
        <CopyField value={secret} />
      ) : (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
          <code aria-label="Hidden signing secret" className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" translate="no">
            whsec_••••••••••••••••••••••••
          </code>
          <Button type="button" variant="outline" size="sm" onClick={reveal} disabled={pending}>
            {pending ? <Loader2Icon aria-hidden className="animate-spin" /> : <EyeIcon aria-hidden />}
            Reveal
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-muted-foreground">Revealing is recorded in the audit log.</p>
        <ActionButton
          action={() => rollWebhookSecretAction(id)}
          variant="ghost"
          size="sm"
          confirm="Roll the signing secret? The current secret stops working immediately, so update your receiver right after."
          confirmLabel="Roll secret"
          onDone={(r) => r.ok && setSecret(String(r.data?.secret ?? ""))}
        >
          <RotateCcwIcon aria-hidden /> Roll secret
        </ActionButton>
      </div>
    </div>
  );
}

/** Pick an event and send its sample payload now. */
export function SendTestEvent({ id, events, disabled }: { id: string; events: WebhookEventType[]; disabled: boolean }) {
  const options = WEBHOOK_EVENTS.filter((e) => events.includes(e.type));
  const [type, setType] = useState<WebhookEventType>(options[0]?.type ?? "lead.created");
  const [pending, start] = useTransition();
  const router = useRouter();
  const uid = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={uid}>Event</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <NativeSelect id={uid} value={type} onChange={(e) => setType(e.target.value as WebhookEventType)} className="sm:flex-1" disabled={disabled}>
          {(options.length ? options : WEBHOOK_EVENTS).map((e) => (
            <option key={e.type} value={e.type}>
              {e.label} ({e.type})
            </option>
          ))}
        </NativeSelect>
        <Button
          type="button"
          disabled={disabled || pending}
          className="h-10 sm:h-8"
          onClick={() =>
            start(async () => {
              const r = await sendWebhookTestAction(id, type);
              if (r.ok) toast.success(r.message ?? "Delivered");
              else toast.error(r.message ?? "Not delivered");
              router.refresh();
            })
          }
        >
          {pending ? <Loader2Icon aria-hidden className="animate-spin" /> : <SendIcon aria-hidden />}
          {pending ? "Sending…" : "Send test event"}
        </Button>
      </div>
      <p className="text-caption text-pretty text-muted-foreground">
        {disabled ? "Turn the endpoint on to send a test." : "Sample data with \"test\": true. Sent once, never retried."}
      </p>
    </div>
  );
}

export type DeliveryRow = {
  id: string;
  event: string;
  eventId: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  maxAttempts: number;
  responseCode: number | null;
  responseBody: string | null;
  lastError: string | null;
  durationMs: number | null;
  createdAt: string;
  nextAttemptAt: string | null;
  test: boolean;
  payload: string;
};

function timeUntil(date: string): string {
  const s = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  if (s < 60) return "in under a minute";
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  return `in ${Math.round(s / 3600)}h`;
}

function StatusBadge({ d }: { d: DeliveryRow }) {
  if (d.status === "delivered") return <Badge variant="positive">Delivered</Badge>;
  if (d.status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="warning">{d.attempts ? "Retrying" : "Queued"}</Badge>;
}

/** Delivery log with expandable request/response details and a redeliver button per row. */
export function DeliveryLog({ rows, canResend }: { rows: DeliveryRow[]; canResend: boolean }) {
  return (
    <ul className="divide-y border-t">
      {rows.map((d) => (
        <li key={d.id}>
          <details className="group/row">
            <summary className="grid cursor-pointer list-none grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 outline-none hover:bg-fill/60 focus-visible:bg-fill/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:grid-cols-[1rem_6rem_minmax(0,1fr)_8rem_7rem] [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon aria-hidden className="size-4 text-fg-faint transition-transform group-open/row:rotate-90 motion-reduce:transition-none" />
              <span className="hidden sm:block">
                <StatusBadge d={d} />
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <code translate="no" className="truncate font-mono text-mono text-foreground">
                    {d.event}
                  </code>
                  {d.test ? <Badge variant="outline">Test</Badge> : null}
                  <span className="sm:hidden">
                    <StatusBadge d={d} />
                  </span>
                </span>
                <span className="block truncate text-caption text-muted-foreground">
                  {d.lastError ?? (d.responseCode ? `HTTP ${d.responseCode}` : "Not sent yet")}
                  {d.status === "pending" && d.nextAttemptAt ? (
                    <span suppressHydrationWarning> · next try {timeUntil(d.nextAttemptAt)}</span>
                  ) : null}
                </span>
              </span>
              <span className="hidden text-caption text-muted-foreground tabular-nums sm:block">
                {d.attempts} of {d.maxAttempts} {d.maxAttempts === 1 ? "try" : "tries"}
                {d.durationMs !== null ? ` · ${d.durationMs} ms` : ""}
              </span>
              <span className="text-right text-caption text-muted-foreground tabular-nums" suppressHydrationWarning>
                {timeAgo(d.createdAt)}
              </span>
            </summary>
            <div className="grid gap-3 border-t bg-bg-subtle/60 px-4 py-3 lg:grid-cols-2">
              <Snippet label={`Payload · ${d.eventId}`} code={d.payload} className="max-h-96 overflow-auto" />
              <div className="flex min-w-0 flex-col gap-3">
                <Snippet label={d.responseCode ? `Response · HTTP ${d.responseCode}` : "Response"} code={d.responseBody ?? (d.lastError ? `(${d.lastError})` : "(empty)")} wrap />
                <p className="text-caption text-pretty text-muted-foreground">
                  The stored payload never includes raw emails or phones; endpoints with personal data on receive them added at send time.
                </p>
                {canResend ? (
                  <ActionButton action={() => redeliverWebhookAction(d.id)} variant="outline" size="sm" className="h-9 w-fit sm:h-8">
                    <RefreshCwIcon aria-hidden /> Resend this event
                  </ActionButton>
                ) : null}
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

export function StatusFilter({ current, counts }: { current: string; counts: Record<string, number> }) {
  const router = useRouter();
  const items = [
    { id: "all", label: "All" },
    { id: "failed", label: "Failed" },
    { id: "pending", label: "Retrying" },
    { id: "delivered", label: "Delivered" },
  ];
  return (
    <div role="group" aria-label="Filter deliveries" className="flex flex-wrap gap-1">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          aria-pressed={current === i.id}
          onClick={() => router.replace(i.id === "all" ? "?" : `?status=${i.id}`, { scroll: false })}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-ui text-muted-foreground transition-colors outline-none hover:bg-fill-hover hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-7",
            current === i.id && "bg-fill-active font-medium text-foreground hover:bg-fill-active",
          )}
        >
          {i.label}
          {counts[i.id] !== undefined ? <span className="text-caption text-muted-foreground tabular-nums">{counts[i.id]}</span> : null}
        </button>
      ))}
    </div>
  );
}
