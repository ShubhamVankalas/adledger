import { and, eq } from "drizzle-orm";
import { audit } from "../auth";
import { getDb, schema, type DB } from "../db";
import { log } from "../log";
import { disableTwoFactor } from "./two-factor";

/**
 * Break-glass for an owner locked out of 2FA (lost phone and recovery codes): start AdLedger with
 * ADLEDGER_BREAK_GLASS=<owner email>. On boot, two-factor sign-in is turned off for that account
 * (only if it owns an organization), the reset is written to the audit log and raises a security
 * alert, and a warning reminds the operator to remove the variable. Anyone who can set server
 * environment variables already controls the install, so this adds no new way in.
 */
export async function breakGlassFromEnv(db?: DB): Promise<boolean> {
  const email = process.env.ADLEDGER_BREAK_GLASS?.trim().toLowerCase();
  if (!email) return false;
  const d = db ?? (await getDb());
  const [user] = await d.select({ id: schema.users.id, enabled: schema.users.totpEnabledAt }).from(schema.users).where(eq(schema.users.email, email));
  const owned = user
    ? await d
        .select({ organizationId: schema.memberships.organizationId })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.role, "owner")))
    : [];
  if (!user || owned.length === 0) {
    log.warn("ADLEDGER_BREAK_GLASS: no owner account with that email; nothing changed");
    return false;
  }
  if (!user.enabled) {
    log.warn("ADLEDGER_BREAK_GLASS: two-factor sign-in is already off for that owner. Remove ADLEDGER_BREAK_GLASS now.");
    return false;
  }
  await disableTwoFactor(user.id);
  for (const o of owned) await audit({ id: null, organizationId: o.organizationId, workspaceId: null }, "security.2fa_reset", user.id, { via: "break_glass" });
  log.warn("ADLEDGER_BREAK_GLASS: two-factor sign-in was turned off for the owner account. Sign in, set it up again, and remove ADLEDGER_BREAK_GLASS.");
  return true;
}
