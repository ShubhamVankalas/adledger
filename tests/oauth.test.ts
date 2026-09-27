import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishOAuthConnectAction } from "@/app/actions/oauth";
import { parseTikTokJson } from "@/lib/connectors/ads/tiktok";
import { getAdsConnector } from "@/lib/connectors/registry";
import { schema } from "@/lib/db";
import { getConnection, saveConnection } from "@/lib/settings";
import { setupWorkspace } from "./helpers";
import { beginOAuth, completeOAuth, connectPageUrl, oauthConfigured, oauthCredentials, readCookie, requestOrigin } from "@/lib/oauth/flow";
import { cleanMessage, getOAuthProvider, OAUTH_PROVIDERS, type OAuthCredentials } from "@/lib/oauth/providers";
import {
  codeChallengeS256,
  createCodeVerifier,
  createState,
  openPending,
  sealPending,
  signState,
  STATE_COOKIE,
  PENDING_COOKIE,
  verifyState,
  type OAuthStatePayload,
} from "@/lib/oauth/state";

const h = vi.hoisted(() => ({
  user: null as null | { id: string; workspaceId: string; allowed: boolean; orgId?: string },
  jar: new Map<string, string>(),
}));

// Route handlers read the session through guard() → getSessionUser(); fake a signed-in user.
vi.mock("@/lib/auth", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...orig,
    getSessionUser: async () =>
      h.user
        ? { id: h.user.id, workspace: { id: h.user.workspaceId }, organization: { id: h.user.orgId ?? "org" }, can: () => h.user!.allowed }
        : null,
  };
});

// Server actions read cookies through next/headers and revalidate through next/cache.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)! } : undefined),
    delete: (name: string) => void h.jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// The action starts a background sync; keep it off the network (and out of the assertions).
vi.mock("@/lib/sync", () => ({ syncProvider: vi.fn(async () => ({ status: "ok", rows: 0 })) }));

const SECRET = "test-secret-do-not-use"; // = APP_SECRET in vitest.config.ts
const USER = { id: "user-1", workspaceId: "ws-1" };
const ORIGIN = "https://adledger.example.com";
const ENV = {
  META_APP_ID: "meta-app",
  META_APP_SECRET: "meta-secret",
  GOOGLE_OAUTH_CLIENT_ID: "g-client.apps.googleusercontent.com",
  GOOGLE_OAUTH_CLIENT_SECRET: "g-secret",
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  TIKTOK_APP_ID: "tt-app",
  TIKTOK_APP_SECRET: "tt-secret",
  LINKEDIN_CLIENT_ID: "li-client",
  LINKEDIN_CLIENT_SECRET: "li-secret",
};

type Call = { url: string; init?: RequestInit };
function mockFetch(handler: (url: string, init?: RequestInit) => unknown | Response) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const out = handler(url, init);
    return out instanceof Response ? out : Response.json(out);
  });
  return { fetchFn: fn as unknown as typeof fetch, calls };
}

function startFor(provider: string, now = Date.now()) {
  const r = beginOAuth({ provider, user: USER, origin: ORIGIN, secret: SECRET, env: ENV, now });
  if ("error" in r) throw new Error(r.error);
  const url = new URL(r.url);
  return { ...r, url, state: url.searchParams.get("state")! };
}

