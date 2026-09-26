import { GOOGLE_ADS_API_VERSION_DEFAULT, META_API_VERSION_DEFAULT } from "../connectors/ads";
import { LINKEDIN_VERSION_DEFAULT } from "../connectors/ads/linkedin";
import { TIKTOK_API_VERSION } from "../connectors/ads/tiktok";
import type { OAuthTokens } from "./state";

// Per-platform OAuth details: authorize URL, code → token exchange, listing the ad accounts the
// user can see, and mapping the result onto the connector's existing config/secret keys (so
// scheduled syncs work exactly as with pasted tokens).

export type FetchFn = typeof fetch;

/** The install's OAuth app, from env vars (see IntegrationMeta.oauth.env). */
export type OAuthCredentials = {
  clientId: string;
  clientSecret: string;
  /** Extra required env values keyed by env var name (e.g. GOOGLE_ADS_DEVELOPER_TOKEN). */
  extra: Record<string, string>;
};

export type AdAccountOption = {
  id: string;
  name: string;
  currency?: string | null;
  /** Short remark shown next to the account ("Manager account", "Disabled"…). */
  note?: string | null;
};

export type ConnectionValues = { config: Record<string, string>; secrets: Record<string, string> };

export type OAuthProvider = {
  provider: string;
  /** Send a PKCE S256 challenge (only where the platform supports it for web apps). */
  pkce: boolean;
  authorizeUrl(p: { creds: OAuthCredentials; redirectUri: string; state: string; scopes: string[]; codeChallenge?: string }): string;
  exchangeCode(p: { code: string; creds: OAuthCredentials; redirectUri: string; codeVerifier?: string }, fetchFn: FetchFn): Promise<OAuthTokens>;
  listAccounts(tokens: OAuthTokens, creds: OAuthCredentials, fetchFn: FetchFn): Promise<AdAccountOption[]>;
  connection(tokens: OAuthTokens, accountIds: string[], creds: OAuthCredentials): ConnectionValues;
};

/** An error whose message is safe to show to the user (never contains tokens). */
export class OAuthError extends Error {}

