import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as liveRoute } from "@/app/api/v1/live/route";
import { GET as pulseRoute } from "@/app/api/v1/live/pulse/route";
import { createApiKey } from "@/lib/auth";
import { hashEmail, sha256 } from "@/lib/crypto";
import { rows, schema, type DB } from "@/lib/db";
import { resetRateLimits } from "@/lib/http";
import { liveSubscriberCount, nudgeLive, subscribeLive, type LiveMessage } from "@/lib/live";
import { liveCursor, liveFeed, livePulse, liveSnapshot, maskPerson, safePath, scrubText, type LiveFeedItem } from "@/lib/reports-live";
import type { Workspace } from "@/lib/settings";
import { sql } from "drizzle-orm";
import { setupWorkspace } from "./helpers";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

// Fixed clock for the SQL tests. Workspace A is in India (UTC+05:30), so "today" starts at
// 18:30 UTC the day before: NOW is 16:00 local, two thirds of the way through the day.
const NOW = new Date("2026-09-27T10:30:00Z");
const TODAY_START = new Date("2026-09-26T18:30:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

// Personal data that must never reach a live payload.
const PRIYA_EMAIL = "priya.shah@gmail.com";
const RAHUL_EMAIL = "rahul.k@acme-corp.com";
const LEAKS = ["priya", "Priya", "Shah", "rahul", "acme-corp", "a@b.com", "Ortega", "Luis", "Zed", "zed@"];

let db: DB;
let wsA: Workspace;
let wsB: Workspace;
let orgId: string;

async function visitor(ws: Workspace, anon: string, contactId: string | null = null) {
  const [v] = await db
    .insert(schema.visitors)
    .values({ workspaceId: ws.id, anonymousId: anon, firstSeenAt: ago(60 * 48), lastSeenAt: NOW, contactId })
    .returning();
  return v.id;
}
const pageView = (ws: Workspace, visitorId: string, at: Date, url: string) =>
  db.insert(schema.events).values({ workspaceId: ws.id, visitorId, type: "page_view", occurredAt: at, url });
async function contact(ws: Workspace, email: string, name: string | null) {
  const [c] = await db.insert(schema.contacts).values({ workspaceId: ws.id, email, emailHash: hashEmail(email), name, firstSeenAt: ago(60 * 24 * 30) }).returning();
  return c.id;
}
const pay = (ws: Workspace, contactId: string | null, id: string, amountMinor: number, at: Date, currency = "USD") =>
  db.insert(schema.revenueEvents).values({
    workspaceId: ws.id,
    contactId,
    source: "stripe",
    externalId: id,
    type: amountMinor < 0 ? "refund" : "payment",
    amountMinor,
    currency,
    occurredAt: at,
  });

async function adTree(ws: Workspace, campaign: string) {
  const [acct] = await db.insert(schema.adAccounts).values({ workspaceId: ws.id, platform: "meta", externalId: `act_${ws.id.slice(0, 6)}`, name: "Main", currency: "USD" }).returning();
  const [c] = await db.insert(schema.campaigns).values({ workspaceId: ws.id, adAccountId: acct.id, platform: "meta", externalId: `c-${campaign}`, name: campaign }).returning();
  const [g] = await db.insert(schema.adGroups).values({ workspaceId: ws.id, campaignId: c.id, platform: "meta", externalId: "g1", name: "Lookalike 1%" }).returning();
  const [a] = await db.insert(schema.ads).values({ workspaceId: ws.id, adGroupId: g.id, campaignId: c.id, platform: "meta", externalId: "a1", name: "UGC v3" }).returning();
  const spend = (date: string, spendMinor: number) =>
    db.insert(schema.adInsightsDaily).values({ workspaceId: ws.id, platform: "meta", date, adAccountId: acct.id, campaignId: c.id, adGroupId: g.id, adId: a.id, spendMinor, currency: "USD" });
  return { campaignId: c.id, spend };
}

async function member(role: "owner" | "viewer" | "client", workspace: Workspace) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" })
    .returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role, workspaceIds: role === "client" ? [workspace.id] : null });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: workspace.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws: wsA, org } = await setupWorkspace({ timezone: "Asia/Kolkata" }));
  orgId = org.id;
  [wsB] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Other client", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();

  const { campaignId, spend } = await adTree(wsA, "Summer sale");
  await spend("2026-09-27", 12_000);
  await spend("2026-09-26", 30_000);

  const priya = await contact(wsA, PRIYA_EMAIL, "Priya Shah");
  const rahul = await contact(wsA, RAHUL_EMAIL, null);
  const ana = await contact(wsA, "ana@example.org", "Ana");
  const luis = await contact(wsA, "luis@example.org", "Luis Ortega");

  // v1: a Meta ad click two minutes ago (the query string holds an email: it must be dropped).
  const v1 = await visitor(wsA, "v1", priya);
  await pageView(wsA, v1, ago(2), "https://shop.test/pricing?email=a@b.com#top");
  await db.insert(schema.touchpoints).values({ workspaceId: wsA.id, visitorId: v1, occurredAt: ago(2), channel: "paid_social", platform: "meta", clickIdType: "fbclid", clickId: "fb.1", utmCampaign: "summer", campaignId });
  // v2: an organic visit four minutes ago, then a second page a minute later (same session).
  const v2 = await visitor(wsA, "v2");
  await pageView(wsA, v2, ago(4), "https://shop.test/blog/how-to");
  await db.insert(schema.touchpoints).values({ workspaceId: wsA.id, visitorId: v2, occurredAt: ago(4), channel: "organic" });
  await pageView(wsA, v2, ago(3), "https://shop.test/pricing");
  // v3: direct, seven minutes ago (the 5 minutes before the live window).
  const v3 = await visitor(wsA, "v3");
  await pageView(wsA, v3, ago(7), "/checkout");
  // v4: exactly at local midnight, the first instant of today.
  const v4 = await visitor(wsA, "v4");
  await pageView(wsA, v4, TODAY_START, "https://shop.test/");
  // v5: yesterday before "now" (counts for same time yesterday), after it, and a microsecond before midnight.
  const v5 = await visitor(wsA, "v5");
  await pageView(wsA, v5, new Date("2026-09-26T05:00:00Z"), "https://shop.test/");
  await pageView(wsA, v5, new Date("2026-09-26T12:00:00Z"), "https://shop.test/");
  const v6 = await visitor(wsA, "v6");
  await pageView(wsA, v6, new Date("2026-09-26T18:29:59Z"), "https://shop.test/late");

  // Leads: Priya twice today (counts once), Rahul yesterday morning and today.
  await db.insert(schema.leads).values([
    { workspaceId: wsA.id, contactId: priya, source: "pixel", formName: `Demo request from ${PRIYA_EMAIL}`, occurredAt: ago(1) },
    { workspaceId: wsA.id, contactId: priya, source: "pixel", formName: "Newsletter", occurredAt: ago(30) },
    { workspaceId: wsA.id, contactId: rahul, source: "webhook", formName: "Typeform", occurredAt: new Date("2026-09-26T08:00:00Z") },
    { workspaceId: wsA.id, contactId: rahul, source: "webhook", formName: "Typeform", occurredAt: new Date("2026-09-26T20:00:00Z") },
  ]);

  // Money (USD reporting currency).
  await pay(wsA, priya, "pi_1", 4_900, new Date(NOW.getTime() - 30_000)); // first ever payment: a new customer
  await pay(wsA, ana, "pi_old", 10_000, new Date("2026-09-20T10:00:00Z"));
  await pay(wsA, ana, "pi_2", 2_500, new Date("2026-09-27T01:00:00Z")); // returning customer
  await pay(wsA, ana, "re_1", -1_000, new Date("2026-09-27T02:00:00Z"));
  await pay(wsA, rahul, "pi_eur", 9_999, new Date("2026-09-27T03:00:00Z"), "EUR"); // other currency: a customer, not revenue
  await pay(wsA, luis, "pi_y1", 3_000, new Date("2026-09-26T09:00:00Z")); // yesterday before now
  await pay(wsA, luis, "pi_y2", 5_000, new Date("2026-09-26T15:00:00Z")); // yesterday after now

  // Workspace B: same shapes, big numbers, a different person. None of it may show up in A.
  const zed = await contact(wsB, "zed@other.test", "Zed Leak");
  const vb = await visitor(wsB, "vb", zed);
  await pageView(wsB, vb, ago(1), "https://other.test/secret-page");
  await db.insert(schema.leads).values({ workspaceId: wsB.id, contactId: zed, source: "api", occurredAt: ago(1) });
  await pay(wsB, zed, "pi_b", 777_777, ago(1));
});

