"use client";

import { CircleAlertIcon, ExternalLinkIcon, Loader2Icon, RefreshCwIcon, SendIcon, XIcon } from "lucide-react";
import { disconnectAction, saveIntegrationAction, syncNowAction } from "@/app/actions/settings";
import { sendTestNotificationAction } from "@/app/actions/notifications";
import { ActionButton, useFormAction } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IntegrationMeta } from "@/lib/connectors/types";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IntegrationLogo } from "./integration-logo";
import { TOUCH_TARGETS } from "./touch";

export type IntegrationState = {
  connected: boolean;
  mode: "mock" | "live" | null;
  config: Record<string, string>;
  secretKeys: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  lastRun: { status: string; rows: number; at: string } | null;
  webhookUrl: string | null;
};

/** Renders `code` spans in plain-text setup steps. */
function Step({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em] break-all">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

export function StatusBadge({ state, forcedMock }: { state: IntegrationState; forcedMock?: boolean }) {
  if (!state.connected) return null;
  if (state.lastError) return <Badge variant="destructive">Error</Badge>;
  if (state.mode === "mock" || forcedMock) return <Badge variant="secondary">Demo data</Badge>;
  return <Badge className="bg-success/15 text-success">Connected</Badge>;
}

export function IntegrationDialog({
  meta,
  state,
  open,
  onOpenChange,
}: {
  meta: IntegrationMeta;
  state: IntegrationState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useFormAction((f) => saveIntegrationAction(meta.provider, f));
  const isDemo = state.mode === "mock";
  const syncable = meta.category === "ads" || meta.category === "revenue";
  const isNotify = meta.category === "notifications";
  const formId = `integration-form-${meta.provider}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "flex max-h-[min(88dvh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl",
          // Phones: a full-screen sheet with a pinned header and action bar; only the middle scrolls.
          "max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:ring-0",
          TOUCH_TARGETS,
        )}
      >
        <DialogHeader className="flex-row items-start gap-3 border-b px-4 py-3.5 sm:px-5">
          <IntegrationLogo provider={meta.provider} name={meta.name} color={meta.color} />
          <div className="min-w-0 flex-1 space-y-1">
            <DialogTitle className="flex flex-wrap items-center gap-2 leading-snug">
              {meta.name}
              {meta.status === "beta" ? <Badge variant="outline">Beta</Badge> : null}
              <StatusBadge state={state} />
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">{meta.description}</DialogDescription>
          </div>
          <DialogClose render={<Button variant="ghost" size="icon" className="-mt-1 -mr-2 shrink-0" />}>
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          {state.connected ? (
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                {syncable ? `Last sync ${timeAgo(state.lastSyncedAt)}` : "Connected"}
                {state.lastRun ? ` · ${state.lastRun.status}${state.lastRun.rows ? ` · ${state.lastRun.rows.toLocaleString()} rows` : ""}` : ""}
              </span>
              <div className="flex flex-wrap gap-2">
                {syncable ? (
                  <ActionButton action={() => syncNowAction(meta.provider)} variant="outline" size="sm">
                    <RefreshCwIcon /> Sync now
                  </ActionButton>
                ) : null}
                {isNotify ? (
                  <ActionButton action={() => sendTestNotificationAction(meta.provider)} variant="outline" size="sm">
                    <SendIcon /> Send test
                  </ActionButton>
                ) : null}
                <ActionButton
                  action={() => disconnectAction(meta.provider)}
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  confirm={`Disconnect ${meta.name}? Imported data is kept.`}
                >
                  Disconnect
                </ActionButton>
              </div>
            </div>
          ) : null}

          {state.lastError ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs break-words text-destructive">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> <span className="min-w-0">{state.lastError}</span>
            </div>
          ) : null}
          {isDemo ? (
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              Showing built-in demo data. Enter real credentials and save to switch this integration to live data.
            </p>
          ) : null}

          {meta.steps.length ? (
            <section className="space-y-2">
              <h3 className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Setup</h3>
              <ol className="space-y-2 text-sm text-muted-foreground sm:text-xs">
                {meta.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{i + 1}</span>
                    <span className="min-w-0 pt-px break-words">
                      <Step text={s} />
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          {state.webhookUrl ? (
            <div className="grid min-w-0 grid-cols-1 gap-1.5">
              <Label>Webhook URL</Label>
              <CopyField value={state.webhookUrl} />
            </div>
          ) : null}

          {meta.fields.length ? (
            <form id={formId} action={save.submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
              {meta.fields.map((f) => {
                const saved = f.secret && state.secretKeys.includes(f.name);
                return (
                  <div key={f.name} className="grid min-w-0 content-start gap-1.5">
                    <Label htmlFor={`${meta.provider}-${f.name}`}>
                      {f.label}
                      {f.optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
                    </Label>
                    <Input
                      id={`${meta.provider}-${f.name}`}
                      name={f.name}
                      type={f.secret ? "password" : "text"}
                      autoComplete="off"
                      defaultValue={f.secret ? "" : (state.config[f.name] ?? "")}
                      placeholder={saved ? "•••••••• saved — leave blank to keep" : f.placeholder}
                    />
                    {f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
                  </div>
                );
              })}
            </form>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t bg-muted/40 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-5">
          {meta.docsUrl.startsWith("http") ? (
            <Button variant="ghost" render={<a href={meta.docsUrl} target="_blank" rel="noreferrer" />} className="sm:mr-auto">
              Official docs <ExternalLinkIcon />
            </Button>
          ) : null}
          {meta.fields.length ? (
            <Button type="submit" form={formId} disabled={save.pending} className="max-sm:flex-1">
              {save.pending ? <Loader2Icon className="animate-spin" /> : null}
              {state.connected && !isDemo ? "Save changes" : "Connect"}
            </Button>
          ) : (
            <DialogClose render={<Button variant="outline" className="max-sm:flex-1" />}>Close</DialogClose>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
