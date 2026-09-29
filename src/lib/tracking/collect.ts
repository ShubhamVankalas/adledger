import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { redactPii } from "../crypto";
import { schema, type DB } from "../db";
import { matchTouchpoints } from "../matching";
import { linkVisitor, recordLead, syncContactConsent, upsertContact, upsertVisitor } from "./identity";
import { classify, fbcFromClickId, hostOf, parseMarketingParams, platformOf } from "./utm";

const eventSchema = z.object({
  t: z.enum(["page_view", "identify", "lead", "custom"]),
  ts: z.number().int().optional(),
  url: z.string().max(4000).optional(),
  ref: z.string().max(4000).optional().nullable(),
  name: z.string().max(200).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  traits: z
    .object({
      email: z.string().max(320).optional().nullable(),
      phone: z.string().max(40).optional().nullable(),
      name: z.string().max(200).optional().nullable(),
    })
    .optional(),
});

export const collectSchema = z
  .object({
    site: z.string().min(8).max(64),
    vid: z.string().min(8).max(64),
    fbp: z.string().max(200).optional().nullable(),
    fbc: z.string().max(400).optional().nullable(),
    // Ads consent as the pixel knows it, and navigator.globalPrivacyControl. Older pixels send neither.
    consent: z.enum(["granted", "denied", "unknown"]).optional(),
    gpc: z.boolean().optional(),
    events: z.array(eventSchema).max(50),
  })
  // An empty batch is only a consent withdrawal (adledger.consent(false)).
  .refine((p) => p.events.length > 0 || p.consent === "denied", { message: "events required", path: ["events"] });
export type CollectPayload = z.infer<typeof collectSchema>;

const BOT_UA = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget|python-requests|httpclient|axios\/|go-http-client|facebookexternalhit|preview/i;

export function isBot(ua: string | null | undefined) {
  return !ua || BOT_UA.test(ua);
}

export function truncateIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const first = ip.split(",")[0].trim();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(first)) return first.replace(/\.\d+$/, ".0");
  if (first.includes(":")) return first.split(":").slice(0, 3).join(":") + "::";
  return null;
}