beforeEach(() => resetRateLimits());

const noLeaks = (payload: unknown) => {
  const s = JSON.stringify(payload);
  for (const needle of LEAKS) expect(s, needle).not.toContain(needle);
  expect(s).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/); // no email address of any kind
};

describe("liveSnapshot", () => {
  it("counts today and the same time yesterday in the workspace timezone", async () => {
    const s = await liveSnapshot(db, wsA, NOW);
    expect(s.timezone).toBe("Asia/Kolkata");
    expect(s.currentHour).toBe(16);
    expect(s.dayFraction).toBeCloseTo(16 / 24, 6);
    expect(s.visitorsNow).toBe(2); // v1, v2
    expect(s.visitorsPrev).toBe(1); // v3
    expect(s.today).toEqual({ visitors: 4, pageviews: 5, leads: 2, customers: 2, orders: 2, revenueMinor: 6_400, refundsMinor: -1_000, spendMinor: 12_000 });
    // Yesterday up to 16:00 local: v5's morning view, Rahul's lead, Luis's first payment.
    expect(s.sameTimeYesterday).toEqual({ visitors: 1, pageviews: 1, leads: 1, customers: 1, orders: 1, revenueMinor: 3_000, refundsMinor: 0, spendMinor: 20_000 });
    expect(s.yesterdaySpendMinor).toBe(30_000);
    expect(s.roasToday).toBeCloseTo(6_400 / 12_000, 9);
  });

  it("matches plain SQL over the same rows", async () => {
    const s = await liveSnapshot(db, wsA, NOW);
    const [r] = rows<{ revenue: string; visitors: string }>(
      await db.execute(sql`
        select
          (select sum(amount_minor) from revenue_events where workspace_id = ${wsA.id} and currency = 'USD'
             and occurred_at >= ${TODAY_START.toISOString()}::timestamptz and occurred_at <= ${NOW.toISOString()}::timestamptz) as revenue,
          (select count(distinct visitor_id) from events where workspace_id = ${wsA.id}
             and occurred_at >= ${TODAY_START.toISOString()}::timestamptz and occurred_at <= ${NOW.toISOString()}::timestamptz) as visitors`),
    );
    expect(s.today.revenueMinor).toBe(Number(r.revenue));
    expect(s.today.visitors).toBe(Number(r.visitors));
    const pulse = await livePulse(db, wsA, NOW);
    expect(pulse).toEqual({ revenueMinor: s.today.revenueMinor, visitorsNow: s.visitorsNow, currency: "USD" });
  });

  it("buckets the hours in local time, with a running revenue total", async () => {
    const s = await liveSnapshot(db, wsA, NOW);
    expect(s.hourly).toHaveLength(24);
    const hour = (h: number) => s.hourly[h];
    expect(hour(6).today?.revenueMinor).toBe(2_500); // 01:00Z = 06:30 IST
    expect(hour(7).today?.revenueMinor).toBe(-1_000);
    expect(hour(15).today?.revenueMinor).toBe(4_900);
    expect(hour(15).today?.revenueCumMinor).toBe(6_400);
    expect(hour(16).today?.revenueCumMinor).toBe(6_400);
    expect(hour(17).today).toBeNull(); // the future
    expect(hour(0).today?.visitors).toBe(1); // v4 at 00:00:00 local
    expect(hour(14).yesterday.revenueMinor).toBe(3_000); // 09:00Z = 14:30 IST
    expect(hour(20).yesterday.revenueMinor).toBe(5_000); // yesterday's line covers the whole day
    expect(hour(23).yesterday.revenueCumMinor).toBe(8_000);
    expect(hour(23).yesterday.visitors).toBe(1); // v6 at 23:59:59
  });

  it("lists the last 30 minutes per minute, the top pages without query strings, and sources", async () => {
    const s = await liveSnapshot(db, wsA, NOW);
    expect(s.visitorsByMinute).toHaveLength(30);
    expect(s.visitorsByMinute[27]).toBe(1); // v1, two minutes ago
    expect(s.visitorsByMinute[26]).toBe(1); // v2's second page
    expect(s.visitorsByMinute[25]).toBe(1); // v2's first page
    expect(s.visitorsByMinute[22]).toBe(1); // v3
    expect(s.visitorsByMinute.reduce((a, b) => a + b, 0)).toBe(4);
    expect(s.topPages).toEqual([
      { path: "/pricing", visitors: 2 },
      { path: "/blog/how-to", visitors: 1 },
      { path: "/checkout", visitors: 1 },
    ]);
    expect(s.topSources).toEqual([
      { channel: "direct", platform: null, visitors: 1 },
      { channel: "organic", platform: null, visitors: 1 },
      { channel: "paid_social", platform: "meta", visitors: 1 },
    ]);
  });

  it("never mixes in another workspace and never carries personal data", async () => {
    const s = await liveSnapshot(db, wsA, NOW);
    noLeaks(s);
    expect(JSON.stringify(s)).not.toContain("777777");
    const b = await liveSnapshot(db, wsB, NOW);
    expect(b.visitorsNow).toBe(1);
    expect(b.today.revenueMinor).toBe(777_777);
    expect(b.topPages).toEqual([{ path: "/secret-page", visitors: 1 }]);
  });

  it("returns zeros, not errors, for an empty workspace", async () => {
    const [empty] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Empty", slug: `empty-${Date.now()}`, reportingCurrency: "INR", timezone: "America/Los_Angeles" }).returning();
    const s = await liveSnapshot(db, empty, NOW);
    expect(s.visitorsNow).toBe(0);
    expect(s.today.revenueMinor).toBe(0);
    expect(s.roasToday).toBeNull();
    expect(s.topPages).toEqual([]);
    expect(s.visitorsByMinute.every((v) => v === 0)).toBe(true);
    expect(s.currency).toBe("INR");
  });
});

