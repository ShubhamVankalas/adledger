import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SIGNATURE_TOLERANCE_SEC } from "./catalog";

// Outbound webhook signatures (same scheme as Stripe's): the header
//   AdLedger-Signature: t=1727602873,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
// where v1 is the hex HMAC-SHA256 of `${t}.${rawBody}` with the endpoint's signing secret.
// Signing the timestamp lets receivers reject replays older than a few minutes.

/** A new signing secret: `whsec_` + 32 random bytes (base64url). */
export const newWebhookSecret = () => `whsec_${randomBytes(32).toString("base64url")}`;

export function computeSignature(body: string, secret: string, timestamp: number): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** The AdLedger-Signature header value for a body sent at `now`. */
export function signatureHeader(body: string, secret: string, now: Date = new Date()): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${computeSignature(body, secret, t)}`;
}

export type VerifyResult = { ok: true; timestamp: number } | { ok: false; reason: "malformed" | "expired" | "mismatch" };

/**
 * Check a received AdLedger-Signature header against the raw body (exactly as received, before any
 * JSON parsing). Several v1 values are accepted (for secret rotation on the receiving side).
 */
export function verifySignature(body: string, header: string | null | undefined, secret: string, opts: { toleranceSec?: number; now?: Date } = {}): VerifyResult {
  const parts = (header ?? "").split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const sigs = parts.filter(([k, v]) => k === "v1" && /^[0-9a-f]{64}$/.test(v ?? "")).map(([, v]) => v);
  if (!Number.isInteger(t) || sigs.length === 0) return { ok: false, reason: "malformed" };
  const tolerance = opts.toleranceSec ?? SIGNATURE_TOLERANCE_SEC;
  const nowSec = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - t) > tolerance) return { ok: false, reason: "expired" };
  const expected = Buffer.from(computeSignature(body, secret, t), "hex");
  const match = sigs.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  return match ? { ok: true, timestamp: t } : { ok: false, reason: "mismatch" };
}
