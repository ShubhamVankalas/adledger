import { z } from "zod";
import { authenticatePrincipal } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { BodyTooLargeError, isSameOriginRequest, json, rateLimit, readTextLimited } from "@/lib/http";
import { SEARCH_KINDS, SEARCH_QUERY_MAX, searchWorkspace } from "@/lib/search";

// POST /api/v1/search: find contacts, campaigns, ad sets and ads in the caller's workspace.
// The query travels in the body (never the URL) so an email address typed into ⌘K doesn't end
// up in access logs, browser history or a proxy's cache. The query itself is never logged.

const Body = z.object({
  q: z.string().trim().min(1).max(SEARCH_QUERY_MAX),
  kinds: z.array(z.enum(SEARCH_KINDS)).max(SEARCH_KINDS.length).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});

/** Per caller (member or key), per minute. Typing in the palette sends at most a few a second. */
const PER_MINUTE = 240;

export async function POST(req: Request) {
  const principal = await authenticatePrincipal(req);
  if (!principal) return json({ error: "unauthorized", hint: "Send `Authorization: Bearer al_...` (create a key in Settings → API keys)." }, 401);
  if (principal.kind === "session") {
    if (!principal.user.can("reports.view")) return json({ error: "forbidden", hint: "Your role doesn't allow this." }, 403);
    if (!isSameOriginRequest(req)) return json({ error: "cross-site request blocked" }, 403);
  }
  const who = principal.kind === "session" ? `u:${principal.user.id}` : "key";
  if (!rateLimit(`search:${principal.workspace.id}:${who}`, PER_MINUTE)) {
    return json({ error: "rate limited", hint: "Slow down and retry in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readTextLimited(req, 4096));
  } catch (err) {
    if (err instanceof BodyTooLargeError) return json({ error: "body too large" }, 413);
    return json({ error: "invalid JSON body", hint: 'Send {"q": "search text"}.' }, 400);
  }
  const parsed = Body.safeParse(raw);
  // Report which field is wrong without echoing its value (it may be an email address).
  if (!parsed.success) return json({ error: "invalid parameters", fields: [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "body"))] }, 400);

  const db = await getDb();
  const results = await searchWorkspace(db, principal.workspace, parsed.data.q, {
    kinds: parsed.data.kinds,
    limit: parsed.data.limit,
    // Agency clients see masked contact emails; members and API keys see them in full.
    maskEmails: principal.kind === "session" && principal.user.role === "client",
  });
  return json({ results }, { headers: { "Cache-Control": "private, no-store" } });
}
