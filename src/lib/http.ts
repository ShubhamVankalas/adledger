import { NextResponse } from "next/server";
import { authenticatePrincipal } from "./auth";
import type { Permission } from "./permissions";
import type { Workspace } from "./settings";

export const json = (data: unknown, init?: number | ResponseInit) =>
  NextResponse.json(data, typeof init === "number" ? { status: init } : init);

/** Client IP from the reverse proxy's headers (best effort: without a proxy these can be spoofed). */
export function ipFromHeaders(h: Pick<Headers, "get">): string {
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "0.0.0.0"
  );
}

export function clientIp(req: Request): string {
  return ipFromHeaders(req.headers);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for cookie-authenticated API calls that change data: the browser must say the
 * request comes from this site. (API-key calls carry no ambient credentials and are exempt.)
 */
export function isSameOriginRequest(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  // The browser itself vouches for it; don't second-guess with Host, which a reverse proxy may rewrite.
  if (site === "same-origin") return true;
  const origin = req.headers.get("origin");
  if (!origin) return Boolean(site); // browsers send at least one of the two on unsafe requests
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

type AuthOptions = {
  /** Role permission required when called with a dashboard session (API keys hold the workspace's full API). */
  permission?: Permission;
  /** Requests per minute per workspace and route (default 300). */
  perMinute?: number;
};

/** Wrap an API handler that needs a session cookie or API key. */
export function withAuth<C>(handler: (req: Request, ws: Workspace, ctx: C) => Promise<Response>, opts: AuthOptions = {}) {
  return async (req: Request, ctx: C) => {
    const principal = await authenticatePrincipal(req);
    if (!principal) return json({ error: "unauthorized", hint: "Send `Authorization: Bearer al_...` (create a key in Settings → API keys)." }, 401);
    if (principal.kind === "session") {
      if (opts.permission && !principal.user.can(opts.permission)) return json({ error: "forbidden", hint: "Your role doesn't allow this." }, 403);
      if (!SAFE_METHODS.has(req.method.toUpperCase()) && !isSameOriginRequest(req)) return json({ error: "cross-site request blocked" }, 403);
    }
    const route = new URL(req.url).pathname.split("/").slice(0, 4).join("/");
    if (!rateLimit(`api:${principal.workspace.id}:${route}`, opts.perMinute ?? 300)) {
      return json({ error: "rate limited", hint: "Slow down and retry in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
    }
    try {
      return await handler(req, principal.workspace, ctx);
    } catch (err) {
      if (err && typeof err === "object" && "issues" in err) return json({ error: "invalid parameters", details: (err as { issues: unknown }).issues }, 400);
      throw err;
    }
  };
}

// ---- request bodies

export class BodyTooLargeError extends Error {}

/**
 * Read a request body, refusing anything over `maxBytes` (checked against Content-Length
 * first, then while streaming, so a huge body is never fully buffered). Throws BodyTooLargeError.
 */
export async function readBytesLimited(req: Request, maxBytes: number): Promise<Buffer> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError();
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Read a request body as UTF-8 text, refusing anything over `maxBytes`. */
export async function readTextLimited(req: Request, maxBytes: number): Promise<string> {
  return (await readBytesLimited(req, maxBytes)).toString("utf8");
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

/** Tests only. */
export function resetRateLimits() {
  buckets.clear();
}
