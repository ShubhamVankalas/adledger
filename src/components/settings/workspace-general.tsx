"use client";

import { DatabaseIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { clearDataAction, loadDemoAction, updateWorkspaceAction } from "@/app/actions/settings";
import { ActionButton, useFormAction } from "@/components/action-button";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CURRENCIES, TIMEZONES } from "@/lib/constants";

type WS = { name: string; reportingCurrency: string; timezone: string; attributionWindowDays: number; isDemo: boolean };

export function WorkspaceGeneral({ workspace, canEdit, canData }: { workspace: WS; canEdit: boolean; canData: boolean }) {
  const save = useFormAction(updateWorkspaceAction);
  const zones = TIMEZONES.includes(workspace.timezone) ? TIMEZONES : [workspace.timezone, ...TIMEZONES];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Workspace details</CardTitle>
          <CardDescription>Reporting currency, the timezone used for day boundaries, and the attribution lookback window.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={save.submit} className="grid gap-4">
            <fieldset disabled={!canEdit} className="grid gap-4 disabled:opacity-70">
              <div className="grid gap-1.5">
                <Label htmlFor="ws-name">Name</Label>
                <Input id="ws-name" name="name" defaultValue={workspace.name} required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="ws-cur">Reporting currency</Label>
                  <NativeSelect id="ws-cur" name="reportingCurrency" defaultValue={workspace.reportingCurrency}>
                    {CURRENCIES.map(([c, n]) => (
                      <option key={c} value={c}>
                        {c} — {n}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ws-tz">Timezone</Label>
                  <NativeSelect id="ws-tz" name="timezone" defaultValue={workspace.timezone}>
                    {zones.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ws-window">Attribution window (days)</Label>
                <Input id="ws-window" name="attributionWindowDays" type="number" min={1} max={365} defaultValue={workspace.attributionWindowDays} className="max-w-32" />
                <p className="text-[11px] text-muted-foreground">Touchpoints older than this before a first purchase get no credit. 30 days suits most businesses; use 60–90 for long B2B sales cycles.</p>
              </div>
            </fieldset>
            {canEdit ? (
              <div>
                <Button type="submit" disabled={save.pending}>
                  Save workspace
                </Button>
              </div>
            ) : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseIcon className="size-4 text-muted-foreground" /> Data
          </CardTitle>
          <CardDescription>{workspace.isDemo ? "This workspace contains demo data." : "Load demo data to explore, or wipe imported data to start fresh."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!canData ? (
            <p className="text-sm text-muted-foreground">Only owners and admins can load or delete data.</p>
          ) : workspace.isDemo ? (
            <ActionButton action={clearDataAction} confirm="Remove all demo data? Your settings, pixel snippets and API keys are kept.">
              <Trash2Icon /> Clear demo data &amp; start fresh
            </ActionButton>
          ) : (
            <>
              <ActionButton action={loadDemoAction} variant="outline" confirm="Replace all current data with demo data?">
                <SparklesIcon /> Load demo data
              </ActionButton>
              <ActionButton action={clearDataAction} variant="destructive" confirm="Permanently delete all tracked visitors, contacts, revenue and ad data in this workspace? This cannot be undone.">
                <Trash2Icon /> Delete all data
              </ActionButton>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
