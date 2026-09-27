import { and, desc, eq, sql } from "drizzle-orm";
import { AD_PLATFORMS } from "./connectors/types";
import { randomToken, sha256 } from "./crypto";
import { getDb, schema, type DB } from "./db";
import type { AttributionModel, ShareFilters, ShareRange } from "./db/schema";
import { dateRange, MODEL_LABELS, platformLabel } from "./format";
import { resolvePeriodParams } from "./period";
import { compare, performance, platforms, timeseries, type ReportParams } from "./reports";

// Share links: a read-only, aggregate-only view of the Overview for someone without an account
// (an agency client, an investor). The link's filters are locked when it is created; nothing in
// the URL can widen them. Contacts and anything person-level are never part of a shared view.
//
// Tokens are 256-bit and shown once; the database keeps only their SHA-256, like sessions.

export type ShareLink = typeof schema.shareLinks.$inferSelect;

export const SHARE_RANGES: { value: ShareRange; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];
export const SHARE_EXPIRY_DAYS = [7, 30, 90] as const;
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;
const MODELS: AttributionModel[] = ["linear", "first_touch", "last_touch"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Validate and normalise filters coming from the create form. Throws on anything unexpected. */
export function normalizeShareFilters(input: { range?: string; start?: string; end?: string; model?: string; platform?: string }): ShareFilters {
  const model = (MODELS as string[]).includes(input.model ?? "") ? (input.model as AttributionModel) : "linear";
  const platform = input.platform && (AD_PLATFORMS as readonly string[]).includes(input.platform) ? (input.platform as ShareFilters["platform"]) : undefined;
  if (input.platform && !platform) throw new Error("Unknown platform.");
  if (input.start || input.end) {
    if (!DATE.test(input.start ?? "") || !DATE.test(input.end ?? "") || input.start! > input.end!) throw new Error("Choose a start date on or before the end date.");
    const days = (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / DAY_MS + 1;
    if (days > 400) throw new Error("A shared period can cover at most 400 days.");
    return { start: input.start, end: input.end, model, ...(platform ? { platform } : {}) };
  }
  const range = SHARE_RANGES.some((r) => r.value === input.range) ? (input.range as ShareRange) : "30d";
  return { range, model, ...(platform ? { platform } : {}) };
}

/** "Last 30 days · Linear · Meta only" */
export function describeShareFilters(f: ShareFilters) {
  const period = f.start && f.end ? dateRange(f.start, f.end, { year: true }) : (SHARE_RANGES.find((r) => r.value === f.range)?.label ?? "Last 30 days");
  return [period, `${MODEL_LABELS[f.model] ?? f.model} attribution`, ...(f.platform ? [`${platformLabel(f.platform)} only`] : [])].join(" · ");
}

export type ShareStatus = "active" | "expired" | "revoked";
export function shareStatus(link: Pick<ShareLink, "expiresAt" | "revokedAt">, now = new Date()): ShareStatus {
  if (link.revokedAt) return "revoked";
  return link.expiresAt.getTime() <= now.getTime() ? "expired" : "active";
}

export async function createShareLink(
  db: DB,
  input: { workspaceId: string; userId: string | null; label: string; filters: ShareFilters; expiresInDays: number },
  now = new Date(),
) {
  const token = randomToken(32);
  const days = Math.min(365, Math.max(1, Math.round(input.expiresInDays)));
  const [row] = await db
    .insert(schema.shareLinks)
    .values({
      workspaceId: input.workspaceId,
      tokenHash: sha256(token),
      label: input.label.trim().slice(0, 120) || "Shared report",
      filters: input.filters,
      expiresAt: new Date(now.getTime() + days * DAY_MS),
      createdBy: input.userId,
    })
    .returning();
  return { token, link: row };
}

export async function revokeShareLink(db: DB, workspaceId: string, id: string, now = new Date()) {
  const [row] = await db
    .update(schema.shareLinks)
    .set({ revokedAt: now })
    .where(and(eq(schema.shareLinks.workspaceId, workspaceId), eq(schema.shareLinks.id, id)))
    .returning();
  return row ?? null;
}

export async function listShareLinks(db: DB, workspaceId: string) {
  return db
    .select({ link: schema.shareLinks, createdByName: schema.users.name, createdByEmail: schema.users.email })
    .from(schema.shareLinks)
    .leftJoin(schema.users, eq(schema.users.id, schema.shareLinks.createdBy))
    .where(eq(schema.shareLinks.workspaceId, workspaceId))
    .orderBy(desc(schema.shareLinks.createdAt));
}

/** The active link for a token, with its workspace and organization; null when unknown, expired or revoked. */
export async function findActiveShare(db: DB, token: string, now = new Date()) {
  // Tokens are base64url of 32 bytes; reject anything else before touching the database.
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const [row] = await db
    .select({ link: schema.shareLinks, workspace: schema.workspaces, organizationName: schema.organizations.name })
    .from(schema.shareLinks)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.shareLinks.workspaceId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.workspaces.organizationId))
    .where(eq(schema.shareLinks.tokenHash, sha256(token)));
  if (!row || shareStatus(row.link, now) !== "active") return null;
  return row;
}

/** URL parameters a viewer might add to try to change the view. They are always ignored. */
const FILTER_PARAMS = ["from", "to", "range", "model", "platform", "start", "end", "level", "campaign"];

/**
 * Everything the public share page shows, computed from the link's locked filters only.
 * `requested` (the page's search params) never changes the result; the names of any filter
 * parameters it contained are returned so the page can say the filters are locked.
 */
export async function loadSharedReport(token: string, requested: Record<string, string | string[] | undefined> = {}, opts: { db?: DB; now?: Date } = {}) {
  const db = opts.db ?? (await getDb());
  const found = await findActiveShare(db, token, opts.now);
  if (!found) return null;
  const { link, workspace: ws, organizationName } = found;
  const f = link.filters;
  const params: ReportParams =
    f.start && f.end
      ? { start: f.start, end: f.end, model: f.model, platform: f.platform }
      : await resolvePeriodParams(db, ws, { range: f.range ?? "30d", model: f.model, platform: f.platform }).then(({ start, end }) => ({
          start,
          end,
          model: f.model,
          platform: f.platform,
        }));

  const [cmp, series, campaigns, byPlatform] = await Promise.all([
    compare(db, ws, params),
    timeseries(db, ws, params),
    performance(db, ws, { ...params, level: "campaign" }),
    f.platform ? Promise.resolve([]) : platforms(db, ws, params),
  ]);
  return {
    link: { id: link.id, label: link.label, expiresAt: link.expiresAt, filters: f },
    workspace: { id: ws.id, name: ws.name, currency: ws.reportingCurrency, timezone: ws.timezone, organizationId: ws.organizationId },
    organizationName,
    params,
    current: cmp.current,
    previous: cmp.previous,
    series,
    // Aggregates only: campaign names and totals, never people.
    campaigns: campaigns.filter((c) => !params.platform || c.platform === params.platform).slice(0, 10),
    platforms: byPlatform,
    ignoredParams: Object.keys(requested).filter((k) => FILTER_PARAMS.includes(k)),
  };
}

export type SharedReport = NonNullable<Awaited<ReturnType<typeof loadSharedReport>>>;

/** Count a view (the page also writes an audit entry with the truncated IP). */
export async function recordShareView(db: DB, linkId: string, now = new Date()) {
  await db
    .update(schema.shareLinks)
    .set({ viewCount: sql`${schema.shareLinks.viewCount} + 1`, lastViewedAt: now })
    .where(eq(schema.shareLinks.id, linkId));
}
