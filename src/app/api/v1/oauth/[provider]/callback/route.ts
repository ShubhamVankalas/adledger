import { NextResponse } from "next/server";
import { Denied, guard } from "@/lib/actions";
import { completeOAuth, connectPageUrl, isSecureRequest, readCookie, requestOrigin } from "@/lib/oauth/flow";
import { getOAuthProvider } from "@/lib/oauth/providers";
import { PENDING_COOKIE, PENDING_TTL_SECONDS, STATE_COOKIE } from "@/lib/oauth/state";
import { getAppSecret } from "@/lib/settings";

// GET /api/v1/oauth/{provider}/callback — the platform redirects here after consent. Verifies the
// state, exchanges the code for tokens and hands off to the account picker. Tokens never appear
// in URLs or logs: they travel in an encrypted, httpOnly cookie for a few minutes.

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!getOAuthProvider(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const origin = requestOrigin(req);
  let user = null;
  try {
    const u = await guard("workspace.settings");
    user = { id: u.id, workspaceId: u.workspace.id };
  } catch (err) {
    if (!(err instanceof Denied)) throw err;
  }
  const result = await completeOAuth({
    provider,
    params: new URL(req.url).searchParams,
    stateCookie: readCookie(req, STATE_COOKIE),
    user,
    secret: await getAppSecret(),
  });
  const secure = isSecureRequest(req);
  const res = NextResponse.redirect(connectPageUrl(origin, provider, result.ok ? undefined : result.error));
  // The state is single-use.
  res.cookies.set(STATE_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/api/v1/oauth", maxAge: 0 });
  if (result.ok) {
    res.cookies.set(PENDING_COOKIE, result.pending, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: PENDING_TTL_SECONDS });
  }
  return res;
}
