import { NextResponse } from "next/server";
import { authenticateRequest } from "./auth";
import type { Workspace } from "./settings";

export const json = (data: unknown, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}

/** Wrap an API handler that needs a session cookie or API key. */
export function withAuth<C>(handler: (req: Request, ws: Workspace, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    const ws = await authenticateRequest(req);
    if (!ws) return json({ error: "unauthorized", hint: "Send `Authorization: Bearer al_...` (create a key in Settings → API keys)." }, 401);
    try {
      return await handler(req, ws, ctx);
    } catch (err) {
      if (err && typeof err === "object" && "issues" in err) return json({ error: "invalid parameters", details: (err as { issues: unknown }).issues }, 400);
      throw err;
    }
  };
}

// ---- tiny in-memory token bucket (single app process per container)

const buckets = new Map<string, { tokens: number; at: number }>();

export function rateLimit(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) buckets.clear();
  return true;
}