describe("PKCE and state helpers", () => {
  it("builds RFC 7636 verifiers and S256 challenges", () => {
    // Test vector from RFC 7636 appendix B.
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const v = createCodeVerifier();
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(createCodeVerifier()).not.toBe(v);
    expect(createState()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it("signs the state cookie and rejects tampering, other secrets and expiry", () => {
    const now = 1_800_000_000_000;
    const payload: OAuthStatePayload = { provider: "meta", state: "abc", userId: "u", workspaceId: "w", redirectUri: `${ORIGIN}/cb`, expiresAt: now + 1000 };
    const cookie = signState(payload, SECRET);
    expect(verifyState(cookie, SECRET, now)).toEqual(payload);
    expect(verifyState(cookie, "another-secret", now)).toBeNull();
    expect(verifyState(cookie, SECRET, now + 2000)).toBeNull();
    const [data, sig] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, userId: "attacker" })).toString("base64url");
    expect(verifyState(`${forged}.${sig}`, SECRET, now)).toBeNull();
    expect(verifyState(`${data}.${sig}x`, SECRET, now)).toBeNull();
    expect(verifyState(`${data}`, SECRET, now)).toBeNull();
    expect(verifyState(undefined, SECRET, now)).toBeNull();
  });

  it("seals pending tokens and only opens them for the same user, workspace and provider", () => {
    const now = Date.now();
    const sealed = sealPending({ provider: "meta", userId: "u", workspaceId: "w", tokens: { accessToken: "EAAB-secret-token" }, expiresAt: now + 60_000 }, SECRET);
    expect(sealed).not.toContain("EAAB");
    const expect1 = { provider: "meta", userId: "u", workspaceId: "w" };
    expect(openPending(sealed, SECRET, expect1, now)?.tokens.accessToken).toBe("EAAB-secret-token");
    expect(openPending(sealed, SECRET, { ...expect1, userId: "other" }, now)).toBeNull();
    expect(openPending(sealed, SECRET, { ...expect1, workspaceId: "other" }, now)).toBeNull();
    expect(openPending(sealed, SECRET, { ...expect1, provider: "google_ads" }, now)).toBeNull();
    expect(openPending(sealed, SECRET, expect1, now + 120_000)).toBeNull();
    expect(openPending(sealed, "wrong", expect1, now)).toBeNull();
    expect(openPending("garbage", SECRET, expect1, now)).toBeNull();
  });

  it("keeps error text short and free of markup", () => {
    expect(cleanMessage('<script>alert("x")</script> bad\n\nthing')).toBe("script alert( x ) /script bad thing");
    expect(cleanMessage("x".repeat(500))).toHaveLength(200);
  });
});

