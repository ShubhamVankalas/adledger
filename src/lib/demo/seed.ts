import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { recomputeAttribution } from "../attribution";
import { hashEmail, hashPhone, randomToken } from "../crypto";
import { schema, type DB } from "../db";
import { matchTouchpoints } from "../matching";
import { ADS_CONNECTORS } from "../connectors/registry";
import { saveConnection } from "../settings";
import { syncProvider } from "../sync";
import { classify, hostOf, parseMarketingParams, platformOf } from "../tracking/utm";
import { buildDemoWorld, DAY, demoAds, isoDate, parseDate } from "./world";

const DEMO_SITE_NAME = "Demo website";
const DEMO_WEBHOOK_NAME = "Typeform – Demo requests";

async function insertChunked<T extends Record<string, unknown>>(
  db: DB,
  table: Parameters<DB["insert"]>[0],
  values: T[],
  size = 1000,
) {
  for (let i = 0; i < values.length; i += size) {
    await db.insert(table).values(values.slice(i, i + size) as never);
  }
}

/**
 * Load a realistic 90-day demo (ads, visitors, leads, Stripe revenue) into a workspace.
 * Everything flows through the same connectors (mock mode), matching and attribution
 * code as real data.
 */
export async function seedDemo(db: DB, workspaceId: string, opts: { anchor?: string } = {}) {
  const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  if (!ws) throw new Error("workspace not found");
  const anchor = opts.anchor ?? isoDate(new Date(Date.now() - DAY));
  const world = buildDemoWorld(anchor, ws.reportingCurrency);

  // Tracking setup a real user would create in Settings.
  await db.insert(schema.pixelSites).values({ workspaceId, name: DEMO_SITE_NAME, domains: "", publicKey: `pk_${randomToken(12)}` });
  await db.insert(schema.leadWebhooks).values({ workspaceId, name: DEMO_WEBHOOK_NAME, token: `lw_${randomToken(18)}`, fieldMapping: {} });

  // Visitors, page views and touchpoints.
  const visitorId = new Map<string, string>();
  const visitorRows: (typeof schema.visitors.$inferInsert)[] = [];
  const eventRows: (typeof schema.events.$inferInsert)[] = [];
  const touchRows: (typeof schema.touchpoints.$inferInsert)[] = [];
  const siteHost = hostOf(world.siteUrl);
  for (const v of world.visitors) {
    if (v.pageViews.length === 0) continue;
    const id = randomUUID();
    visitorId.set(v.vid, id);
    const times = v.pageViews.map((p) => p.at.getTime());
    visitorRows.push({ id, workspaceId, anonymousId: v.vid, firstSeenAt: new Date(Math.min(...times)), lastSeenAt: new Date(Math.max(...times)) });
    for (const pv of v.pageViews) {
      eventRows.push({ workspaceId, visitorId: id, type: "page_view", occurredAt: pv.at, url: pv.url, referrer: pv.referrer, properties: {}, userAgent: "Mozilla/5.0 (demo)" });
    }
    for (const t of v.touches) {
      const params = parseMarketingParams(t.url);
      const channel = classify(params, t.referrer, siteHost);
      if (!channel) continue;
      touchRows.push({ workspaceId, visitorId: id, occurredAt: t.at, ...params, landingUrl: t.url, referrer: t.referrer, channel, platform: platformOf(params) });
    }
  }
  await insertChunked(db, schema.visitors, visitorRows);
  await insertChunked(db, schema.events, eventRows, 1500);
  await insertChunked(db, schema.touchpoints, touchRows);

  // Contacts + leads (+ identify events for pixel leads).
  const contactRows: (typeof schema.contacts.$inferInsert)[] = [];
  const leadRows: (typeof schema.leads.$inferInsert)[] = [];
  const links: { visitorId: string; contactId: string }[] = [];
  const idEvents: (typeof schema.events.$inferInsert)[] = [];
  for (const c of world.contacts) {
    const id = randomUUID();
    contactRows.push({
      id,
      workspaceId,
      email: c.email,
      emailHash: hashEmail(c.email),
      phoneHash: c.phone ? hashPhone(c.phone) : null,
      name: c.name,
      firstSeenAt: c.leadAt,
    });
    leadRows.push({
      workspaceId,
      contactId: id,
      source: c.leadVia,
      formName: c.formName,
      occurredAt: c.leadAt,
      raw: { form: c.formName, email: `sha256:${hashEmail(c.email)}` },
    });
    for (const vid of c.visitorIds) {
      const v = visitorId.get(vid);
      if (!v) continue;
      links.push({ visitorId: v, contactId: id });
      if (c.leadVia === "pixel" && vid === c.visitorIds[0]) {
        idEvents.push({ workspaceId, visitorId: v, type: "lead", name: c.formName, occurredAt: c.leadAt, url: `${world.siteUrl}/signup`, properties: { form: c.formName } });
      }
    }
  }
  await insertChunked(db, schema.contacts, contactRows);
  await insertChunked(db, schema.leads, leadRows);
  await insertChunked(db, schema.events, idEvents);
  // Link visitors to contacts (grouped per contact to keep statements small).
  const byContact = new Map<string, string[]>();
  for (const l of links) byContact.set(l.contactId, [...(byContact.get(l.contactId) ?? []), l.visitorId]);
  for (const [contactId, vids] of byContact) {
    await db.update(schema.visitors).set({ contactId }).where(inArray(schema.visitors.id, vids));
  }

  // Connectors in mock mode: every ad platform with demo campaigns, revenue from "Stripe".
  const since = isoDate(new Date(parseDate(anchor).getTime() - 89 * DAY));
  const demoPlatforms = new Set(demoAds().map((a) => a.platform));
  const adProviders = ADS_CONNECTORS.filter((c) => demoPlatforms.has(c.platform)).map((c) => c.meta.provider);
  for (const provider of [...adProviders, "stripe"]) {
    await saveConnection(workspaceId, provider, { mode: "mock", config: { demoAnchor: anchor } }, db);
  }
  for (const provider of adProviders) await syncProvider(db, workspaceId, provider, { window: { since, until: anchor } });
  await syncProvider(db, workspaceId, "stripe", { backfillDays: 120 });
  await matchTouchpoints(db, workspaceId);
  await recomputeAttribution(db, workspaceId);
  await db.update(schema.workspaces).set({ isDemo: true }).where(eq(schema.workspaces.id, workspaceId));

  return {
    anchor,
    visitors: visitorRows.length,
    events: eventRows.length + idEvents.length,
    touchpoints: touchRows.length,
    contacts: contactRows.length,
    payments: world.payments.length,
  };
}

