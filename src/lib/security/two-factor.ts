import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../db";
import { openSecret, sealSecret } from "./mfa";
import { qrPath } from "./qr";
import { generateRecoveryCodes } from "./recovery";
import { formatSecret, generateTotpSecret, otpauthUri, verifyTotp } from "./totp";

// Two-factor enrolment and removal. Enrolment is two steps: a new secret is stored (encrypted)
// without totp_enabled_at, and only a correct code from the app turns it on. Recovery codes are
// generated at that moment and returned once.

export type Enrollment = { secret: string; uri: string; qr: { size: number; path: string } };

/** Start (or restart) enrolment: a fresh secret replaces any unconfirmed one. */
export async function beginEnrollment(userId: string, account: string): Promise<Enrollment | null> {
  const db = await getDb();
  const secret = generateTotpSecret();
  const [row] = await db
    .update(schema.users)
    .set({ totpSecretEnc: await sealSecret(secret), totpLastStep: null })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.totpEnabledAt)))
    .returning({ id: schema.users.id });
  if (!row) return null; // already on
  const uri = otpauthUri(secret, account);
  return { secret: formatSecret(secret), uri, qr: qrPath(uri) };
}

/** Confirm enrolment with a code from the app. Returns the recovery codes (shown once), or null. */
export async function confirmEnrollment(userId: string, code: string): Promise<{ codes: string[] } | null> {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u?.totpSecretEnc || u.totpEnabledAt) return null;
  const step = verifyTotp(await openSecret(u.totpSecretEnc), code);
  if (step === null) return null;
  const { codes, hashes } = await generateRecoveryCodes();
  const [row] = await db
    .update(schema.users)
    .set({ totpEnabledAt: new Date(), totpLastStep: step, recoveryCodes: hashes })
    .where(and(eq(schema.users.id, userId), isNull(schema.users.totpEnabledAt)))
    .returning({ id: schema.users.id });
  return row ? { codes } : null;
}

/** Turn 2FA off and forget the secret and recovery codes. */
export async function disableTwoFactor(userId: string) {
  const db = await getDb();
  await db.update(schema.users).set({ totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodes: [] }).where(eq(schema.users.id, userId));
}

/** Replace the recovery codes (the old ones stop working). */
export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const db = await getDb();
  const { codes, hashes } = await generateRecoveryCodes();
  await db.update(schema.users).set({ recoveryCodes: hashes }).where(eq(schema.users.id, userId));
  return codes;
}

export async function twoFactorStatus(userId: string): Promise<{ enabled: boolean; enabledAt: Date | null; recoveryLeft: number }> {
  const db = await getDb();
  const [u] = await db.select({ at: schema.users.totpEnabledAt, codes: schema.users.recoveryCodes }).from(schema.users).where(eq(schema.users.id, userId));
  return { enabled: Boolean(u?.at), enabledAt: u?.at ?? null, recoveryLeft: u?.at ? u.codes.length : 0 };
}