describe("configuration", () => {
  it("is enabled per provider only when every env var is set", () => {
    for (const p of ["meta", "google_ads", "tiktok_ads", "linkedin_ads"]) {
      expect(getAdsConnector(p)?.meta.oauth, p).toBeDefined();
      expect(getOAuthProvider(p), p).toBeDefined();
      expect(oauthConfigured(p, ENV), p).toBe(true);
      expect(oauthConfigured(p, {}), p).toBe(false);
    }
    expect(oauthConfigured("google_ads", { ...ENV, GOOGLE_ADS_DEVELOPER_TOKEN: "" })).toBe(false);
    expect(oauthCredentials("google_ads", ENV)).toEqual({
      clientId: ENV.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: ENV.GOOGLE_OAUTH_CLIENT_SECRET,
      extra: { GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token" },
    });
    expect(oauthConfigured("stripe", ENV)).toBe(false);
    expect(getOAuthProvider("toString")).toBeUndefined();
  });

  it("derives the callback origin from PUBLIC_URL or the (proxied) request", () => {
    const req = new Request("http://internal:3000/api/v1/oauth/meta/start", { headers: { "x-forwarded-host": "ads.example.com", "x-forwarded-proto": "https" } });
    expect(requestOrigin(req, {})).toBe("https://ads.example.com");
    expect(requestOrigin(req, { PUBLIC_URL: "https://public.example.com/" })).toBe("https://public.example.com");
    expect(requestOrigin(new Request("http://localhost:3000/x"), {})).toBe("http://localhost:3000");
  });

  it("reads cookies from raw requests", () => {
    const req = new Request("http://x", { headers: { cookie: `a=1; ${STATE_COOKIE}=v%2E1; b=2` } });
    expect(readCookie(req, STATE_COOKIE)).toBe("v.1");
    expect(readCookie(req, "missing")).toBeUndefined();
  });
});

describe("beginOAuth", () => {
  it("sends Google a PKCE S256 challenge and offline access", () => {
    const r = startFor("google_ads");
    expect(r.url.origin + r.url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(r.url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/v1/oauth/google_ads/callback`);
    expect(r.url.searchParams.get("access_type")).toBe("offline");
    expect(r.url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords https://www.googleapis.com/auth/datamanager");
    expect(r.url.searchParams.get("code_challenge_method")).toBe("S256");
    const saved = verifyState(r.cookie, SECRET)!;
    expect(saved.state).toBe(r.state);
    expect(r.url.searchParams.get("code_challenge")).toBe(codeChallengeS256(saved.verifier!));
    expect(saved).toMatchObject({ provider: "google_ads", userId: USER.id, workspaceId: USER.workspaceId });
  });

  it("builds each platform's authorize URL", () => {
    const meta = startFor("meta").url;
    expect(meta.hostname).toBe("www.facebook.com");
    expect(meta.searchParams.get("scope")).toBe("ads_read");
    expect(meta.searchParams.get("code_challenge")).toBeNull();
    const tt = startFor("tiktok_ads").url;
    expect(tt.href).toContain("business-api.tiktok.com/portal/auth");
    expect(tt.searchParams.get("app_id")).toBe("tt-app");
    const li = startFor("linkedin_ads").url;
    expect(li.searchParams.get("scope")).toBe("r_ads r_ads_reporting");
    // Business apps (Facebook Login for Business) send a login configuration instead of scopes.
    const withConfig = beginOAuth({ provider: "meta", user: USER, origin: ORIGIN, secret: SECRET, env: { ...ENV, META_LOGIN_CONFIG_ID: "cfg-42" } });
    const cfgUrl = new URL("url" in withConfig ? withConfig.url : "http://x");
    expect(cfgUrl.searchParams.get("config_id")).toBe("cfg-42");
    expect(cfgUrl.searchParams.get("scope")).toBeNull();
    expect(li.searchParams.get("client_id")).toBe("li-client");
  });

  it("explains which env vars are missing", () => {
    const r = beginOAuth({ provider: "meta", user: USER, origin: ORIGIN, secret: SECRET, env: {} });
    expect(r).toEqual({ error: expect.stringContaining("META_APP_ID, META_APP_SECRET") });
  });
});

describe("completeOAuth (callback)", () => {
  const complete = (provider: string, params: Record<string, string>, stateCookie: string | undefined, fetchFn?: typeof fetch, user = USER) =>
    completeOAuth({ provider, params: new URLSearchParams(params), stateCookie, user, secret: SECRET, env: ENV, fetchFn });

  it("handles denial, expired/mismatched state, other users and missing codes", async () => {
    const s = startFor("meta");
    expect(await complete("meta", { error: "access_denied", error_description: "Permissions error" }, s.cookie)).toEqual({ ok: false, error: expect.stringContaining("cancelled") });
    expect(await complete("meta", { error: "server_error", error_description: "Try <b>later</b>" }, s.cookie)).toEqual({ ok: false, error: "The platform returned an error: Try b later /b" });
    expect(await complete("meta", { code: "c", state: s.state }, undefined)).toEqual({ ok: false, error: expect.stringContaining("expired") });
    expect(await complete("google_ads", { code: "c", state: s.state }, s.cookie)).toEqual({ ok: false, error: expect.stringContaining("expired") });
    expect(await complete("meta", { code: "c", state: "other" }, s.cookie)).toEqual({ ok: false, error: expect.stringContaining("state mismatch") });
    expect(await complete("meta", { code: "c", state: s.state }, s.cookie, undefined, { ...USER, id: "someone-else" })).toEqual({ ok: false, error: expect.stringContaining("switched") });
    expect(await completeOAuth({ provider: "meta", params: new URLSearchParams({ code: "c", state: s.state }), stateCookie: s.cookie, user: null, secret: SECRET, env: ENV })).toEqual({
      ok: false,
      error: expect.stringContaining("session expired"),
    });
    expect(await complete("meta", { state: s.state }, s.cookie)).toEqual({ ok: false, error: expect.stringContaining("authorization code") });
    const old = startFor("meta", Date.now() - 11 * 60_000);
    expect(await complete("meta", { code: "c", state: old.state }, old.cookie)).toEqual({ ok: false, error: expect.stringContaining("expired") });
  });

  it("exchanges a Google code with the PKCE verifier and seals the tokens", async () => {
    const s = startFor("google_ads");
    const { fetchFn, calls } = mockFetch(() => ({ access_token: "ya29.token", refresh_token: "1//refresh", expires_in: 3599 }));
    const r = await complete("google_ads", { code: "4/code", state: s.state }, s.cookie, fetchFn);
    expect(r.ok).toBe(true);
    const body = new URLSearchParams(String(calls[0].init?.body));
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(body.get("code")).toBe("4/code");
    expect(body.get("redirect_uri")).toBe(`${ORIGIN}/api/v1/oauth/google_ads/callback`);
    expect(body.get("code_verifier")).toBe(verifyState(s.cookie, SECRET)!.verifier);
    expect(body.get("client_secret")).toBe("g-secret");
    const pending = openPending(r.ok ? r.pending : "", SECRET, { provider: "google_ads", userId: USER.id, workspaceId: USER.workspaceId })!;
    expect(pending.tokens).toMatchObject({ accessToken: "ya29.token", refreshToken: "1//refresh" });
    expect(pending.tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("surfaces token-exchange errors without leaking anything else", async () => {
    const s = startFor("google_ads");
    const bad = mockFetch(() => Response.json({ error: "invalid_grant", error_description: "Bad Request" }, { status: 400 }));
    expect(await complete("google_ads", { code: "x", state: s.state }, s.cookie, bad.fetchFn)).toEqual({ ok: false, error: "Google sign-in failed: Bad Request" });
    const noRefresh = mockFetch(() => ({ access_token: "ya29.token", expires_in: 3599 }));
    expect(await complete("google_ads", { code: "x", state: s.state }, s.cookie, noRefresh.fetchFn)).toEqual({ ok: false, error: expect.stringContaining("refresh token") });
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(await complete("google_ads", { code: "x", state: s.state }, s.cookie, down)).toEqual({ ok: false, error: expect.stringContaining("Couldn't reach") });
  });

  it("swaps Meta codes for a long-lived token", async () => {
    const s = startFor("meta");
    const { fetchFn, calls } = mockFetch((url) =>
      url.includes("fb_exchange_token") ? { access_token: "EAAB-long", expires_in: 5_184_000 } : { access_token: "EAAB-short", expires_in: 3600 },
    );
    const r = await complete("meta", { code: "m-code", state: s.state }, s.cookie, fetchFn);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0].url).searchParams.get("code")).toBe("m-code");
    const p = openPending(r.ok ? r.pending : "", SECRET, { provider: "meta", userId: USER.id, workspaceId: USER.workspaceId })!;
    expect(p.tokens.accessToken).toBe("EAAB-long");
  });

  it("accepts TikTok's auth_code and reads its envelope errors", async () => {
    const s = startFor("tiktok_ads");
    // Raw text: TikTok's 19-digit IDs don't survive a plain JSON.parse.
    const ok = mockFetch(() => new Response('{"code":0,"message":"OK","data":{"access_token":"tt-token","advertiser_ids":[7300000000000000001]}}'));
    const r = await complete("tiktok_ads", { auth_code: "tt-code", state: s.state }, s.cookie, ok.fetchFn);
    expect(JSON.parse(String(ok.calls[0].init?.body))).toEqual({ app_id: "tt-app", secret: "tt-secret", auth_code: "tt-code" });
    const p = openPending(r.ok ? r.pending : "", SECRET, { provider: "tiktok_ads", userId: USER.id, workspaceId: USER.workspaceId })!;
    expect(p.tokens).toMatchObject({ accessToken: "tt-token", accountIds: ["7300000000000000001"] });
    const bad = mockFetch(() => ({ code: 40001, message: "auth_code expired" }));
    expect(await complete("tiktok_ads", { auth_code: "x", state: s.state }, s.cookie, bad.fetchFn)).toEqual({ ok: false, error: "TikTok sign-in failed: auth_code expired" });
  });

  it("exchanges LinkedIn codes and keeps the refresh token", async () => {
    const s = startFor("linkedin_ads");
    const { fetchFn } = mockFetch(() => ({ access_token: "li-access", expires_in: 5_184_000, refresh_token: "li-refresh" }));
    const r = await complete("linkedin_ads", { code: "li-code", state: s.state }, s.cookie, fetchFn);
    const p = openPending(r.ok ? r.pending : "", SECRET, { provider: "linkedin_ads", userId: USER.id, workspaceId: USER.workspaceId })!;
    expect(p.tokens).toMatchObject({ accessToken: "li-access", refreshToken: "li-refresh" });
  });
});

describe("account listing and saved connection", () => {
  const creds = (p: string) => oauthCredentials(p, ENV) as OAuthCredentials;

  it("lists Meta ad accounts across pages", async () => {
    const { fetchFn } = mockFetch((url) =>
      url.includes("after=")
        ? { data: [{ id: "act_2", name: "Closed", currency: "USD", account_status: 101 }] }
        : { data: [{ id: "act_1", name: "Main", currency: "INR", account_status: 1 }], paging: { next: "https://graph.facebook.com/v26.0/me/adaccounts?after=abc" } },
    );
    const list = await OAUTH_PROVIDERS.meta.listAccounts({ accessToken: "t" }, creds("meta"), fetchFn);
    expect(list).toEqual([
      { id: "act_1", name: "Main", currency: "INR", note: null },
      { id: "act_2", name: "Closed", currency: "USD", note: "Not active" },
    ]);
    const err = mockFetch(() => Response.json({ error: { message: "Invalid OAuth access token" } }, { status: 400 }));
    await expect(OAUTH_PROVIDERS.meta.listAccounts({ accessToken: "t" }, creds("meta"), err.fetchFn)).rejects.toThrow("Invalid OAuth access token");
  });

  it("lists Google Ads customers with names (best effort)", async () => {
    const { fetchFn, calls } = mockFetch((url) => {
      if (url.endsWith("customers:listAccessibleCustomers")) return { resourceNames: ["customers/1234567890", "customers/9876543210"] };
      if (url.includes("/customers/1234567890/")) return { results: [{ customer: { descriptiveName: "Shop", currencyCode: "EUR", manager: false } }] };
      return Response.json({ error: { message: "denied" } }, { status: 403 });
    });
    const list = await OAUTH_PROVIDERS.google_ads.listAccounts({ accessToken: "ya29" }, creds("google_ads"), fetchFn);
    expect(list).toEqual([
      { id: "123-456-7890", name: "Shop", currency: "EUR", note: null },
      { id: "987-654-3210", name: "987-654-3210", currency: null, note: "Details unavailable" },
    ]);
    expect((calls[0].init?.headers as Record<string, string>)["developer-token"]).toBe("dev-token");
  });

  it("lists TikTok advertisers and LinkedIn ad accounts", async () => {
    const tt = mockFetch(() => new Response('{"code":0,"data":{"list":[{"advertiser_id":7300000000000000003,"advertiser_name":"TT Shop"}]}}'));
    expect(await OAUTH_PROVIDERS.tiktok_ads.listAccounts({ accessToken: "t" }, creds("tiktok_ads"), tt.fetchFn)).toEqual([{ id: "7300000000000000003", name: "TT Shop" }]);
    expect((tt.calls[0].init?.headers as Record<string, string>)["Access-Token"]).toBe("t");
    const li = mockFetch((url) =>
      url.includes("pageToken")
        ? { elements: [{ id: 2, name: "Sandbox", currency: "USD", status: "ACTIVE", test: true }], metadata: {} }
        : { elements: [{ id: 1, name: "Brand", currency: "USD", status: "ACTIVE" }], metadata: { nextPageToken: "p2" } },
    );
    expect(await OAUTH_PROVIDERS.linkedin_ads.listAccounts({ accessToken: "t" }, creds("linkedin_ads"), li.fetchFn)).toEqual([
      { id: "1", name: "Brand", currency: "USD", note: null },
      { id: "2", name: "Sandbox", currency: "USD", note: "Test account" },
    ]);
  });

  it("saves under the connector's existing keys so scheduled syncs keep working", () => {
    const tokens = { accessToken: "a", refreshToken: "r" };
    for (const provider of Object.keys(OAUTH_PROVIDERS)) {
      const conn = OAUTH_PROVIDERS[provider].connection(tokens, ["1", "2"], creds(provider));
      const meta = getAdsConnector(provider)!.meta;
      for (const f of meta.fields.filter((x) => !x.optional)) {
        const bag = f.secret ? conn.secrets : conn.config;
        expect(bag[f.name], `${provider}.${f.name}`).toBeTruthy();
      }
    }
    expect(OAUTH_PROVIDERS.google_ads.connection(tokens, ["123-456-7890"], creds("google_ads"))).toMatchObject({
      config: { customerIds: "123-456-7890", clientId: ENV.GOOGLE_OAUTH_CLIENT_ID, loginCustomerId: "" },
      secrets: { refreshToken: "r", clientSecret: "g-secret", developerToken: "dev-token" },
    });
    expect(OAUTH_PROVIDERS.linkedin_ads.connection({ accessToken: "a" }, ["1"], creds("linkedin_ads")).secrets).toEqual({ accessToken: "a" });
  });
});

describe("OAuth routes", () => {
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    vi.stubEnv("PUBLIC_URL", ORIGIN);
    h.user = { ...USER, allowed: true };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

  it("start redirects to the consent screen with a signed state cookie", async () => {
    const { GET } = await import("@/app/api/v1/oauth/[provider]/start/route");
    const res = await GET(new Request(`${ORIGIN}/api/v1/oauth/google_ads/start`), params("google_ads"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.hostname).toBe("accounts.google.com");
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toContain(`${STATE_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toContain("Path=/api/v1/oauth");

    expect((await GET(new Request(`${ORIGIN}/x`), params("nope"))).status).toBe(404);
    h.user = { ...USER, allowed: false };
    const denied = await GET(new Request(`${ORIGIN}/x`), params("meta"));
    expect(denied.headers.get("location")).toContain("/settings/workspace/integrations/connect/meta?error=");
    h.user = { ...USER, allowed: true };
    vi.stubEnv("META_APP_SECRET", "");
    const off = await GET(new Request(`${ORIGIN}/x`), params("meta"));
    expect(decodeURIComponent(off.headers.get("location")!)).toContain("META_APP_SECRET");
  });

  it("callback exchanges the code and hands the tokens to the account picker", async () => {
    const { GET: start } = await import("@/app/api/v1/oauth/[provider]/start/route");
    const { GET: callback } = await import("@/app/api/v1/oauth/[provider]/callback/route");
    const started = await start(new Request(`${ORIGIN}/api/v1/oauth/linkedin_ads/start`), params("linkedin_ads"));
    const cookie = started.headers.get("set-cookie")!.split(";")[0];
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "li-access", expires_in: 100 })));

    const res = await callback(new Request(`${ORIGIN}/api/v1/oauth/linkedin_ads/callback?code=abc&state=${state}`, { headers: { cookie } }), params("linkedin_ads"));
    expect(res.headers.get("location")).toBe(connectPageUrl(ORIGIN, "linkedin_ads"));
    const cookies = res.headers.getSetCookie();
    const pending = cookies.find((c) => c.startsWith(`${PENDING_COOKIE}=`))!;
    expect(pending).toBeDefined();
    expect(pending).not.toContain("li-access");
    expect(cookies.find((c) => c.startsWith(`${STATE_COOKIE}=`))).toMatch(/Max-Age=0/i);
    const value = decodeURIComponent(pending.split(";")[0].slice(PENDING_COOKIE.length + 1));
    expect(openPending(value, SECRET, { provider: "linkedin_ads", userId: USER.id, workspaceId: USER.workspaceId })?.tokens.accessToken).toBe("li-access");

    // Replayed without the (now cleared) state cookie → friendly error, no tokens.
    const replay = await callback(new Request(`${ORIGIN}/api/v1/oauth/linkedin_ads/callback?code=abc&state=${state}`), params("linkedin_ads"));
    expect(replay.headers.get("location")).toContain("?error=");
    expect(replay.headers.getSetCookie().some((c) => c.startsWith(`${PENDING_COOKIE}=`))).toBe(false);
  });
});

