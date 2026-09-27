import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Recovery codes: ten single-use codes shown once when 2FA is turned on. Stored as scrypt hashes
// (lighter parameters than passwords: each code already carries 50 random bits).

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) => Promise<Buffer>;
const PARAMS = { N: 2 ** 14, r: 8, p: 1 };
export const RECOVERY_CODE_COUNT = 10;
// No 0/o, 1/l/i: codes get read off paper.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** One code: "xxxxx-xxxxx". */
function newCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Does the input look like a recovery code rather than a 6-digit TOTP code? */
export const looksLikeRecoveryCode = (input: string) => normalizeRecoveryCode(input).length === 10 && /[a-z]/.test(normalizeRecoveryCode(input));

async function hashCode(code: string): Promise<string> {
  const salt = randomBytes(12);
  const key = await scrypt(normalizeRecoveryCode(code), salt, 24, PARAMS);
  return `rc1$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function matches(code: string, stored: string): Promise<boolean> {
  const [v, saltB64, keyB64] = stored.split("$");
  if (v !== "rc1" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(normalizeRecoveryCode(code), Buffer.from(saltB64, "base64"), expected.length, PARAMS);
  return timingSafeEqual(key, expected);
}

/** Fresh codes to show the user once, plus the hashes to store. */
export async function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = Array.from({ length: count }, newCode);
  return { codes, hashes: await Promise.all(codes.map(hashCode)) };
}

/**
 * Check a recovery code against the stored hashes. Returns the hashes that remain (the used one
 * removed) on success, or null. Every hash is checked so timing doesn't reveal which one matched.
 */
export async function consumeRecoveryCode(code: string, hashes: string[]): Promise<string[] | null> {
  if (normalizeRecoveryCode(code).length !== 10) return null;
  const results = await Promise.all(hashes.map((h) => matches(code, h)));
  const i = results.indexOf(true);
  return i < 0 ? null : hashes.filter((_, j) => j !== i);
}
