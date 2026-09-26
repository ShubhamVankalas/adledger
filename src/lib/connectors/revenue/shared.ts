import { createHmac, timingSafeEqual } from "node:crypto";
import { safeFetch } from "../../net";

// Small helpers shared by the webhook-based revenue connectors in this folder.

/** Constant-time comparison; a length mismatch is a plain `false` (timingSafeEqual would throw). */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function hmacSha256(secret: string, data: string): Buffer {
  return createHmac("sha256", secret).update(data, "utf8").digest();
}

/** Check `signature` (base64 or hex HMAC-SHA256 of the raw body) against `secret`. */
export function verifyHmac(rawBody: string, secret: string | undefined, signature: string | null, encoding: "base64" | "hex"): boolean {
  if (!secret || !signature) return false;
  const sig = signature.trim();
  if (encoding === "hex" && !/^[0-9a-f]+$/i.test(sig)) return false;
  if (encoding === "base64" && !/^[A-Za-z0-9+/]+={0,2}$/.test(sig)) return false;
  return safeEqual(hmacSha256(secret, rawBody), Buffer.from(sig, encoding));
}

export type Json = Record<string, unknown>;

export function obj(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Non-empty string (numbers are stringified, e.g. numeric order ids). */
export function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "bigint") return v.toString();
  return null;
}

/** Parse a timestamp (ISO string, or unix seconds when `unixSeconds`), falling back to now. */
export function toDate(v: unknown, opts: { unixSeconds?: boolean; assumeUtc?: boolean } = {}): Date {
  if (opts.unixSeconds && typeof v === "number") return new Date(v * 1000);
  const s = str(v);
  if (s) {
    // WooCommerce's *_gmt fields have no zone designator; they are UTC.
    const iso = opts.assumeUtc && /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s) ? `${s}Z` : s;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Positive integer minor units from an integer or integer string (Razorpay, Paddle, Lemon Squeezy). */
export function intMinor(v: unknown): number | null {
  const s = str(v);
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export async function fetchJson<T = unknown>(url: string, init: RequestInit, what: string): Promise<{ body: T; res: Response }> {
  // Store URLs (e.g. WooCommerce) are user-supplied: block private/metadata addresses.
  const res = await safeFetch(url, { ...init, headers: { Accept: "application/json", ...(init.headers as Record<string, string>) } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${what} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return { body: (await res.json()) as T, res };
}