/** Is the request origin allowed for this site? Empty domain list = allow all. */
export function originAllowed(domains: string, origin: string | null): boolean {
  const list = domains
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter(Boolean);
  if (list.length === 0) return true;
  const host = hostOf(origin);
  if (!host) return false;
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

export type CollectResult = { ok: true; workspaceId: string; newLeads: number; contactsLinked: number } | { ok: false; status: number; error: string };

const TOUCH_DEDUPE_MS = 30 * 60 * 1000;

export async function processCollect(
  db: DB,
  payload: CollectPayload,
  ctx: { origin: string | null; userAgent: string | null; ip: string | null; now?: Date },
): Promise<CollectResult> {
  const [site] = await db
    .select()
    .from(schema.pixelSites)
    .where(eq(schema.pixelSites.publicKey, payload.site));
  if (!site) return { ok: false, status: 404, error: "unknown site" };
  if (!originAllowed(site.domains, ctx.origin)) return { ok: false, status: 403, error: "origin not allowed" };

  const now = ctx.now ?? new Date();
  const workspaceId = site.workspaceId;
  const done: CollectResult = { ok: true, workspaceId, newLeads: 0, contactsLinked: 0 };

  if (payload.consent === "denied") {
    // Withdrawal: remember the "no" on the visitor and its contact; store nothing else.
    await db.transaction(async (tx) => {
      const [v] = await tx
        .update(schema.visitors)
        .set({ consent: "denied" })
        .where(and(eq(schema.visitors.workspaceId, workspaceId), eq(schema.visitors.anonymousId, payload.vid)))
        .returning({ id: schema.visitors.id });
      if (v) await syncContactConsent(tx, v.id, "denied");
    });
    return done;
  }
  // Strict mode is enforced here too, so an outdated snippet can't track before consent.
  if (site.consentMode === "required" && payload.consent !== "granted") return done;
  const ipTrunc = truncateIp(ctx.ip);
  const ua = ctx.userAgent?.slice(0, 500) ?? null;
  // Clamp client clocks: never in the future, never older than 1 day.
  const at = (ts?: number) =>
    new Date(Math.min(now.getTime(), Math.max(now.getTime() - 86_400_000, ts ?? now.getTime())));

  let newLeads = 0;
  let contactsLinked = 0;
  const touchpointIds: string[] = [];

  await db.transaction(async (tx) => {
    const firstAt = at(Math.min(...payload.events.map((e) => e.ts ?? now.getTime())));
    const visitor = await upsertVisitor(tx, workspaceId, payload.vid, firstAt, { consent: payload.consent, gpc: payload.gpc });

    for (const e of payload.events) {
      const occurredAt = at(e.ts);
      const props = redactPii(e.props ?? {}) as Record<string, unknown>;
      await tx.insert(schema.events).values({
        workspaceId,
        visitorId: visitor.id,
        type: e.t,
        name: e.name ?? null,
        occurredAt,
        url: e.url?.slice(0, 2000) ?? null,
        referrer: e.ref?.slice(0, 2000) ?? null,
        properties: props,
        ipTrunc,
        userAgent: ua,
      });

      if (e.t === "page_view" && e.url) {
        const params = parseMarketingParams(e.url);
        const channel = classify(params, e.ref, hostOf(e.url));
        if (channel) {
          const [dupe] = await tx
            .select({ id: schema.touchpoints.id })
            .from(schema.touchpoints)
            .where(
              and(
                eq(schema.touchpoints.visitorId, visitor.id),
                eq(schema.touchpoints.channel, channel),
                gte(schema.touchpoints.occurredAt, new Date(occurredAt.getTime() - TOUCH_DEDUPE_MS)),
                sql`coalesce(${schema.touchpoints.utmCampaign}, '') = ${params.utmCampaign ?? ""}`,
                sql`coalesce(${schema.touchpoints.utmContent}, '') = ${params.utmContent ?? ""}`,
                sql`coalesce(${schema.touchpoints.clickId}, '') = ${params.clickId ?? ""}`,
              ),
            )
            .limit(1);
          if (!dupe) {
            const fbc =
              payload.fbc ?? (params.clickIdType === "fbclid" && params.clickId ? fbcFromClickId(params.clickId, occurredAt.getTime()) : null);
            const [tp] = await tx
              .insert(schema.touchpoints)
              .values({
                workspaceId,
                visitorId: visitor.id,
                occurredAt,
                ...params,
                fbp: payload.fbp ?? null,
                fbc,
                landingUrl: e.url.slice(0, 2000),
                referrer: e.ref?.slice(0, 2000) ?? null,
                channel,
                platform: platformOf(params),
              })
              .returning({ id: schema.touchpoints.id });
            touchpointIds.push(tp.id);
          }
        }
      }

      if ((e.t === "identify" || e.t === "lead") && e.traits) {
        const contact = await upsertContact(tx, workspaceId, e.traits, occurredAt);
        if (contact) {
          await linkVisitor(tx, visitor.id, contact.id);
          contactsLinked++;
          if (e.t === "lead") {
            await recordLead(tx, {
              workspaceId,
              contactId: contact.id,
              source: "pixel",
              formName: e.name ?? (typeof e.props?.form === "string" ? e.props.form : null),
              occurredAt,
              raw: { url: e.url, props: e.props ?? {} },
              phone: e.traits.phone,
            });
            newLeads++;
          }
        }
      }
    }
    // A "yes" given in the banner also counts for the person this browser belongs to.
    if (payload.consent === "granted") await syncContactConsent(tx, visitor.id, "granted");
  });

  if (touchpointIds.length) await matchTouchpoints(db, workspaceId, touchpointIds);
  return { ok: true, workspaceId, newLeads, contactsLinked };
}
