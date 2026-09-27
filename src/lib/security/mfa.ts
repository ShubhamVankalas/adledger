import { createHmac, timingSafeEqual } from "node:crypto";
import { decrypt, encrypt, randomToken } from "../crypto";
import { getAppSecret } from "../settings";

// Between "password correct" and "code correct" the browser holds a short-lived, signed challenge
// cookie instead of a session. It names the user and expires after 10 minutes; nothing else.

export const MFA_COOKIE = "al_mfa";
export const MFA_TTL_MS = 10 * 60_000;

const sign = (payload: string, secret: string) => createHmac("sha256", `adledger:mfa:${secret}`).update(payload).digest("base64url");

export async function createChallenge(userId: string, now = Date.now()): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: now + MFA_TTL_MS, n: randomToken(8) })).toString("base64url");
  return `${payload}.${sign(payload, await getAppSecret())}`;
}

/** The user id a challenge cookie was issued for, or null when it's missing, forged or expired. */
export async function readChallenge(value: string | undefined, now = Date.now()): Promise<string | null> {
  if (!value || value.length > 400) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, await getAppSecret()));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: unknown; e?: unknown };
    if (typeof data.u !== "string" || typeof data.e !== "number" || data.e < now) return null;
    return data.u;
  } catch {
    return null;
  }
}

// TOTP secrets are stored encrypted with the app secret, like connector credentials.
export const sealSecret = async (secret: string) => encrypt(secret, await getAppSecret());
export const openSecret = async (sealed: string) => decrypt(sealed, await getAppSecret());
