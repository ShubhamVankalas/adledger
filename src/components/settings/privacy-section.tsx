"use client";

import { DownloadIcon, ShieldCheckIcon } from "lucide-react";
import { saveRetentionAction } from "@/app/actions/privacy";
import { useFormAction } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { num, timeAgo } from "@/lib/format";

type Retention = { eventsDays: number | null; lastRunAt: string | null; lastDeleted: number | null };

/** Settings → Workspace → General: full data export and raw-event retention. */
export function PrivacySection({ retention, canData, minDays, maxDays }: { retention: Retention; canData: boolean; minDays: number; maxDays: number }) {
  const save = useFormAction(saveRetentionAction);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheckIcon className="size-4 text-muted-foreground" /> Privacy &amp; data ownership
        </CardTitle>
        <CardDescription>Your data is yours: download all of it at any time, and decide how long raw website events are kept.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 @3xl/settings:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium">Export all workspace data</div>
          <p className="text-xs text-muted-foreground">
            One JSON file with every campaign, spend row, visitor, event, touchpoint, contact, lead, payment and attribution credit. Credentials are
            never included. Money is in minor units (cents).
          </p>
          {canData ? (
            <Button variant="outline" render={<a href="/api/v1/exports/workspace" download />}>
              <DownloadIcon /> Download export (.json)
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Only owners and admins can export all data.</p>
          )}
        </div>

        <form action={save.submit} className="space-y-2">
          <Label htmlFor="retention-days" className="text-sm font-medium">
            Raw event retention
          </Label>
          <p className="text-xs text-muted-foreground">
            Delete raw pixel events (page views, form events) older than this many days, checked daily. Touchpoints, contacts and revenue are kept, so
            attribution and reports don&rsquo;t change. Leave empty to keep events forever.
          </p>
          <fieldset disabled={!canData} className="flex flex-wrap items-center gap-2 disabled:opacity-70">
            <Input
              id="retention-days"
              name="eventsDays"
              type="number"
              inputMode="numeric"
              autoComplete="off"
              min={minDays}
              max={maxDays}
              placeholder="Forever…"
              defaultValue={retention.eventsDays ?? ""}
              className="max-w-32 tabular-nums"
            />
            <span className="text-sm text-muted-foreground">days</span>
            {canData ? (
              <Button type="submit" className="md:h-9" disabled={save.pending}>
                {save.pending ? "Saving…" : "Save"}
              </Button>
            ) : null}
          </fieldset>
          <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
            {retention.eventsDays
              ? retention.lastRunAt
                ? `Last run ${timeAgo(retention.lastRunAt)}${retention.lastDeleted !== null ? ` · ${num(retention.lastDeleted)} events removed` : ""}.`
                : "Runs daily."
              : "Off — raw events are kept until you delete them."}
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
