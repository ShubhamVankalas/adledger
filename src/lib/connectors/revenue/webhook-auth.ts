import { createHash, timingSafeEqual } from "node:crypto";

// Shared-secret checks for platforms whose webhooks are not HMAC-signed (Chargebee, Recurly XML,
// Gumroad). Both sides are hashed first so the comparison is constant-time and leaks no length.

function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** `Authorization: Basic base64(username:password)` must match the configured credentials. */
export function verifyBasicAuth(headers: Headers, username: string | undefined, password: string | undefined): boolean {
  if (!username || !password) return false;
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(headers.get("authorization") ?? "");
  if (!m) return false;
  const given = Buffer.from(m[1], "base64").toString("utf8");
  return sameSecret(given, `${username}:${password}`);
}

/** A secret token in the webhook URL's query string (e.g. `?token=…`) must match. */
export function verifyUrlToken(url: string, token: string | undefined, param = "token"): boolean {
  if (!token) return false;
  let given: string | null;
  try {
    given = new URL(url).searchParams.get(param);
  } catch {
    return false;
  }
  return !!given && sameSecret(given, token);
}
