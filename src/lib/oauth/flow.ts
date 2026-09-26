import { getAdsConnector } from "../connectors/registry";
import type { OAuthMeta } from "../connectors/types";
import { cleanMessage, getOAuthProvider, OAuthError, type FetchFn, type OAuthCredentials } from "./providers";
import {
  codeChallengeS256,
  createCodeVerifier,
  createState,
  PENDING_TTL_SECONDS,
  safeEqual,
  sealPending,
  signState,
  STATE_TTL_SECONDS,
  verifyState,
} from "./state";

// The two halves of one-click connect, independent of Next.js so they can be tested directly:
// beginOAuth (→ authorize URL + signed state cookie) and completeOAuth (callback → tokens sealed
// in a short-lived cookie until the user picks which ad accounts to import).

type Env = Record<string, string | undefined>;

export function oauthMeta(provider: string): OAuthMeta | undefined {
  return getOAuthProvider(provider) ? getAdsConnector(provider)?.meta.oauth : undefined;
}

/** The install's OAuth app for `provider`, or null when any of its env vars is missing. */
export function oauthCredentials(provider: string, env: Env = process.env): OAuthCredentials | null {
  const m = oauthMeta(provider);
  if (!m || m.env.length < 2) return null;
  const values = m.env.map((k) => env[k]?.trim() ?? "");
  if (values.some((v) => !v)) return null;
  return { clientId: values[0], clientSecret: values[1], extra: Object.fromEntries(m.env.slice(2).map((k, i) => [k, values[i + 2]])) };
}

export const oauthConfigured = (provider: string, env: Env = process.env) => oauthCredentials(provider, env) !== null;

/** Base URL for redirect URIs: PUBLIC_URL, else the request's (proxy-aware) origin. */
export function requestOrigin(req: Request, env: Env = process.env): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export const callbackUrl = (origin: string, provider: string) => `${origin}/api/v1/oauth/${provider}/callback`;

/** Where both routes send the browser: the account picker (or its error screen). */
export function connectPageUrl(origin: string, provider: string, error?: string): string {
  const path = `${origin}/settings/workspace/integrations/connect/${encodeURIComponent(provider)}`;
  return error ? `${path}?error=${encodeURIComponent(cleanMessage(error, 240))}` : path;
}

export type OAuthUser = { id: string; workspaceId: string };

export function beginOAuth(opts: {
  provider: string;
  user: OAuthUser;
  origin: string;
  secret: string;
  env?: Env;
  now?: number;
}): { url: string; cookie: string } | { error: string } {
  const p = getOAuthProvider(opts.provider);
  const m = oauthMeta(opts.provider);
  const creds = oauthCredentials(opts.provider, opts.env);
  if (!p || !m) return { error: "This integration doesn't support one-click connect." };
  if (!creds) return { error: `One-click connect isn't set up on this server. An admin needs to set ${m.env.join(", ")}.` };
  const state = createState();
  const verifier = p.pkce ? createCodeVerifier() : undefined;
  const redirectUri = callbackUrl(opts.origin, opts.provider);
  const url = p.authorizeUrl({ creds, redirectUri, state, scopes: m.scopes, codeChallenge: verifier ? codeChallengeS256(verifier) : undefined });
  const cookie = signState(
    {
      provider: opts.provider,
      state,
      verifier,
      userId: opts.user.id,
      workspaceId: opts.user.workspaceId,
      redirectUri,
      expiresAt: (opts.now ?? Date.now()) + STATE_TTL_SECONDS * 1000,
    },
    opts.secret,
  );
  return { url, cookie };
}

export async function completeOAuth(opts: {
  provider: string;
  params: URLSearchParams;
  stateCookie: string | undefined;
  /** The signed-in user (null if the session expired while they were away). */
  user: OAuthUser | null;
  secret: string;
  fetchFn?: FetchFn;
  env?: Env;
  now?: number;
}): Promise<{ ok: true; pending: string } | { ok: false; error: string }> {
  const now = opts.now ?? Date.now();
  const fail = (error: string) => ({ ok: false as const, error });
  const p = getOAuthProvider(opts.provider);
  if (!p) return fail("Unknown integration.");

  // The platform redirected back with an error (user clicked Cancel, app not approved…).
  const denied = opts.params.get("error") ?? opts.params.get("error_code");
  if (denied) {
    const detail = cleanMessage(opts.params.get("error_description") ?? opts.params.get("error_message") ?? opts.params.get("error_reason") ?? denied);
    return fail(/access_denied|user_denied|cancel/i.test(`${denied} ${detail}`) ? "Sign-in was cancelled. Nothing was changed." : `The platform returned an error: ${detail}`);
  }

  const saved = verifyState(opts.stateCookie, opts.secret, now);
  if (!saved || saved.provider !== opts.provider) return fail("This sign-in link expired or was opened in another browser. Start again from Integrations.");
  const state = opts.params.get("state") ?? "";
  if (!state || !safeEqual(state, saved.state)) return fail("The sign-in response didn't match the request (state mismatch). Start again.");
  if (!opts.user) return fail("Your AdLedger session expired. Sign in and connect again.");
  if (opts.user.id !== saved.userId || opts.user.workspaceId !== saved.workspaceId) {
    return fail("You switched user or workspace during sign-in. Start again from Integrations.");
  }
  // TikTok calls it auth_code; everyone else uses code.
  const code = opts.params.get("code") ?? opts.params.get("auth_code");
  if (!code) return fail("The platform didn't return an authorization code. Start again.");
  const creds = oauthCredentials(opts.provider, opts.env);
  if (!creds) return fail("One-click connect isn't set up on this server any more.");

  try {
    const tokens = await p.exchangeCode({ code, creds, redirectUri: saved.redirectUri, codeVerifier: saved.verifier }, opts.fetchFn ?? fetch);
    const pending = sealPending(
      { provider: opts.provider, userId: saved.userId, workspaceId: saved.workspaceId, tokens, expiresAt: now + PENDING_TTL_SECONDS * 1000 },
      opts.secret,
    );
    return { ok: true, pending };
  } catch (err) {
    return fail(err instanceof OAuthError ? err.message : "Couldn't reach the platform to finish sign-in. Try again.");
  }
}

/** Reads one cookie from a raw Request (route handlers stay testable without Next's request scope). */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Secure cookies behind HTTPS (same rule as sessions: COOKIE_SECURE overrides detection). */
export function isSecureRequest(req: Request, env: Env = process.env): boolean {
  if (env.COOKIE_SECURE) return env.COOKIE_SECURE === "true";
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return (proto ?? new URL(req.url).protocol.replace(":", "")) === "https";
}
