import { getDb } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/http";
import { requestAttribution } from "@/lib/jobs";
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

  const raw = await req.text();
  if (raw.length > 64_000) return new Response("payload too large", { status: 413, headers });
  let payload;
  try {
    payload = collectSchema.parse(JSON.parse(raw));
  } catch {
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
  return new Response(null, { status: 204, headers });
}