/** Keeps platform error text readable and short before it's shown or put in a URL. */
export function cleanMessage(text: unknown, max = 200): string {
  return String(text ?? "")
    .replace(/[^\w\s.,:;'()/@&+#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function readJson<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T;
}

const expiresAt = (seconds: unknown) => (typeof seconds === "number" && seconds > 0 ? Date.now() + seconds * 1000 : undefined);

function connectedConfig(tokens: OAuthTokens): Record<string, string> {
  return { connectedVia: "oauth", tokenExpiresAt: tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : "" };
}

function withQuery(base: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, v);
  return `${base}?${q}`;
}

// ---------------------------------------------------------------- Meta (Facebook Login)

type GraphError = { error?: { message?: string } };
type GraphToken = GraphError & { access_token?: string; expires_in?: number };

const META_GRAPH = `https://graph.facebook.com/${META_API_VERSION_DEFAULT}`;

const meta: OAuthProvider = {
  provider: "meta",
  pkce: false,
  authorizeUrl: ({ creds, redirectUri, state, scopes }) =>
    withQuery(`https://www.facebook.com/${META_API_VERSION_DEFAULT}/dialog/oauth`, {
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      state,
      response_type: "code",
      scope: scopes.join(","),
    }),
  async exchangeCode({ code, creds, redirectUri }, fetchFn) {
    const res = await fetchFn(
      withQuery(`${META_GRAPH}/oauth/access_token`, { client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri, code }),
      { headers: { Accept: "application/json" } },
    );
    const short = await readJson<GraphToken>(res);
    if (!res.ok || !short.access_token) throw new OAuthError(`Meta sign-in failed: ${cleanMessage(short.error?.message) || res.status}`);
    // Swap the 1–2 hour token for a long-lived (~60 day) one; keep the short one if that fails.
    const res2 = await fetchFn(
      withQuery(`${META_GRAPH}/oauth/access_token`, {
        grant_type: "fb_exchange_token",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        fb_exchange_token: short.access_token,
      }),
      { headers: { Accept: "application/json" } },
    );
    const long = await readJson<GraphToken>(res2);
    const t = res2.ok && long.access_token ? long : short;
    return { accessToken: t.access_token!, expiresAt: expiresAt(t.expires_in) };
  },
  async listAccounts(tokens, _creds, fetchFn) {
    type Page = GraphError & {
      data?: { id: string; account_id?: string; name?: string; currency?: string; account_status?: number }[];
      paging?: { next?: string };
    };
    const out: AdAccountOption[] = [];
    let next: string | undefined = withQuery(`${META_GRAPH}/me/adaccounts`, {
      fields: "account_id,name,currency,account_status",
      limit: "200",
      access_token: tokens.accessToken,
    });
    for (let page = 0; next && page < 10; page++) {
      const res = await fetchFn(next, { headers: { Accept: "application/json" } });
      const body: Page = await readJson<Page>(res);
      if (!res.ok || body.error) throw new OAuthError(`Couldn't list Meta ad accounts: ${cleanMessage(body.error?.message) || res.status}`);
      for (const a of body.data ?? []) {
        out.push({
          id: a.id.startsWith("act_") ? a.id : `act_${a.id}`,
          name: a.name || a.id,
          currency: a.currency ?? null,
          note: a.account_status && a.account_status !== 1 ? "Not active" : null,
        });
      }
      next = body.paging?.next;
    }
    return out;
  },
  connection: (tokens, ids) => ({
    config: { adAccountIds: ids.join(", "), ...connectedConfig(tokens) },
    secrets: { accessToken: tokens.accessToken },
  }),
};

// ---------------------------------------------------------------- Google Ads

type GoogleToken = { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
type GoogleApiError = { error?: { message?: string; status?: string } };

export const googleCustomerId = (id: string) => {
  const d = id.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d;
};

const GOOGLE_DEV_TOKEN_ENV = "GOOGLE_ADS_DEVELOPER_TOKEN";

const google: OAuthProvider = {
  provider: "google_ads",
  pkce: true,
  authorizeUrl: ({ creds, redirectUri, state, scopes, codeChallenge }) =>
    withQuery("https://accounts.google.com/o/oauth2/v2/auth", {
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      // offline + consent: Google only returns a refresh token when both are set.
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: codeChallenge ? "S256" : undefined,
    }),
  async exchangeCode({ code, creds, redirectUri, codeVerifier }, fetchFn) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
    });
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    const res = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
    });
    const t = await readJson<GoogleToken>(res);
    if (!res.ok || !t.access_token) throw new OAuthError(`Google sign-in failed: ${cleanMessage(t.error_description ?? t.error) || res.status}`);
    if (!t.refresh_token) {
      throw new OAuthError("Google didn't return a refresh token. Remove AdLedger at myaccount.google.com/permissions and connect again.");
    }
    return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: expiresAt(t.expires_in) };
  },
  async listAccounts(tokens, creds, fetchFn) {
    const base = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION_DEFAULT}`;
    const headers = {
      Authorization: `Bearer ${tokens.accessToken}`,
      "developer-token": creds.extra[GOOGLE_DEV_TOKEN_ENV] ?? "",
      Accept: "application/json",
    };
    const res = await fetchFn(`${base}/customers:listAccessibleCustomers`, { headers });
    const body = await readJson<GoogleApiError & { resourceNames?: string[] }>(res);
    if (!res.ok) throw new OAuthError(`Couldn't list Google Ads accounts: ${cleanMessage(body.error?.message) || res.status}`);
    const ids = (body.resourceNames ?? []).map((r) => r.replace(/^customers\//, "")).filter(Boolean);
    // Names are best-effort: one small query per account (capped); fall back to the ID.
    const detailed = await Promise.all(
      ids.slice(0, 50).map(async (id): Promise<AdAccountOption> => {
        try {
          const r = await fetchFn(`${base}/customers/${id}/googleAds:search`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ query: "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1" }),
          });
          const b = await readJson<{ results?: { customer?: { descriptiveName?: string; currencyCode?: string; manager?: boolean } }[] }>(r);
          const c = r.ok ? b.results?.[0]?.customer : undefined;
          return {
            id: googleCustomerId(id),
            name: c?.descriptiveName || googleCustomerId(id),
            currency: c?.currencyCode ?? null,
            note: c?.manager ? "Manager account (no spend of its own)" : c ? null : "Details unavailable",
          };
        } catch {
          return { id: googleCustomerId(id), name: googleCustomerId(id), note: "Details unavailable" };
        }
      }),
    );
    return [...detailed, ...ids.slice(50).map((id) => ({ id: googleCustomerId(id), name: googleCustomerId(id) }))];
  },
  connection: (tokens, ids, creds) => ({
    // Accounts from listAccessibleCustomers are directly accessible: no manager ID needed.
    config: { customerIds: ids.join(", "), loginCustomerId: "", clientId: creds.clientId, ...connectedConfig(tokens) },
    secrets: {
      refreshToken: tokens.refreshToken ?? "",
      clientSecret: creds.clientSecret,
      developerToken: creds.extra[GOOGLE_DEV_TOKEN_ENV] ?? "",
    },
  }),
};

// ---------------------------------------------------------------- TikTok (Business API)

type TikTokEnvelope<T> = { code?: number; message?: string; data?: T };

/** TikTok IDs are 19-digit numbers (> 2^53): quote bare long integers before JSON.parse. */
async function readTikTok<T>(res: Response): Promise<TikTokEnvelope<T>> {
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"')) as TikTokEnvelope<T>;
  } catch {
    return {};
  }
}
const TIKTOK_BASE = `https://business-api.tiktok.com/open_api/${TIKTOK_API_VERSION}`;

