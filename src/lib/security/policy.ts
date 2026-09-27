import { z } from "zod";
import type { OrgSecurity, Role } from "../db/schema";
import { roleCan, type Permission } from "../permissions";

// Organization security policy, stored in organizations.security (jsonb). Parsed with defaults so
// older rows and unknown keys never break sign-in.

export const IDLE_MINUTES = { min: 15, max: 30 * 24 * 60, default: 7 * 24 * 60 };
export const MAX_SESSION_DAYS = { min: 1, max: 90, default: 30 };

const schema = z.object({
  require2fa: z.boolean().catch(false).default(false),
  sessionIdleMinutes: z.number().int().min(IDLE_MINUTES.min).max(IDLE_MINUTES.max).catch(IDLE_MINUTES.default).default(IDLE_MINUTES.default),
  sessionMaxDays: z.number().int().min(MAX_SESSION_DAYS.min).max(MAX_SESSION_DAYS.max).catch(MAX_SESSION_DAYS.default).default(MAX_SESSION_DAYS.default),
  clientsCanDownloadPdf: z.boolean().catch(true).default(true),
});

export type SecurityPolicy = z.output<typeof schema>;

export function parsePolicy(raw: OrgSecurity | null | undefined): SecurityPolicy {
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

/** Role permission, narrowed by the organization's policy (e.g. client PDF downloads). */
export function policyCan(role: Role, permission: Permission, policy: SecurityPolicy): boolean {
  if (!roleCan(role, permission)) return false;
  if (permission === "reports.pdf" && role === "client") return policy.clientsCanDownloadPdf;
  return true;
}

/** Idle timeout choices offered in Settings (minutes). */
export const IDLE_CHOICES = [
  { minutes: 60, label: "1 hour" },
  { minutes: 8 * 60, label: "8 hours" },
  { minutes: 24 * 60, label: "1 day" },
  { minutes: 7 * 24 * 60, label: "7 days" },
  { minutes: 30 * 24 * 60, label: "30 days" },
];

export const MAX_DAYS_CHOICES = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

/** Is a session past its idle timeout or maximum lifetime? */
export function sessionExpired(s: { createdAt: Date; lastSeenAt: Date | null }, policy: SecurityPolicy, now = Date.now()): boolean {
  const lastSeen = (s.lastSeenAt ?? s.createdAt).getTime();
  if (now - lastSeen > policy.sessionIdleMinutes * 60_000) return true;
  return now - s.createdAt.getTime() > policy.sessionMaxDays * 86_400_000;
}
