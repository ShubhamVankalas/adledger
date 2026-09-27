import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Time-based one-time passwords (RFC 6238, on top of HOTP from RFC 4226), standard library only.
// Authenticator apps (1Password, Google Authenticator, Authy, Bitwarden…) use SHA-1, 6 digits and
// 30-second steps; we accept one step either side for clock drift and never accept a step twice.

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32 character");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 encoded (what authenticator apps expect). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export type TotpAlgorithm = "sha1" | "sha256" | "sha512";

/** HOTP (RFC 4226 §5.3): HMAC over the 8-byte big-endian counter, dynamically truncated. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS, algorithm: TotpAlgorithm = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** The 30-second step number for a moment in time. */
export const totpStep = (at: Date | number = Date.now()) => Math.floor((typeof at === "number" ? at : at.getTime()) / 1000 / TOTP_STEP_SECONDS);

export function totp(secretBase32: string, at: Date | number = Date.now(), opts: { digits?: number; algorithm?: TotpAlgorithm } = {}): string {
  return hotp(base32Decode(secretBase32), totpStep(at), opts.digits, opts.algorithm);
}

/** Keep digits only: people paste "123 456" or "123-456". */
export const normalizeCode = (code: string) => code.replace(/\D/g, "");

/**
 * Check a code against the current step ± `window`. Returns the matching step so the caller can
 * store it, or null. Steps at or before `lastStep` are refused, so a code can't be replayed.
 */
export function verifyTotp(secretBase32: string, code: string, opts: { at?: Date | number; window?: number; lastStep?: number | null } = {}): number | null {
  const digits = normalizeCode(code);
  if (digits.length !== TOTP_DIGITS) return null;
  const secret = base32Decode(secretBase32);
  const now = totpStep(opts.at ?? Date.now());
  const window = opts.window ?? 1;
  let match: number | null = null;
  // Check every candidate (constant work) instead of returning at the first hit.
  for (let step = now - window; step <= now + window; step++) {
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(digits)) && match === null) match = step;
  }
  return match;
}

/** otpauth:// URI for the QR code (Key Uri Format). */
export function otpauthUri(secretBase32: string, account: string, issuer = "AdLedger"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params}`;
}

/** Secret shown for manual entry, in groups of four. */
export const formatSecret = (secretBase32: string) => secretBase32.replace(/(.{4})/g, "$1 ").trim();
