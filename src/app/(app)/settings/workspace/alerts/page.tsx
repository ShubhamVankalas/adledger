import { BellIcon } from "lucide-react";
import Link from "next/link";
import { AlertHistory } from "@/components/insights/alerts/alert-history";
import { AlertRules } from "@/components/insights/alerts/alert-rules";
import { AnomalyCard } from "@/components/insights/alerts/anomaly-card";
import type { RuleView } from "@/components/insights/alerts/types";
import { SettingsHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { alertsView, currencySymbol } from "@/lib/alerts";
import { requireUser } from "@/lib/auth";
import { AD_PLATFORMS } from "@/lib/connectors/types";
import { getDb } from "@/lib/db";
import { platformLabel } from "@/lib/format";

export const metadata = { title: "Alerts" };

export default async function AlertsSettingsPage() {
  const user = await requireUser("alerts.manage");
  const ws = user.workspace;
  const db = await getDb();
  const view = await alertsView(db, ws);

  return (
    <>
      <SettingsHeader
        title="Alerts"
        description="Hear about a problem the day it starts, not on Monday. Alerts use the same numbers as your dashboard (linear attribution, complete days in your workspace timezone)."
      >
        <Button variant="outline" render={<Link href="/insights?tab=alerts" />} className="max-sm:h-10">
          View in Insights
        </Button>
      </SettingsHeader>

      {view.channels.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed px-4 py-3">
          <p className="flex min-w-[min(100%,18rem)] flex-1 items-start gap-3 text-ui text-pretty text-muted-foreground">
            <BellIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            No notification channel is connected, so alerts only appear in Insights. Connect Slack, email, Discord, Teams, SMS or a webhook to get them where you work.
          </p>
          {user.can("workspace.settings") ? (
            <Button variant="outline" size="sm" render={<Link href="/settings/workspace/notifications" />} className="max-sm:h-10">
              Connect a channel
            </Button>
          ) : null}
        </div>
      ) : null}

      <AnomalyCard enabled={view.anomaly.enabled} z={view.anomaly.z} channels={view.channels} selected={view.anomaly.channels} />

      <AlertRules
        rules={view.rules as RuleView[]}
        channels={view.channels}
        campaigns={view.campaigns}
        platforms={AD_PLATFORMS.map((p) => ({ id: p, label: platformLabel(p) }))}
        currencySymbol={currencySymbol(ws.reportingCurrency)}
      />

      <section aria-labelledby="history-title" className="space-y-3">
        <div>
          <h3 id="history-title" className="text-title-sm">
            History
          </h3>
          <p className="text-ui text-muted-foreground">The last 30 alerts and recoveries.</p>
        </div>
        <AlertHistory items={view.history} channelNames={view.channelNames} />
      </section>
    </>
  );
}
