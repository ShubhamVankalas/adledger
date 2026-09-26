import { NextResponse } from "next/server";
import { Denied, guard } from "@/lib/actions";
import { beginOAuth, connectPageUrl, isSecureRequest, requestOrigin } from "@/lib/oauth/flow";
import { getOAuthProvider } from "@/lib/oauth/providers";
import { STATE_COOKIE, STATE_TTL_SECONDS } from "@/lib/oauth/state";
import { getAppSecret } from "@/lib/settings";

// GET /api/v1/oauth/{provider}/start — "Connect with X": remember who is connecting (signed
// cookie) and send the browser to the platform's consent screen.

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!getOAuthProvider(provider)) return NextResponse.json({ error: "unknown provider" }, { status: 404 });
  const origin = requestOrigin(req);
  let user;
  try {
    user = await guard("workspace.settings");
  } catch (err) {
    if (err instanceof Denied) return NextResponse.redirect(connectPageUrl(origin, provider, err.message));
    throw err;
  }
  const started = beginOAuth({ provider, user: { id: user.id, workspaceId: user.workspace.id }, origin, secret: await getAppSecret() });
  if ("error" in started) return NextResponse.redirect(connectPageUrl(origin, provider, started.error));
  const res = NextResponse.redirect(started.url);
  res.cookies.set(STATE_COOKIE, started.cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureRequest(req),
    path: "/api/v1/oauth",
    maxAge: STATE_TTL_SECONDS,
  });
  return res;
}
