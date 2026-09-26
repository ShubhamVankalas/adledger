import { getSessionUser, type SessionUser } from "./auth";
import type { Permission } from "./permissions";

// Shared helpers for server actions (kept out of "use server" files, which may only export actions).

export type ActionResult = { ok: boolean; message?: string; data?: Record<string, unknown> };

export const ok = (message?: string, data?: Record<string, unknown>): ActionResult => ({ ok: true, message, data });
export const fail = (message: string): ActionResult => ({ ok: false, message });
export const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export class Denied extends Error {}

/** The signed-in user if they hold `permission`; otherwise throws Denied. */
export async function guard(permission?: Permission): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Denied("Your session has expired. Sign in again.");
  if (permission && !user.can(permission)) throw new Denied("You don't have permission to do that. Ask an admin.");
  return user;
}

/** Run an action body, converting permission errors into a friendly failed result. */
export async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Denied) return fail(err.message);
    // Next.js redirect()/notFound() throw special errors that must propagate.
    if (err && typeof err === "object" && "digest" in err) throw err;
    return fail(err instanceof Error ? err.message : "Something went wrong");
  }
}
