import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Digits only, keeping a leading country code if given (E.164 without '+'). */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "").replace(/^0+/, "");
}

export const hashEmail = (email: string) => sha256(normalizeEmail(email));
export const hashPhone = (phone: string) => sha256(normalizePhone(phone));

export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

// ---- passwords (scrypt, stdlib only)

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    ...SCRYPT,
    N: Number(n),
  });
  return timingSafeEqual(key, expected);
}

// ---- symmetric encryption for stored connector secrets (AES-256-GCM)

function keyFrom(secret: string): Buffer {
  return createHash("sha256").update(`adledger:enc:${secret}`).digest();
}

export function encrypt(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

export function decrypt(payload: string, secret: string): string {
  const [v, ivB64, tagB64, dataB64] = payload.split(".");
  if (v !== "v1") throw new Error("Unknown ciphertext version");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Replace anything that looks like an email/phone in a JSON payload with a hash. */
export function redactPii(value: unknown, key = ""): unknown {
  if (typeof value === "string") {
    const k = key.toLowerCase();
    if (EMAIL_RE.test(value.trim())) return `sha256:${hashEmail(value)}`;
    // Emails embedded in longer strings ("Jane <jane@acme.com>").
    const text = value.replace(/[^\s@<>()[\]\\,;:"']+@[^\s@<>()[\]\\,;:"']+\.[a-z]{2,}/gi, (m) => `sha256:${hashEmail(m)}`);
    if (/(phone|mobile|tel|whatsapp)/.test(k) && /\d{6,}/.test(text.replace(/\D/g, ""))) {
      return `sha256:${hashPhone(text)}`;
    }
    return text;
  }
  if (Array.isArray(value)) return value.map((v) => redactPii(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactPii(v, k)]),
    );
  }
  return value;
}
