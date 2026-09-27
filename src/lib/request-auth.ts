import { apiKeyFromBearer, getSessionUser, type ApiKeyInfo, type SessionUser } from "./auth";
import type { ApiScope } from "./db/schema";
import { clientIp, isSameOriginRequest, json, rateLimit } from "./http";
import type { Permission } from "./permissions";
import type { Workspace } from "./settings";

/** Who is calling a route handler: an API key (workspace-scoped) or a signed-in member. */
export type Caller = {
  workspace: Workspace;
  via: "api_key" | "session";
  /** For audit(): user id (null for API keys) + organization/workspace. */
  actor: { id: string | null; organizationId: string; workspaceId: string };
  /** The signed-in member (sessions only). */
  user?: SessionUser;
  /** The API key (API key calls only). */
  key?: ApiKeyInfo;
  /** Role permission (sessions) or scope (API keys) check for follow-up decisions, e.g. masking. */
  can: (permission: Permission) => boolean;
};

/** Which API key scope stands in for a role permission. */
const SCOPE_FOR: Partial<Record<Permission, ApiScope>> = {
  "reports.view": "reports:read",
  "contacts.pii": "contacts:pii",
  "export.contacts": "contacts:pii",
};

/**
 * Authenticate a route handler that exposes or changes personal data.
 * - `Authorization: Bearer al_...` → the key's workspace, if the key carries `scope`.
 * - Dashboard session cookie → the member must hold `permission` in the current workspace.
 * `sessionOnly` refuses API keys (for actions a role must approve, e.g. full exports).
 * Returns a Caller, or an error Response to send as-is.
 */
export async function authorize(req: Request, permission: Permission, opts: { sessionOnly?: boolean; scope?: ApiScope } = {}): Promise<Caller | Response> {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (bearer) {
    if (opts.sessionOnly) return json({ error: "forbidden", hint: "Download this from the dashboard (Settings → Workspace)." }, 403);
    const found = await apiKeyFromBearer(bearer, clientIp(req));
    if (!found) return json({ error: "unauthorized" }, 401);
    const { workspace: ws, key } = found;
    if (!opts.scope || !key.scopes.includes(opts.scope)) return missingScope(opts.scope);
    if (!withinRateLimit(req, ws.id)) return rateLimited();
    const scopes = new Set<string>(key.scopes);
    return {
      workspace: ws,
      via: "api_key",
      key,
      actor: { id: null, organizationId: ws.organizationId, workspaceId: ws.id },
      can: (p) => Boolean(SCOPE_FOR[p] && scopes.has(SCOPE_FOR[p]!)),
    };
  }
  const user = await getSessionUser();
  if (!user) return json({ error: "unauthorized", hint: "Send `Authorization: Bearer al_...` (create a key in Settings → API keys)." }, 401);
  if (user.needs2fa) return json({ error: "forbidden", hint: "Your organization requires two-factor sign-in. Set it up in the dashboard first." }, 403);
  if (!user.can(permission)) return json({ error: "forbidden", hint: "Your role doesn't allow this. Ask an admin." }, 403);
  // Same CSRF and rate-limit rules as withAuth() in ./http.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase()) && !isSameOriginRequest(req)) {
    return json({ error: "cross-site request blocked" }, 403);
  }
  if (!withinRateLimit(req, user.workspace.id)) return rateLimited();
  return {
    workspace: user.workspace,
    via: "session",
    user,
    actor: { id: user.id, organizationId: user.organization.id, workspaceId: user.workspace.id },
    can: (p) => user.can(p),
  };
}

export const missingScope = (scope?: ApiScope) =>
  json({ error: "forbidden", hint: scope ? `This API key lacks the "${scope}" scope. Create a key with it in Settings → API & MCP.` : "API keys can't call this endpoint." }, 403);

function withinRateLimit(req: Request, workspaceId: string) {
  const route = new URL(req.url).pathname.split("/").slice(0, 4).join("/");
  return rateLimit(`api:${workspaceId}:${route}`, 300);
}

const rateLimited = () => json({ error: "rate limited", hint: "Slow down and retry in a minute." }, { status: 429, headers: { "Retry-After": "60" } });

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Content-Disposition filename part: `adledger-<slug>-<what>-YYYY-MM-DD.<ext>`. */
export function downloadName(ws: Workspace, what: string, ext: string, now = new Date()) {
  const slug = ws.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "workspace";
  return `adledger-${slug}-${what}-${now.toISOString().slice(0, 10)}.${ext}`;
}