describe("TikTok JSON", () => {
  it("keeps 19-digit IDs exact without touching digits inside strings", () => {
    const text = String.raw`{"code":0,"message":"ok: 1234567890123456789, done","data":{"ids":[7300000000000000001, -7300000000000000002],"n":12,"x":1.5e3,"s":"a\"7300000000000000003"}}`;
    expect(parseTikTokJson(text)).toEqual({
      code: 0,
      message: "ok: 1234567890123456789, done",
      data: { ids: ["7300000000000000001", "-7300000000000000002"], n: 12, x: 1500, s: 'a"7300000000000000003' },
    });
  });
});

describe("finishOAuthConnectAction (account picker save)", () => {
  const form = (...ids: string[]) => {
    const f = new FormData();
    for (const id of ids) f.append("account", id);
    return f;
  };
  const pendingFor = (provider: string, userId: string, workspaceId: string) =>
    sealPending(
      { provider, userId, workspaceId, tokens: { accessToken: "EAAB-new", expiresAt: Date.now() + 86_400_000 }, expiresAt: Date.now() + 60_000 },
      SECRET,
    );

  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    h.jar.clear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("saves the picked accounts as a live connection, replacing old secrets", async () => {
    const { db, ws, org } = await setupWorkspace();
    const [u] = await db.insert(schema.users).values({ email: "owner@oauth.test", passwordHash: "x" }).returning();
    h.user = { id: u.id, workspaceId: ws.id, orgId: org.id, allowed: true };
    // A previous manual connection with a secret the new sign-in doesn't provide.
    await saveConnection(ws.id, "meta", { mode: "live", config: { adAccountIds: "act_1", apiVersion: "v20.0" }, secrets: { accessToken: "old", stale: "x" } }, db);

    expect((await finishOAuthConnectAction("meta", form("act_2"))).ok).toBe(false); // no sign-in in progress
    h.jar.set(PENDING_COOKIE, pendingFor("meta", u.id, ws.id));
    expect(await finishOAuthConnectAction("meta", form())).toMatchObject({ ok: false, message: "Pick at least one ad account." });
    expect(await finishOAuthConnectAction("meta", form("bad id!", "act_2 "))).toMatchObject({ ok: true });

    const conn = await getConnection(ws.id, "meta", db);
    expect(conn?.mode).toBe("live");
    expect(conn?.config).toMatchObject({ adAccountIds: "act_2", apiVersion: "v20.0", connectedVia: "oauth" });
    expect(conn?.secrets).toEqual({ accessToken: "EAAB-new" });
    expect(h.jar.has(PENDING_COOKIE)).toBe(false); // single use
    const audits = await db.select().from(schema.auditLog);
    expect(audits.map((a) => a.action)).toContain("integration.oauth_connected");
    expect(JSON.stringify(audits)).not.toContain("EAAB");
  });

  it("refuses other users' sign-ins, other providers, disabled apps and missing permission", async () => {
    const { db, ws, org } = await setupWorkspace();
    const [u] = await db.insert(schema.users).values({ email: "a@oauth.test", passwordHash: "x" }).returning();
    h.user = { id: u.id, workspaceId: ws.id, orgId: org.id, allowed: true };
    h.jar.set(PENDING_COOKIE, pendingFor("meta", "00000000-0000-0000-0000-000000000000", ws.id));
    expect((await finishOAuthConnectAction("meta", form("act_2"))).ok).toBe(false);
    h.jar.set(PENDING_COOKIE, pendingFor("meta", u.id, ws.id));
    expect((await finishOAuthConnectAction("stripe", form("act_2"))).ok).toBe(false);
    expect((await finishOAuthConnectAction("google_ads", form("123-456-7890"))).ok).toBe(false);
    vi.stubEnv("META_APP_SECRET", "");
    expect((await finishOAuthConnectAction("meta", form("act_2"))).ok).toBe(false);
    vi.stubEnv("META_APP_SECRET", ENV.META_APP_SECRET);
    h.user = { ...h.user, allowed: false };
    expect((await finishOAuthConnectAction("meta", form("act_2"))).ok).toBe(false);
    expect(await getConnection(ws.id, "meta", db)).toBeUndefined();
  });
});
