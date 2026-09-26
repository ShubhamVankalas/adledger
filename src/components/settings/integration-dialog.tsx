"use client";

import { CircleAlertIcon, ExternalLinkIcon, RefreshCwIcon, SendIcon } from "lucide-react";
import { disconnectAction, saveIntegrationAction, syncNowAction } from "@/app/actions/settings";
import { sendTestNotificationAction } from "@/app/actions/notifications";
import { ActionButton, useFormAction } from "@/components/action-button";
import { CopyField } from "@/components/copy-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IntegrationMeta } from "@/lib/connectors/types";
import { timeAgo } from "@/lib/format";
import { IntegrationLogo } from "./integration-logo";

export type IntegrationState = {
  connected: boolean;
  mode: "mock" | "live" | null;
  config: Record<string, string>;
  secretKeys: string[];
  lastSyncedAt: string | null;
  lastError: string | null;
  lastRun: { status: string; rows: number; at: string } | null;
  webhookUrl: string | null;
  /** Conversions API uploads in the last 7 days (Meta, Google Ads only). */
  uploads?: { sent: number; failed: number; pending: number; skipped: number } | null;
};

/** Renders `code` spans in plain-text setup steps. */
function Step({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <IntegrationLogo provider={meta.provider} name={meta.name} color={meta.color} />
            <div className="min-w-0">
              <DialogTitle className="flex flex-wrap items-center gap-2">
                {meta.name}
                {meta.status === "beta" ? <Badge variant="outline">Beta</Badge> : null}
                <StatusBadge state={state} />
              </DialogTitle>
              <DialogDescription>{meta.description}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {state.lastError ? (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" /> {state.lastError}
          </div>
        ) : null}
        {isDemo ? (
          <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Showing built-in demo data. Enter real credentials and save to switch this integration to live data.
          </p>
        ) : null}

        {meta.steps.length ? (
          <ol className="space-y-1.5 text-xs text-muted-foreground">
            {meta.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="font-semibold text-foreground">{i + 1}.</span>
                <span>
                  <Step text={s} />
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        {state.webhookUrl ? (
          <div className="grid gap-1.5">
            <Label>Webhook URL</Label>
            <CopyField value={state.webhookUrl} />
          </div>
        ) : null}

        <form action={save.submit} className="grid gap-3 sm:grid-cols-2">
          {meta.fields.map((f) => {
            if (f.type === "toggle") {
              const checked = ["on", "true"].includes(state.config[f.name] ?? "");
              return (
                <div key={f.name} className="grid gap-1 sm:col-span-2">
                  <Label htmlFor={`${meta.provider}-${f.name}`} className="flex items-center gap-2 font-medium">
                    <input
                      id={`${meta.provider}-${f.name}`}
                      name={f.name}
                      type="checkbox"
                      defaultChecked={checked}
                      className="size-4 accent-primary"
                    />
                    {f.label}
                  </Label>
                  {f.hint ? <p className="text-[11px] text-muted-foreground">{f.hint}</p> : null}
                </div>
              );
            }
            const saved = f.secret && state.secretKeys.includes(f.name);
            return (
              <div key={f.name} className="grid gap-1.5">
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
                {f.hint ? <p className="text-[11px] text-muted-foreground">{f.hint}</p> : null}
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" disabled={save.pending}>
              {state.connected && !isDemo ? "Save changes" : "Connect"}
            </Button>
            {meta.docsUrl.startsWith("http") ? (
              <Button variant="ghost" size="sm" render={<a href={meta.docsUrl} target="_blank" rel="noreferrer" />}>
                Official docs <ExternalLinkIcon />
              </Button>
            ) : null}
          </div>
        </form>

        {state.connected && state.uploads ? <UploadStats stats={state.uploads} /> : null}

        {state.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs text-muted-foreground">
            <span>
              {syncable ? `Last sync ${timeAgo(state.lastSyncedAt)}` : "Connected"}
              {state.lastRun ? ` · ${state.lastRun.status}${state.lastRun.rows ? ` · ${state.lastRun.rows.toLocaleString()} rows` : ""}` : ""}
            </span>
            <div className="flex gap-2">
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
              <ActionButton action={() => disconnectAction(meta.provider)} variant="ghost" size="sm" confirm={`Disconnect ${meta.name}? Imported data is kept.`}>
                Disconnect
              </ActionButton>
            </div>
          </div>
        ) : null}
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
          <span className={`font-semibold tabular-nums ${i.className}`}>{i.value.toLocaleString()}</span> {i.label}
        </span>
      ))}
      {stats.skipped ? <span>{stats.skipped.toLocaleString()} skipped (nothing to match on)</span> : null}
    </div>
  );
}
