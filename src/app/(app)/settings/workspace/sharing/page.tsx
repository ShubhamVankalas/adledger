import { EyeOffIcon, LockIcon, TimerIcon } from "lucide-react";
import { ShareLinks, type ShareLinkView } from "@/components/insights/share/share-links";
import { SettingsHeader } from "@/components/settings/section";
import { requireUser } from "@/lib/auth";
import { AD_PLATFORMS } from "@/lib/connectors/types";
import { getDb } from "@/lib/db";
import { platformLabel } from "@/lib/format";
import { todayIn } from "@/lib/period";
import { dataBounds } from "@/lib/reports";
import { describeShareFilters, listShareLinks, shareStatus } from "@/lib/share";

export const metadata = { title: "Sharing" };

const PROMISES = [
  { icon: EyeOffIcon, text: "Aggregates only. Contacts, emails and journeys are never on a shared page." },
  { icon: LockIcon, text: "Dates, model and platform are locked in the link. Editing the address changes nothing." },
  { icon: TimerIcon, text: "Links expire on their own and can be revoked at any time. Every view is logged." },
];

export default async function SharingSettingsPage() {
  const user = await requireUser("reports.share");
  const ws = user.workspace;
  const db = await getDb();
  const [rows, bounds] = await Promise.all([listShareLinks(db, ws.id), dataBounds(db, ws)]);
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: ws.timezone });
  const links: ShareLinkView[] = rows.map(({ link, createdByName, createdByEmail }) => ({
    id: link.id,
    label: link.label,
    filters: describeShareFilters(link.filters),
    status: shareStatus(link),
    expires: fmt.format(link.expiresAt),
    created: fmt.format(link.createdAt),
    createdBy: createdByName || createdByEmail || null,
    views: link.viewCount,
    lastViewed: link.lastViewedAt ? fmt.format(link.lastViewedAt) : null,
  }));

  return (
    <>
      <SettingsHeader
        title="Sharing"
        description="Send a client, investor or teammate a read-only view of this workspace's results. No account needed on their side."
      />
      <ul className="grid gap-x-6 gap-y-2 rounded-xl border border-dashed px-4 py-3 @3xl/settings:grid-cols-3">
        {PROMISES.map((p) => (
          <li key={p.text} className="flex items-start gap-2.5 text-ui text-pretty text-muted-foreground">
            <p.icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-faint" />
            {p.text}
          </li>
        ))}
      </ul>
      <ShareLinks
        links={links}
        canShare={user.can("reports.share")}
        platforms={AD_PLATFORMS.map((p) => ({ id: p, label: platformLabel(p) }))}
        defaultEnd={bounds.max ?? todayIn(ws.timezone)}
      />
    </>
  );
}