describe("liveFeed", () => {
  const byKind = (items: LiveFeedItem[], kind: LiveFeedItem["kind"]) => items.filter((i) => i.kind === kind);

  it("shows ad clicks, visits, leads, payments and refunds, newest first", async () => {
    const { items, cursor } = await liveFeed(db, wsA, { mode: "latest" }, NOW);
    expect(cursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
    const times = items.map((i) => i.at);
    expect(times).toEqual([...times].sort().reverse());

    const [click] = byKind(items, "ad_click");
    expect(click).toMatchObject({ platform: "meta", channel: "paid_social", campaign: "Summer sale", path: "/pricing", who: null });
    // v2's organic session start is a visit; its second page (same session) is not repeated.
    const visits = byKind(items, "visit");
    expect(visits.map((v) => v.path).sort()).toEqual(["/blog/how-to", "/checkout"]);
    expect(visits.find((v) => v.path === "/blog/how-to")?.channel).toBe("organic");

    const leads = byKind(items, "lead");
    expect(leads).toHaveLength(3); // Priya ×2 today, Rahul today (yesterday morning is over 24h ago)
    expect(leads[0]).toMatchObject({ who: "P. S.", initials: "PS", form: "Demo request from •••", provider: "pixel", platform: "meta", campaign: "Summer sale" });
    expect(leads.find((l) => l.provider === "webhook")?.who).toBe("r•••@•••");

    const payments = byKind(items, "payment");
    expect(payments.map((p) => p.amountMinor)).toEqual([4_900, 9_999, 2_500, 5_000]);
    expect(payments[0]).toMatchObject({ who: "P. S.", currency: "USD", provider: "stripe", platform: "meta", campaign: "Summer sale" });
    expect(byKind(items, "refund")).toMatchObject([{ amountMinor: -1_000, who: "A." }]);
  });

  it("is scoped to the workspace and carries no personal data", async () => {
    const { items } = await liveFeed(db, wsA, { mode: "latest" }, NOW);
    noLeaks(items);
    expect(JSON.stringify(items)).not.toContain("777777");
    expect(items.some((i) => i.path === "/secret-page" || i.amountMinor === 777_777)).toBe(false);
    const b = await liveFeed(db, wsB, { mode: "latest" }, NOW);
    expect(b.items.map((i) => i.kind).sort()).toEqual(["lead", "payment", "visit"]);
    noLeaks(b.items);
  });

  it("returns only rows that arrived after the cursor", async () => {
    const cursor = await liveCursor(db);
    const lead = await contact(wsA, "new.person@gmail.com", "Mei Lin Chen");
    await db.insert(schema.leads).values({ workspaceId: wsA.id, contactId: lead, source: "api", formName: "Call me", occurredAt: new Date() });
    const { items, cursor: next } = await liveFeed(db, wsA, { mode: "since", since: cursor });
    const mine = items.filter((i) => i.who === "M. C.");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "lead", form: "Call me", initials: "MC" });
    expect(next > cursor).toBe(true);
    expect(JSON.stringify(items)).not.toContain("new.person");
  });
});

