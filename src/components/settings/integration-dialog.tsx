"use client";

import { CircleAlertIcon, ExternalLinkIcon, Loader2Icon, LogInIcon, RefreshCwIcon, SendIcon, XIcon } from "lucide-react";
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
import { num, timeAgo } from "@/lib/format";
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
  /** One-click connect is available (the admin set the OAuth app env vars). */
  oauthReady?: boolean;
  /** Conversions API uploads in the last 7 days (Meta, Google Ads only). */
  uploads?: { sent: number; failed: number; pending: number; skipped: number } | null;
};

/** Connector placeholders are examples; the ellipsis marks them as such. */
const placeholder = (p: string | undefined) => (p && !p.endsWith("…") ? `${p}…` : p);

/** Renders `code` spans in plain-text setup steps. */
function Step({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} translate="no" className="rounded bg-muted px-1 py-0.5 text-[0.85em] break-all">
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
  const oauthReady = Boolean(meta.oauth && state.oauthReady);

  const manual = (
    <>
      {meta.steps.length ? (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-balance text-muted-foreground uppercase">Setup</h3>
          <ol className="space-y-2 text-sm text-muted-foreground sm:text-xs">
            {meta.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary tabular-nums">{i + 1}</span>
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
          <span className="text-sm leading-none font-medium">Webhook URL</span>
          <CopyField value={state.webhookUrl} />
        </div>
      ) : null}

      {meta.fields.length ? (
        <form id={formId} action={save.submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3">
          {meta.fields.map((f) => {
            if (f.type === "toggle") {
              const checked = ["on", "true"].includes(state.config[f.name] ?? "");
              return (
                <div key={f.name} className="grid min-w-0 gap-1 sm:col-span-2">
                  <Label htmlFor={`${meta.provider}-${f.name}`} className="flex min-h-10 items-center gap-2.5 font-medium sm:min-h-0">
                    <input id={`${meta.provider}-${f.name}`} name={f.name} type="checkbox" defaultChecked={checked} className="size-4 shrink-0 accent-primary" />
                    {f.label}
                  </Label>
                  {f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
                </div>
              );
            }
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
                  spellCheck={false}
                  defaultValue={f.secret ? "" : (state.config[f.name] ?? "")}
                  placeholder={saved ? "•••••••• saved — leave blank to keep…" : placeholder(f.placeholder)}
                />
                {f.hint ? <p className="text-xs text-muted-foreground">{f.hint}</p> : null}
              </div>
            );
          })}
          {oauthReady ? (
            <div className="sm:col-span-2">
              <Button type="submit" variant="outline" disabled={save.pending} className="max-sm:w-full">
                {save.pending ? <Loader2Icon className="animate-spin" /> : null}
                {save.pending ? "Saving…" : "Save credentials"}
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}
    </>
  );

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
              <span className="text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>
                {syncable ? `Last sync ${timeAgo(state.lastSyncedAt)}` : "Connected"}
                {state.lastRun ? ` · ${state.lastRun.status}${state.lastRun.rows ? ` · ${num(state.lastRun.rows)} rows` : ""}` : ""}
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

          {state.connected && state.uploads ? <UploadStats stats={state.uploads} /> : null}

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

          {oauthReady ? (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3">
              <Button className="w-full sm:w-fit" render={<a href={`/api/v1/oauth/${meta.provider}/start`} />}>
                <LogInIcon /> {state.connected && !isDemo ? "Reconnect" : "Connect"} with {meta.oauth!.label}
              </Button>
              <p className="text-xs text-muted-foreground">
                Sign in with {meta.oauth!.label} and pick the ad accounts to import — no tokens to copy. Access is read-only and stored encrypted.
              </p>
            </div>
          ) : null}

          {oauthReady ? (
            <details className="group text-sm">
              <summary className="flex min-h-10 cursor-pointer items-center rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0">Or enter credentials manually</summary>
              <div className="mt-3 space-y-4">{manual}</div>
            </details>
          ) : (
            manual
          )}

          {meta.oauth && !oauthReady ? (
            <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Want one-click “Connect with {meta.oauth.label}”?</span> An admin can enable it by creating a{" "}
              {meta.oauth.label} app and setting <Step text={meta.oauth.env.map((e) => `\`${e}\``).join(", ")} /> on the server — see docs/CONNECTORS.md →
              Enable one-click connect.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2 border-t bg-muted/40 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-5">
          {meta.docsUrl.startsWith("http") ? (
            <Button variant="ghost" render={<a href={meta.docsUrl} target="_blank" rel="noreferrer" />} className="sm:mr-auto">
              Official docs <ExternalLinkIcon />
            </Button>
          ) : null}
          {meta.fields.length && !oauthReady ? (
            <Button type="submit" form={formId} disabled={save.pending} className="max-sm:flex-1">
              {save.pending ? <Loader2Icon className="animate-spin" /> : null}
              {save.pending ? "Saving…" : state.connected && !isDemo ? "Save changes" : "Connect"}
            </Button>
          ) : (
            <DialogClose render={<Button variant="outline" className="max-sm:flex-1" />}>Close</DialogClose>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function UploadStats({ stats }: { stats: NonNullable<IntegrationState["uploads"]> }) {
  const items = [
    { label: "sent", value: stats.sent, className: "text-success" },
    { label: "pending", value: stats.pending, className: "" },
    { label: "failed", value: stats.failed, className: stats.failed ? "text-destructive" : "" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Conversion uploads · last 7 days</span>
      {items.map((i) => (
        <span key={i.label}>
          <span className={`font-semibold tabular-nums ${i.className}`}>{num(i.value)}</span> {i.label}
        </span>
      ))}
      {stats.skipped ? <span className="tabular-nums">{num(stats.skipped)} skipped (nothing to match on)</span> : null}
    </div>
  );
}
