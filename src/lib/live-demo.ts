import { randomInt } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { hashEmail, randomToken } from "./crypto";
import { rows, schema, type DB } from "./db";
import type { Channel, Platform } from "./db/schema";
import type { Workspace } from "./settings";

// Demo workspaces only: while someone watches Live, a gentle trickle of activity (visits from the
// demo's own campaigns, the odd lead, a rare sale) is written as real rows, so the Live page moves
// and every number on it still comes from SQL. It never runs for a real workspace, stops when the
// last Live tab closes, and "Use real data" (clearWorkspaceData) removes these rows with the rest.

/** Average gap between simulated moments. */
const TICK_MS = { min: 2_500, max: 7_000 };
const TEMPLATE_TTL_MS = 10 * 60_000;
const FIRST = ["Aarav", "Maya", "Liam", "Sofia", "Noah", "Priya", "Ethan", "Zara", "Lucas", "Ananya", "Oliver", "Isla", "Arjun", "Emma", "Kabir", "Mia", "Leo", "Diya", "Mateo", "Chloe"];
const LAST = ["Sharma", "Patel", "Smith", "Garcia", "Chen", "Khan", "Rossi", "Kim", "Singh", "Brown", "Silva", "Nguyen", "Iyer", "Cohen", "Okafor", "Reddy", "Dubois", "Tanaka"];
const PAGES = ["/pricing", "/features", "/docs", "/signup", "/about", "/blog/attribution-101", "/customers"];
const FORMS = ["Start free trial", "Book a demo", "Newsletter"];

type Template = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  click_id_type: string | null;
  channel: Channel;
  platform: Platform | null;
  campaign_id: string | null;
  ad_group_id: string | null;
  ad_id: string | null;
  landing_url: string | null;
  referrer: string | null;
};

type State = {
  templates: Template[];
  prices: number[];
  site: string;
  loadedAt: number;
  nextAt: number;
  /** Visitors this simulator created recently (for second page views and leads). */
  visitors: { id: string; contactId: string | null; at: number }[];
  /** Leads it created (the likeliest buyers). */
  leads: string[];
};

const g = globalThis as unknown as { __adledgerLiveDemo?: Map<string, State> };
const states: Map<string, State> = (g.__adledgerLiveDemo ??= new Map<string, State>());

const pick = <T>(xs: readonly T[]): T => xs[randomInt(xs.length)];
const chance = (p: number) => randomInt(1_000_000) < p * 1_000_000;

async function load(db: DB, ws: Workspace, prev?: State): Promise<State> {
  const templates = rows<Template>(
    await db.execute(sql`
      select utm_source, utm_medium, utm_campaign, utm_content, utm_term, click_id_type, channel, platform,
        campaign_id, ad_group_id, ad_id, landing_url, referrer
      from touchpoints where workspace_id = ${ws.id}
      order by occurred_at desc limit 400`),
  );
  const prices = rows<{ amount_minor: string | number }>(
    await db.execute(sql`
      select amount_minor from revenue_events
      where workspace_id = ${ws.id} and type = 'payment' and currency = ${ws.reportingCurrency}
      order by occurred_at desc limit 200`),
  ).map((r) => Number(r.amount_minor));
  const [page] = rows<{ url: string | null }>(
    await db.execute(sql`select url from events where workspace_id = ${ws.id} and type = 'page_view' and url like 'http%' order by occurred_at desc limit 1`),
  );
  let site = "https://demo.adledger.dev";
  try {
    if (page?.url) site = new URL(page.url).origin;
  } catch {
    /* keep the default */
  }
  return { templates, prices, site, loadedAt: Date.now(), nextAt: prev?.nextAt ?? 0, visitors: prev?.visitors ?? [], leads: prev?.leads ?? [] };
}

/** Forget a workspace (the last Live tab closed). */
export function stopDemoActivity(workspaceId: string) {
  states.delete(workspaceId);
}

/**
 * Called on every live poll. Writes at most one simulated moment when it is due and returns true
 * when it wrote something. No-op (false) for real workspaces. `force` skips the pacing (tests).
 */
export async function simulateDemoActivity(db: DB, ws: Workspace, now = new Date(), opts: { force?: boolean } = {}): Promise<boolean> {
  if (!ws.isDemo) return false;
  let st = states.get(ws.id);
  if (!st || Date.now() - st.loadedAt > TEMPLATE_TTL_MS) {
    st = await load(db, ws, st);
    states.set(ws.id, st);
  }
  if (!opts.force && Date.now() < st.nextAt) return false;
  st.nextAt = Date.now() + TICK_MS.min + randomInt(TICK_MS.max - TICK_MS.min);
  st.visitors = st.visitors.filter((v) => Date.now() - v.at < 30 * 60_000).slice(-40);

  const roll = randomInt(1000) / 1000;
  if (roll < 0.62) return visit(db, ws, st, now);
  if (roll < 0.82 && st.visitors.length) return pageView(db, ws, st, now);
  if (roll < 0.93) return lead(db, ws, st, now);
  return sale(db, ws, st, now);
}

