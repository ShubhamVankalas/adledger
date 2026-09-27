import { audit } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { json } from "@/lib/http";
import { reportParams } from "@/lib/reports";
import { PAUSE_CSV_PLATFORMS, pauseDraftCsv, pauseDrafts, type PauseCsvPlatform } from "@/lib/reports-profit";
import { authorize, downloadName } from "@/lib/request-auth";

// GET /api/v1/exports/pause-drafts?platform=meta|google&start=&end=&model=
// The campaigns AdLedger would pause, as a bulk-edit file for Meta Ads Manager or Google Ads
// Editor. It only produces a file for the owner to review and import: no platform is ever
// called. Session (reports.export) or API key.
export async function GET(req: Request) {
  const caller = await authorize(req, "reports.export");
  if (caller instanceof Response) return caller;
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const platform = q.platform as PauseCsvPlatform;
  if (!PAUSE_CSV_PLATFORMS.includes(platform)) return json({ error: "invalid parameters", hint: "platform must be meta or google" }, 400);
  const parsed = reportParams.safeParse({ ...q, platform: undefined });
  if (!parsed.success) return json({ error: "invalid parameters", details: parsed.error.issues }, 400);
  const db = await getDb();
  const d = await pauseDrafts(db, caller.workspace, parsed.data);
  const drafts = d.drafts.filter((x) => x.platform === platform);
  await audit(caller.actor, "pause_drafts.exported", platform, { via: caller.via, campaigns: drafts.length, start: parsed.data.start, end: parsed.data.end });
  return new Response(pauseDraftCsv(drafts, platform), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadName(caller.workspace, `pause-drafts-${platform}`, "csv")}"`,
      "Cache-Control": "no-store",
    },
  });
}
