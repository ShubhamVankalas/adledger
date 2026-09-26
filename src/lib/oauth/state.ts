import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { decrypt, encrypt } from "../crypto";

// State and PKCE helpers for the OAuth authorization-code flow. No I/O: the route handlers pass
// cookie values in and get cookie values back, which keeps everything here unit-testable.

/** Signed cookie holding the state, PKCE verifier and who started the sign-in (path /api/v1/oauth). */
export const STATE_COOKIE = "al_oauth_state";
/** Encrypted cookie holding the tokens until the user has picked ad accounts (path /). */
export const PENDING_COOKIE = "al_oauth_pending";
export const STATE_TTL_SECONDS = 10 * 60;
export const PENDING_TTL_SECONDS = 15 * 60;

/** What the platform returned at the token exchange. Never logged. */
export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Unix ms when the access token expires (if the platform says). */
  expiresAt?: number;
  /** Accounts the platform granted at sign-in (TikTok returns these with the token). */
  accountIds?: string[];
};

export type OAuthStatePayload = {
  provider: string;
  state: string;
  /** PKCE code verifier (only for platforms that support PKCE). */
  verifier?: string;
  userId: string;
  workspaceId: string;
  /** Exact redirect_uri sent to the authorize endpoint; the token exchange must repeat it. */
  redirectUri: string;
  expiresAt: number;
};

export type OAuthPendingPayload = {
  provider: string;
  userId: string;
  workspaceId: string;
  tokens: OAuthTokens;
  expiresAt: number;
};

const b64url = (buf: Buffer) => buf.toString("base64url");

/** RFC 7636 code verifier: 43 chars from the unreserved set. */
export function createCodeVerifier(): string {
  return b64url(randomBytes(32));
}

/** RFC 7636 S256 challenge: BASE64URL(SHA256(ASCII(verifier))). */
export function codeChallengeS256(verifier: string): string {
  return b64url(createHash("sha256").update(verifier, "ascii").digest());
}

export function createState(): string {
  return b64url(randomBytes(24));
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function sign(data: string, secret: string): string {
  return b64url(createHmac("sha256", `adledger:oauth-state:${secret}`).update(data).digest());
}

/** `payload.signature` (both base64url). Tamper-proof, not secret: it lives in an httpOnly cookie. */
export function signState(payload: OAuthStatePayload, secret: string): string {
  const data = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${data}.${sign(data, secret)}`;
}

/** The payload if the signature is valid and it hasn't expired; otherwise null. */
export function verifyState(value: string | undefined | null, secret: string, now = Date.now()): OAuthStatePayload | null {
  if (!value) return null;
  const [data, sig, extra] = value.split(".");
  if (!data || !sig || extra !== undefined || !safeEqual(sig, sign(data, secret))) return null;
  try {
    const p = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as OAuthStatePayload;
    if (typeof p.expiresAt !== "number" || p.expiresAt < now) return null;
    if (typeof p.state !== "string" || typeof p.provider !== "string" || typeof p.redirectUri !== "string") return null;
    return p;
  } catch {
    return null;
  }
}

const pendingKey = (secret: string) => `oauth-pending:${secret}`;

/** Tokens are encrypted (AES-256-GCM), so the browser only ever holds ciphertext. */
export function sealPending(payload: OAuthPendingPayload, secret: string): string {
  return encrypt(JSON.stringify(payload), pendingKey(secret));
}

export function openPending(
  value: string | undefined | null,
  secret: string,
  expect: { provider: string; userId: string; workspaceId: string },
  now = Date.now(),
): OAuthPendingPayload | null {
  if (!value) return null;
  try {
    const p = JSON.parse(decrypt(value, pendingKey(secret))) as OAuthPendingPayload;
    if (p.expiresAt < now) return null;
    if (p.provider !== expect.provider || p.userId !== expect.userId || p.workspaceId !== expect.workspaceId) return null;
    if (!p.tokens?.accessToken) return null;
    return p;
  } catch {
    return null;
  }
}
