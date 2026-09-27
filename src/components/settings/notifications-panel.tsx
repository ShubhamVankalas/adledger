"use client";

import { BellOffIcon, Loader2Icon } from "lucide-react";
import { useState } from "react";
import { saveNotificationRulesAction } from "@/app/actions/notifications";
import { useFormAction } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { IntegrationMeta } from "@/lib/connectors/types";
import { timeAgo } from "@/lib/format";
import { IntegrationDialog, StatusBadge, type IntegrationState } from "./integration-dialog";
import { IntegrationLogo } from "./integration-logo";

type EventDef = { event: string; label: string; description: string; defaults: Record<string, string | number> };
type Rule = { event: string; channel: string; settings: Record<string, string | number>; lastSentAt: string | null };

const SETTING_LABELS: Record<string, { label: string; suffix?: string; max?: number }> = {
  hour: { label: "Send at hour", suffix: ":00", max: 23 },
  minSpend: { label: "Min. spend", suffix: "per campaign / week" },
  threshold: { label: "Threshold", suffix: "or more" },
};

// Wide: a matrix (event + its options | one column per channel). Narrow: one card per event with
// labelled channel toggles. Same inputs either way, so the form posts the same fields.
const ROW = "@2xl/settings:grid-cols-[minmax(0,1fr)_repeat(var(--channels),minmax(4.5rem,auto))]";

export function NotificationsPanel({
  channels,
  states,
  events,
  rules,
  timezone,
}: {
  channels: IntegrationMeta[];
  states: Record<string, IntegrationState>;
  events: EventDef[];
  rules: Rule[];
  timezone: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const save = useFormAction(saveNotificationRulesAction);
  const connected = channels.filter((c) => states[c.provider]?.connected);
  const openMeta = channels.find((c) => c.provider === open);
  const rule = (event: string, channel: string) => rules.find((r) => r.event === event && r.channel === channel);
  const settingsFor = (e: EventDef) => rules.find((r) => r.event === e.event)?.settings ?? e.defaults;
  const cols = { "--channels": connected.length } as React.CSSProperties;

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="grid grid-cols-1 gap-3 @xl/settings:grid-cols-2 @4xl/settings:grid-cols-3">
        {channels.map((c) => (
          <button
            key={c.provider}
            type="button"
            onClick={() => setOpen(c.provider)}
            className="flex min-w-0 items-start gap-3 rounded-xl border bg-card p-4 text-left transition-[border-color,box-shadow] outline-none hover:border-primary/40 hover:shadow-sm focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <IntegrationLogo provider={c.provider} name={c.name} color={c.color} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <span className="min-w-0 font-medium break-words">{c.name}</span>
                <StatusBadge state={states[c.provider]} />
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground @xl/settings:line-clamp-2">{c.description}</p>
            </div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What gets sent where</CardTitle>
          <CardDescription>
            {connected.length
              ? `Tick the events each channel should receive. Scheduled messages use the workspace timezone (${timezone}).`
              : "Choose which events each channel receives once one is connected."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {connected.length ? (
            <form action={save.submit} className="space-y-4">
              {connected.map((c) => (
                <input key={c.provider} type="hidden" name="channels" value={c.provider} />
              ))}
              <div className="divide-y rounded-lg border" style={cols}>
                <div className={`hidden gap-4 bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground @2xl/settings:grid ${ROW}`}>
                  <span>Event</span>
                  {connected.map((c) => (
                    <span key={c.provider} className="truncate text-center" title={c.name}>
                      {c.name}
                    </span>
                  ))}
                </div>
                {events.map((e) => {
                  const opts = Object.entries(e.defaults);
                  return (
                    <div key={e.event} className={`grid gap-3 p-3 @2xl/settings:items-start @2xl/settings:gap-4 ${ROW}`}>
                      <div className="min-w-0 space-y-2">
                        <div>
                          <div className="text-sm font-medium">{e.label}</div>
                          <div className="text-xs text-muted-foreground">{e.description}</div>
                        </div>
                        {opts.map(([key, def]) => (
                          <label key={key} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span className="w-24 shrink-0">{SETTING_LABELS[key]?.label ?? key}</span>
                            <Input
                              name={`setting:${e.event}:${key}`}
                              type="number"
                              inputMode="numeric"
                              autoComplete="off"
                              min={0}
                              max={SETTING_LABELS[key]?.max}
                              defaultValue={String(settingsFor(e)[key] ?? def)}
                              className="h-8 w-20 tabular-nums"
                            />
                            <span>{SETTING_LABELS[key]?.suffix}</span>
                          </label>
                        ))}
                      </div>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 @2xl/settings:contents">
                        {connected.map((c) => {
                          const r = rule(e.event, c.provider);
                          return (
                            <label
                              key={c.provider}
                              className="flex min-h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors has-checked:border-primary/40 has-checked:bg-primary/5 @2xl/settings:min-h-0 @2xl/settings:flex-col @2xl/settings:gap-1 @2xl/settings:rounded-none @2xl/settings:border-0 @2xl/settings:px-0 @2xl/settings:pt-0.5 @2xl/settings:has-checked:bg-transparent"
                            >
                              <input
                                type="checkbox"
                                name={`rule:${e.event}:${c.provider}`}
                                defaultChecked={!!r}
                                className="size-4 accent-[var(--primary)]"
                                aria-label={`${e.label} via ${c.name}`}
                              />
                              <span className="truncate @2xl/settings:sr-only">{c.name}</span>
                              {r?.lastSentAt ? (
                                <span className="text-[11px] text-muted-foreground" suppressHydrationWarning>
                                  sent {timeAgo(r.lastSentAt)}
                                </span>
                              ) : null}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <Button type="submit" disabled={save.pending} className="max-md:w-full">
                {save.pending ? <Loader2Icon className="animate-spin" /> : null}
                {save.pending ? "Saving…" : "Save notification rules"}
              </Button>
            </form>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center">
              <BellOffIcon className="size-5 text-muted-foreground" />
              <p className="text-sm font-medium">No channel connected yet</p>
              <p className="max-w-sm text-xs text-muted-foreground">Pick Email, Slack, Discord or another channel above and connect it. You&rsquo;ll then choose what it receives here.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {openMeta ? <IntegrationDialog meta={openMeta} state={states[openMeta.provider]} open={!!open} onOpenChange={(o) => !o && setOpen(null)} /> : null}
    </div>
  );
}