const tiktok: OAuthProvider = {
  provider: "tiktok_ads",
  pkce: false,
  authorizeUrl: ({ creds, redirectUri, state }) =>
    withQuery("https://business-api.tiktok.com/portal/auth", { app_id: creds.clientId, state, redirect_uri: redirectUri }),
  async exchangeCode({ code, creds }, fetchFn) {
    const res = await fetchFn(`${TIKTOK_BASE}/oauth2/access_token/`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ app_id: creds.clientId, secret: creds.clientSecret, auth_code: code }),
    });
    const b = await readTikTok<{ access_token?: string; advertiser_ids?: (string | number)[] }>(res);
    if (!res.ok || b.code !== 0 || !b.data?.access_token) throw new OAuthError(`TikTok sign-in failed: ${cleanMessage(b.message) || res.status}`);
    return { accessToken: b.data.access_token, accountIds: (b.data.advertiser_ids ?? []).map(String) };
  },
  async listAccounts(tokens, creds, fetchFn) {
    const res = await fetchFn(withQuery(`${TIKTOK_BASE}/oauth2/advertiser/get/`, { app_id: creds.clientId, secret: creds.clientSecret }), {
      headers: { "Access-Token": tokens.accessToken, Accept: "application/json" },
    });
    const b = await readTikTok<{ list?: { advertiser_id: string | number; advertiser_name?: string }[] }>(res);
    if (!res.ok || b.code !== 0) throw new OAuthError(`Couldn't list TikTok advertisers: ${cleanMessage(b.message) || res.status}`);
    const list = (b.data?.list ?? []).map((a) => ({ id: String(a.advertiser_id), name: a.advertiser_name || String(a.advertiser_id) }));
    return list.length ? list : (tokens.accountIds ?? []).map((id) => ({ id, name: id }));
  },
  connection: (tokens, ids) => ({
    // apiHost "" = production host (OAuth apps can't authorize sandbox advertisers).
    config: { advertiserIds: ids.join(", "), apiHost: "", ...connectedConfig(tokens) },
    secrets: { accessToken: tokens.accessToken },
  }),
};

// ---------------------------------------------------------------- LinkedIn (Marketing API)

type LinkedInToken = { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string };

const linkedin: OAuthProvider = {
  provider: "linkedin_ads",
  pkce: false,
  authorizeUrl: ({ creds, redirectUri, state, scopes }) =>
    withQuery("https://www.linkedin.com/oauth/v2/authorization", {
      response_type: "code",
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      state,
      scope: scopes.join(" "),
    }),
  async exchangeCode({ code, creds, redirectUri }, fetchFn) {
    const res = await fetchFn("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: creds.clientId, client_secret: creds.clientSecret, redirect_uri: redirectUri }),
    });
    const t = await readJson<LinkedInToken>(res);
    if (!res.ok || !t.access_token) throw new OAuthError(`LinkedIn sign-in failed: ${cleanMessage(t.error_description ?? t.error) || res.status}`);
    return { accessToken: t.access_token, refreshToken: t.refresh_token || undefined, expiresAt: expiresAt(t.expires_in) };
  },
  async listAccounts(tokens, _creds, fetchFn) {
    type Page = { elements?: { id: number | string; name?: string; currency?: string; status?: string; test?: boolean }[]; metadata?: { nextPageToken?: string }; message?: string };
    const out: AdAccountOption[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const url = `https://api.linkedin.com/rest/adAccounts?q=search&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const res = await fetchFn(url, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "LinkedIn-Version": LINKEDIN_VERSION_DEFAULT,
          "X-Restli-Protocol-Version": "2.0.0",
          Accept: "application/json",
        },
      });
      const b = await readJson<Page>(res);
      if (!res.ok) throw new OAuthError(`Couldn't list LinkedIn ad accounts: ${cleanMessage(b.message) || res.status}`);
      for (const a of b.elements ?? []) {
        const note = [a.test ? "Test account" : null, a.status && a.status !== "ACTIVE" ? a.status.toLowerCase() : null].filter(Boolean).join(" · ");
        out.push({ id: String(a.id), name: a.name || String(a.id), currency: a.currency ?? null, note: note || null });
      }
      pageToken = b.metadata?.nextPageToken || undefined;
      if (!pageToken) break;
    }
    return out;
  },
  connection(tokens, ids, creds) {
    const secrets: Record<string, string> = { accessToken: tokens.accessToken };
    // With a refresh token the connector renews access tokens itself (needs the client secret).
    if (tokens.refreshToken) Object.assign(secrets, { refreshToken: tokens.refreshToken, clientSecret: creds.clientSecret });
    return { config: { adAccountIds: ids.join(", "), clientId: creds.clientId, ...connectedConfig(tokens) }, secrets };
  },
};

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = { meta, google_ads: google, tiktok_ads: tiktok, linkedin_ads: linkedin };

export function getOAuthProvider(provider: string): OAuthProvider | undefined {
  return Object.hasOwn(OAUTH_PROVIDERS, provider) ? OAUTH_PROVIDERS[provider] : undefined;
}