/** Remove all tracked/synced data (keeps the workspace, users and API keys). */
export async function clearWorkspaceData(db: DB, workspaceId: string) {
  await db.transaction(async (tx) => {
    for (const t of [
      schema.attributionCredits,
      schema.aiReports,
      schema.revenueEvents,
      schema.leads,
      schema.touchpoints,
      schema.events,
      schema.visitors,
      schema.contacts,
      schema.adInsightsDaily,
      schema.ads,
      schema.adGroups,
      schema.campaigns,
      schema.adAccounts,
      schema.syncRuns,
    ]) {
      await tx.delete(t).where(eq(t.workspaceId, workspaceId));
    }
    // Keep the user's own pixel sites/webhooks and AI settings; drop demo ones and ad/Stripe connections.
    await tx.delete(schema.pixelSites).where(and(eq(schema.pixelSites.workspaceId, workspaceId), eq(schema.pixelSites.name, DEMO_SITE_NAME)));
    await tx.delete(schema.leadWebhooks).where(and(eq(schema.leadWebhooks.workspaceId, workspaceId), eq(schema.leadWebhooks.name, DEMO_WEBHOOK_NAME)));
    await tx.delete(schema.connections).where(and(eq(schema.connections.workspaceId, workspaceId), ne(schema.connections.provider, "llm")));
    await tx.update(schema.workspaces).set({ isDemo: false }).where(eq(schema.workspaces.id, workspaceId));
  });
}