describe("PII masking", () => {
  it("masks people to initials or a masked email", () => {
    expect(maskPerson({ name: "Priya Shah", email: PRIYA_EMAIL })).toEqual({ label: "P. S.", initials: "PS" });
    expect(maskPerson({ name: "  maria   de la cruz ", email: null })).toEqual({ label: "M. C.", initials: "MC" });
    expect(maskPerson({ name: "Ana" })).toEqual({ label: "A.", initials: "A" });
    expect(maskPerson({ name: "Émile Zola" })).toEqual({ label: "É. Z.", initials: "ÉZ" });
    // A "name" that is really an email or a phone number falls back to the email mask.
    expect(maskPerson({ name: "priya.shah@gmail.com", email: PRIYA_EMAIL })).toEqual({ label: "p•••@gmail.com", initials: "P" });
    expect(maskPerson({ name: "+91 98765 43210", email: RAHUL_EMAIL })).toEqual({ label: "r•••@•••", initials: "R" });
    expect(maskPerson({ name: null, email: null })).toBeNull();
  });

  it("scrubs emails and phone numbers from free text and paths", () => {
    expect(scrubText("call +1 (312) 847-1928 or mail a.b@c.io")).toBe("call ••• or mail •••");
    expect(scrubText("Sale 2026 week 12")).toBe("Sale 2026 week 12");
    expect(safePath("https://shop.test/thanks?email=a@b.com&phone=123")).toBe("/thanks");
    expect(safePath("https://shop.test/u/jane%40doe.com/orders")).toBe("/u/•••/orders");
    expect(safePath("/track/9876543210")).toBe("/track/•••");
    expect(safePath(`/${"a".repeat(200)}`)).toHaveLength(80);
  });
});

