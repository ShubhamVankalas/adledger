import { getViewer } from "@/lib/dashboard/data";
import { getDb } from "@/lib/db";
import { cachedLiveSnapshot } from "@/lib/live";
import { liveFeed, liveSnapshot } from "@/lib/reports-live";
import { LiveNowCard } from "./live-now-card";

/**
 * Overview widget "Live now" (server part): the first frame from SQL, then the client card
 * subscribes to the live stream. Ignores the board's date range: it is always "right now".
 */
export async function LiveNowWidget() {
  const ws = (await getViewer()).workspace;
  const db = await getDb();
  const [snapshot, feed] = await Promise.all([Promise.resolve(cachedLiveSnapshot(ws.id)).then((s) => s ?? liveSnapshot(db, ws)), liveFeed(db, ws, { mode: "latest", limit: 4 })]);
  return <LiveNowCard initialSnapshot={snapshot} initialItems={feed.items} initialCursor={feed.cursor} />;
}
