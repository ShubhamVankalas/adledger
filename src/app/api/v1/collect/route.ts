import { getDb } from "@/lib/db";
import { BodyTooLargeError, clientIp, rateLimit, readTextLimited } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
import { nudgeLive } from "@/lib/live";
import { collectSchema, isBot, processCollect } from "@/lib/tracking/collect";

// Pixel endpoint. The pixel sends text/plain JSON via sendBeacon (no CORS preflight).

function cors(origin: string | null): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const headers = cors(origin);
  const ip = clientIp(req);
  if (!rateLimit(`collect:${ip}`, 600)) return new Response("rate limited", { status: 429, headers });
  const ua = req.headers.get("user-agent");
  if (isBot(ua)) return new Response(null, { status: 204, headers });

  let payload;
  try {
    // Never buffer more than 64 KB from an anonymous caller.
    payload = collectSchema.parse(JSON.parse(await readTextLimited(req, 64_000)));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return new Response("payload too large", { status: 413, headers });
    return new Response("invalid payload", { status: 400, headers });
  }
  if (!rateLimit(`collect-site:${payload.site}`, 20_000)) return new Response("rate limited", { status: 429, headers });

  const db = await getDb();
  const result = await processCollect(db, payload, {
    origin: origin ?? req.headers.get("referer"),
    userAgent: ua,
    ip,
  });
  if (!result.ok) return new Response(result.error, { status: result.status, headers });
  if (result.newLeads > 0 || result.contactsLinked > 0) await requestAttribution(result.workspaceId);
  nudgeLive(result.workspaceId); // open Live tabs pick the hit up now instead of on the next poll
  return new Response(null, { status: 204, headers });
}
