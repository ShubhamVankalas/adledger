import { getSessionUser, workspaceFromApiKey } from "./auth";
import { json } from "./http";
import type { Permission } from "./permissions";
import type { Workspace } from "./settings";

/** Who is calling a route handler: an API key (workspace-scoped) or a signed-in member. */
export type Caller = {
  workspace: Workspace;
  via: "api_key" | "session";
  /** For audit(): user id (null for API keys) + organization/workspace. */
  actor: { id: string | null; organizationId: string; workspaceId: string };
};

/**
 * Authenticate a route handler that exposes or changes personal data.
 * - `Authorization: Bearer al_...` → the key's workspace (keys are created by analysts and up).
 * - Dashboard session cookie → the member must hold `permission` in the current workspace.
 * `sessionOnly` refuses API keys (for actions a role must approve, e.g. full exports).
 * Returns a Caller, or an error Response to send as-is.
 */
export async function authorize(req: Request, permission: Permission, opts: { sessionOnly?: boolean } = {}): Promise<Caller | Response> {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  if (bearer) {
    if (opts.sessionOnly) return json({ error: "forbidden", hint: "Download this from the dashboard (Settings → Workspace)." }, 403);
    const ws = await workspaceFromApiKey(bearer);
    if (!ws) return json({ error: "unauthorized" }, 401);
    return { workspace: ws, via: "api_key", actor: { id: null, organizationId: ws.organizationId, workspaceId: ws.id } };
  }
  const user = await getSessionUser();
  if (!user) return json({ error: "unauthorized", hint: "Send `Authorization: Bearer al_...` (create a key in Settings → API keys)." }, 401);
  if (!user.can(permission)) return json({ error: "forbidden", hint: "Your role doesn't allow this. Ask an admin." }, 403);
  return { workspace: user.workspace, via: "session", actor: { id: user.id, organizationId: user.organization.id, workspaceId: user.workspace.id } };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Content-Disposition filename part: `adledger-<slug>-<what>-YYYY-MM-DD.<ext>`. */
export function downloadName(ws: Workspace, what: string, ext: string, now = new Date()) {
  const slug = ws.slug.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "workspace";
  return `adledger-${slug}-${what}-${now.toISOString().slice(0, 10)}.${ext}`;
}