async function visit(db: DB, ws: Workspace, st: State, now: Date) {
  // Mostly paid traffic from the demo's own campaigns, some organic and direct visits.
  const t = st.templates.length && chance(0.8) ? pick(st.templates) : null;
  const landing = t?.landing_url ?? `${st.site}${pick(["/", "/", "/pricing", "/blog/attribution-101"])}`;
  const [v] = await db
    .insert(schema.visitors)
    .values({ workspaceId: ws.id, anonymousId: `live-${randomToken(9)}`, firstSeenAt: now, lastSeenAt: now })
    .returning({ id: schema.visitors.id });
  await db.insert(schema.events).values({ workspaceId: ws.id, visitorId: v.id, type: "page_view", occurredAt: now, url: landing, referrer: t?.referrer ?? null, properties: {}, userAgent: "Mozilla/5.0 (demo)" });
  if (t) {
    await db.insert(schema.touchpoints).values({
      workspaceId: ws.id,
      visitorId: v.id,
      occurredAt: now,
      utmSource: t.utm_source,
      utmMedium: t.utm_medium,
      utmCampaign: t.utm_campaign,
      utmContent: t.utm_content,
      utmTerm: t.utm_term,
      clickIdType: t.click_id_type,
      clickId: t.click_id_type ? `demo.${randomToken(12)}` : null,
      landingUrl: landing,
      referrer: t.referrer,
      channel: t.channel,
      platform: t.platform,
      campaignId: t.campaign_id,
      adGroupId: t.ad_group_id,
      adId: t.ad_id,
    });
  }
  st.visitors.push({ id: v.id, contactId: null, at: now.getTime() });
  return true;
}

async function pageView(db: DB, ws: Workspace, st: State, now: Date) {
  const v = pick(st.visitors);
  await db.insert(schema.events).values({ workspaceId: ws.id, visitorId: v.id, type: "page_view", occurredAt: now, url: `${st.site}${pick(PAGES)}`, properties: {}, userAgent: "Mozilla/5.0 (demo)" });
  await db.update(schema.visitors).set({ lastSeenAt: now }).where(eq(schema.visitors.id, v.id));
  return true;
}

async function lead(db: DB, ws: Workspace, st: State, now: Date) {
  const v = st.visitors.filter((x) => !x.contactId).at(-1 - randomInt(Math.min(5, Math.max(1, st.visitors.length))));
  if (!v) return visit(db, ws, st, now);
  const first = pick(FIRST);
  const last = pick(LAST);
  const email = `${first}.${last}.${randomToken(3)}@example.com`.toLowerCase();
  const form = pick(FORMS);
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: ws.id, email, emailHash: hashEmail(email), name: `${first} ${last}`, firstSeenAt: now })
    .onConflictDoNothing()
    .returning({ id: schema.contacts.id });
  if (!c) return false;
  await db.update(schema.visitors).set({ contactId: c.id, lastSeenAt: now }).where(eq(schema.visitors.id, v.id));
  await db.insert(schema.events).values({ workspaceId: ws.id, visitorId: v.id, type: "lead", name: form, occurredAt: now, url: `${st.site}/signup`, properties: { form } });
  await db.insert(schema.leads).values({ workspaceId: ws.id, contactId: c.id, source: "pixel", formName: form, occurredAt: now, raw: { form, email: `sha256:${hashEmail(email)}` } });
  v.contactId = c.id;
  st.leads = [...st.leads, c.id].slice(-20);
  return true;
}

async function sale(db: DB, ws: Workspace, st: State, now: Date) {
  let contactId = st.leads.length ? pick(st.leads) : null;
  if (!contactId) {
    const [c] = rows<{ id: string }>(
      await db.execute(sql`select id from contacts where workspace_id = ${ws.id} and lifecycle = 'lead' order by random() limit 1`),
    );
    contactId = c?.id ?? null;
  }
  if (!contactId || !st.prices.length) return visit(db, ws, st, now);
  await db.insert(schema.revenueEvents).values({
    workspaceId: ws.id,
    contactId,
    source: "stripe",
    externalId: `demo_live_${randomToken(10)}`,
    type: "payment",
    amountMinor: pick(st.prices),
    currency: ws.reportingCurrency,
    occurredAt: now,
  });
  await db.update(schema.contacts).set({ lifecycle: "customer" }).where(eq(schema.contacts.id, contactId));
  st.leads = st.leads.filter((id) => id !== contactId);
  return true;
}
