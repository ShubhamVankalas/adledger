"use client";

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

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {channels.map((c) => (
          <button
            key={c.provider}
            type="button"
            onClick={() => setOpen(c.provider)}
            className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-sm"
          >
            <IntegrationLogo provider={c.provider} name={c.name} color={c.color} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <StatusBadge state={states[c.provider]} />
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
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
              : "Connect at least one channel above, then choose which events it receives."}
          </CardDescription>
        </CardHeader>
        {connected.length ? (
          <CardContent>
            <form action={save.submit} className="space-y-4">
              {connected.map((c) => (
                <input key={c.provider} type="hidden" name="channels" value={c.provider} />
              ))}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Event</th>
                      <th className="px-3 py-2 font-medium">Options</th>
                      {connected.map((c) => (
                        <th key={c.provider} className="px-3 py-2 text-center font-medium">
                          {c.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {events.map((e) => (
                      <tr key={e.event} className="align-top">
                        <td className="max-w-72 px-3 py-3">
                          <div className="font-medium">{e.label}</div>
                          <div className="text-xs text-muted-foreground">{e.description}</div>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-col gap-2">
                            {Object.keys(e.defaults).length === 0 ? <span className="text-xs text-muted-foreground">—</span> : null}
                            {Object.entries(e.defaults).map(([key, def]) => (
                              <label key={key} className="flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="w-20 shrink-0">{SETTING_LABELS[key]?.label ?? key}</span>
                                <Input
                                  name={`setting:${e.event}:${key}`}
                                  type="number"
                                  min={0}
                                  max={SETTING_LABELS[key]?.max}
                                  defaultValue={String(settingsFor(e)[key] ?? def)}
                                  className="h-7 w-20"
                                />
                                <span className="whitespace-nowrap">{SETTING_LABELS[key]?.suffix}</span>
                              </label>
                            ))}
                          </div>
                        </td>
                        {connected.map((c) => {
                          const r = rule(e.event, c.provider);
                          return (
                            <td key={c.provider} className="px-3 py-3 text-center">
                              <input
                                type="checkbox"
                                name={`rule:${e.event}:${c.provider}`}
                                defaultChecked={!!r}
                                className="size-4 accent-[var(--primary)]"
                                aria-label={`${e.label} via ${c.name}`}
                              />
                              {r?.lastSentAt ? <div className="mt-1 text-[10px] text-muted-foreground">sent {timeAgo(r.lastSentAt)}</div> : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button type="submit" disabled={save.pending}>
                Save notification rules
              </Button>
            </form>
          </CardContent>
        ) : null}
      </Card>

      {openMeta ? <IntegrationDialog meta={openMeta} state={states[openMeta.provider]} open={!!open} onOpenChange={(o) => !o && setOpen(null)} /> : null}
    </div>
  );
}