// ---------------------------------------------------------------- SSE route

type SseEvent = { event: string; id?: string; data: unknown };

/** Read events from a streaming response until `done` says stop (or the time runs out). */
async function readEvents(res: Response, done: (events: SseEvent[]) => boolean, timeoutMs = 10_000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (!done(events) && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))]);
    if (!chunk || chunk.done) break;
    buf += decoder.decode(chunk.value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const fields = Object.fromEntries(block.split("\n").filter((l) => !l.startsWith(":")).map((l) => [l.slice(0, l.indexOf(":")), l.slice(l.indexOf(":") + 1).trim()]));
      if (fields.event) events.push({ event: fields.event, id: fields.id, data: JSON.parse(fields.data) });
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}

const open = (headers: Record<string, string>, query = "") => {
  const ac = new AbortController();
  const req = new Request(`http://localhost/api/v1/live${query}`, { headers, signal: ac.signal });
  return { ac, res: liveRoute(req) };
};

describe("GET /api/v1/live", () => {
  it("rejects anonymous calls and API keys", async () => {
    expect((await open({}).res).status).toBe(401);
    const key = (await createApiKey(wsA.id, "live")).key;
    expect((await open({ authorization: `Bearer ${key}` }).res).status).toBe(403);
  });

  it("streams a catch-up feed and a snapshot for the session's workspace only, without personal data", async () => {
    const token = await member("viewer", wsB);
    const { ac, res } = open({ cookie: `al_session=${token}` });
    const r = await res;
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    expect(r.headers.get("cache-control")).toContain("no-transform");
    const events = await readEvents(r, (e) => e.some((x) => x.event === "snapshot"));
    ac.abort();
    const feed = events.find((e) => e.event === "feed")!;
    expect(feed.id).toMatch(/Z$/);
    const items = (feed.data as { items: LiveFeedItem[]; reset?: boolean }).items;
    expect((feed.data as { reset?: boolean }).reset).toBe(true);
    // Workspace B's rows only (they sit at the fixed NOW, so they may or may not be in the real-time window).
    for (const i of items) expect(i.path === null || i.path === "/secret-page").toBe(true);
    const snap = events.find((e) => e.event === "snapshot")!.data as { currency: string; timezone: string };
    expect(snap.timezone).toBe("UTC");
    noLeaks(items.filter((i) => i.who !== null).map((i) => i.who));
    const all = JSON.stringify(events);
    for (const needle of ["zed@other.test", "Zed Leak", PRIYA_EMAIL, "Priya", "Summer sale"]) expect(all).not.toContain(needle);
  });

  it("pushes new rows to open streams, and clients may watch (read-only role)", async () => {
    const token = await member("client", wsA);
    const { ac, res } = open({ cookie: `al_session=${token}` });
    const r = await res;
    expect(r.status).toBe(200);
    const target = await contact(wsA, "sofia.m@gmail.com", "Sofía Marín");
    let pushed = false;
    const events = await readEvents(
      r,
      (e) => {
        if (!pushed && e.some((x) => x.event === "snapshot")) {
          pushed = true;
          void pay(wsA, target, `pi_live_${Date.now()}`, 12_345, new Date()).then(() => nudgeLive(wsA.id));
        }
        return e.some((x) => x.event === "feed" && (x.data as { items: LiveFeedItem[] }).items.some((i) => i.amountMinor === 12_345));
      },
      15_000,
    );
    ac.abort();
    const live = events.flatMap((e) => (e.event === "feed" ? (e.data as { items: LiveFeedItem[] }).items : [])).find((i) => i.amountMinor === 12_345);
    expect(live).toMatchObject({ kind: "payment", who: "S. M.", initials: "SM", currency: "USD" });
    expect(JSON.stringify(events)).not.toContain("sofia");
    // The stream unsubscribes when the client goes away.
    await new Promise((r) => setTimeout(r, 50));
    expect(liveSubscriberCount(wsA.id)).toBe(0);
  });

  it("resumes after a cursor without a reset", async () => {
    const token = await member("owner", wsA);
    const cursor = await liveCursor(db);
    const { ac, res } = open({ cookie: `al_session=${token}` }, `?after=${encodeURIComponent(cursor)}`);
    const events = await readEvents(await res, (e) => e.some((x) => x.event === "snapshot"));
    ac.abort();
    const feed = events.find((e) => e.event === "feed")!.data as { reset?: boolean };
    expect(feed.reset).toBeUndefined();
  });

  it("ignores a malformed cursor", async () => {
    const token = await member("owner", wsA);
    const { ac, res } = open({ cookie: `al_session=${token}`, "last-event-id": "'; drop table events; --" });
    const events = await readEvents(await res, (e) => e.some((x) => x.event === "snapshot"));
    ac.abort();
    expect((events.find((e) => e.event === "feed")!.data as { reset?: boolean }).reset).toBe(true);
  });
});

