import { eq } from "drizzle-orm";
import { LiveView } from "@/components/live/live-view";
import { isFeedFilter, isHourlyMetric } from "@/components/live/options";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { cachedLiveSnapshot } from "@/lib/live";
import { liveFeed, liveSnapshot } from "@/lib/reports-live";
import { gatePage } from "@/components/access-denied";

export const metadata = { title: "Live" };

// Live (BRIEF §4.2): counters, a real-time feed, today vs yesterday by hour, and what is happening
// on the site right now. The page renders a complete first frame from SQL, then the browser
// subscribes to GET /api/v1/live (Server-Sent Events) for updates.

export default async function LivePage({ searchParams }: PageProps<"/live">) {
  const denied = await gatePage("page.live");
  if (denied) return denied;
  const user = await requireUser("reports.view");
  const ws = user.workspace;
  const db = await getDb();
  const sp = await searchParams;
  const [snapshot, feed, [site]] = await Promise.all([
    // Another tab is already watching: reuse its fresh snapshot instead of querying again.
    Promise.resolve(cachedLiveSnapshot(ws.id)).then((s) => s ?? liveSnapshot(db, ws)),
    liveFeed(db, ws, { mode: "latest", limit: 60 }),
    db.select({ id: schema.pixelSites.id }).from(schema.pixelSites).where(eq(schema.pixelSites.workspaceId, ws.id)).limit(1),
  ]);

  return (
    <LiveView
      initialSnapshot={snapshot}
      initialItems={feed.items}
      initialCursor={feed.cursor}
      initialFilter={isFeedFilter(sp.feed) ? sp.feed : "all"}
      initialMetric={isHourlyMetric(sp.chart) ? sp.chart : "revenue"}
      hasPixel={Boolean(site)}
      canSetup={user.can("workspace.settings")}
    />
  );
}