describe("live hub", () => {
  it("broadcasts new items once to every subscriber of the workspace", async () => {
    const a1: LiveMessage[] = [];
    const a2: LiveMessage[] = [];
    const b: LiveMessage[] = [];
    const un1 = subscribeLive(wsA, (m) => a1.push(m))!;
    const un2 = subscribeLive(wsA, (m) => a2.push(m))!;
    const unB = subscribeLive(wsB, (m) => b.push(m))!;
    // Let the first poll set the cursor, then add a row and nudge.
    await new Promise((r) => setTimeout(r, 300));
    const who = await contact(wsA, "kenji@example.org", "Kenji Watanabe");
    await db.insert(schema.leads).values({ workspaceId: wsA.id, contactId: who, source: "api", occurredAt: new Date() });
    nudgeLive(wsA.id);
    const deadline = Date.now() + 8_000;
    const got = (ms: LiveMessage[]) => ms.flatMap((m) => (m.type === "feed" ? m.items : [])).filter((i) => i.who === "K. W.");
    while (Date.now() < deadline && (got(a1).length === 0 || got(a2).length === 0)) await new Promise((r) => setTimeout(r, 50));
    // Two more polls: the lookback window must not re-send it.
    await new Promise((r) => setTimeout(r, 2_500));
    un1();
    un2();
    unB();
    expect(got(a1)).toHaveLength(1);
    expect(got(a2)).toHaveLength(1);
    expect(got(b)).toHaveLength(0);
    expect(liveSubscriberCount(wsA.id)).toBe(0);
  });
});

describe("GET /api/v1/live/pulse", () => {
  it("returns today's revenue and visitors now, scoped to the caller", async () => {
    const key = (await createApiKey(wsB.id, "pulse")).key;
    const res = await pulseRoute(new Request("http://localhost/api/v1/live/pulse", { headers: { authorization: `Bearer ${key}` } }), {} as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { currency: string; revenueMinor: number; visitorsNow: number };
    const expected = await livePulse(db, wsB);
    expect(body).toMatchObject({ currency: "USD", revenueMinor: expected.revenueMinor, visitorsNow: expected.visitorsNow });
    expect(res.headers.get("cache-control")).toContain("no-store");
    const anon = await pulseRoute(new Request("http://localhost/api/v1/live/pulse"), {} as never);
    expect(anon.status).toBe(401);
  });
});
