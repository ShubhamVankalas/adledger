import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as search } from "@/app/api/v1/search/route";
import { createApiKey } from "@/lib/auth";
import { hashEmail, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import { seedDemo } from "@/lib/demo/seed";
import { resetRateLimits } from "@/lib/http";
import { searchWorkspace, type SearchResult } from "@/lib/search";
import type { Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));

let db: DB;
let wsA: Workspace;
let wsB: Workspace;
let orgId: string;
let keyA: string;
let keyB: string;

const PRIYA = "priya.zeller@northwind.test";

async function member(role: "owner" | "viewer" | "client", workspace: Workspace, workspaceIds: string[] | null = null) {
  const [user] = await db
    .insert(schema.users)
    .values({ email: `${role}-${Math.random().toString(36).slice(2, 8)}@team.test`, passwordHash: "x" })
    .returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: user.id, role, workspaceIds });
  const token = `tok_${role}_${Math.random().toString(36).slice(2)}`;
  await db.insert(schema.sessions).values({ userId: user.id, workspaceId: workspace.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

async function addCampaignTree(ws: Workspace, names: { campaign: string; group: string; ad: string }) {
  const [acct] = await db
    .insert(schema.adAccounts)
    .values({ workspaceId: ws.id, platform: "meta", externalId: `act_${Math.random().toString(36).slice(2, 8)}`, name: "Main", currency: "USD" })
    .returning();
  const [c] = await db.insert(schema.campaigns).values({ workspaceId: ws.id, adAccountId: acct.id, platform: "meta", externalId: `c-${names.campaign}`, name: names.campaign }).returning();
  const [g] = await db.insert(schema.adGroups).values({ workspaceId: ws.id, campaignId: c.id, platform: "meta", externalId: `g-${names.group}`, name: names.group }).returning();
  const [a] = await db.insert(schema.ads).values({ workspaceId: ws.id, adGroupId: g.id, campaignId: c.id, platform: "meta", externalId: `a-${names.ad}`, name: names.ad }).returning();
  return { campaignId: c.id, groupId: g.id, adId: a.id };
}

type Init = { body?: unknown; raw?: string; token?: string; bearer?: string; site?: string };
function call({ body, raw, token, bearer, site = "same-origin" }: Init) {
  const headers: Record<string, string> = { "content-type": "application/json", "sec-fetch-site": site };
  if (token) headers.cookie = `al_session=${token}`;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return search(new Request("http://localhost/api/v1/search", { method: "POST", headers, body: raw ?? JSON.stringify(body) }));
}

const results = async (r: Response) => ((await r.json()) as { results: SearchResult[] }).results;

beforeAll(async () => {
  let org: { id: string };
  ({ db, ws: wsA, org } = await setupWorkspace());
  orgId = org.id;
  [wsB] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Other client", slug: `other-${Date.now()}`, reportingCurrency: "USD", timezone: "UTC" }).returning();
  await seedDemo(db, wsA.id, { anchor: "2026-09-01" });
  await db.insert(schema.contacts).values([
    { workspaceId: wsA.id, email: PRIYA, emailHash: hashEmail(PRIYA), name: "Priya Zeller", firstSeenAt: new Date("2026-08-01"), lifecycle: "customer" },
    { workspaceId: wsA.id, email: "promo%deals@shop.test", emailHash: hashEmail("promo%deals@shop.test"), name: null, firstSeenAt: new Date("2026-08-02") },
    // A matching name in another workspace of the same organization: must never leak into A.
    { workspaceId: wsB.id, email: "zeller.leak@other.test", emailHash: hashEmail("zeller.leak@other.test"), name: "Zeller Leak", firstSeenAt: new Date("2026-08-03") },
  ]);
  await addCampaignTree(wsA, { campaign: "Zephyr prospecting", group: "Zephyr lookalike 1%", ad: "Zephyr UGC v3" });
  await addCampaignTree(wsB, { campaign: "Zephyr leak campaign", group: "Zephyr leak set", ad: "Zephyr leak ad" });
  keyA = (await createApiKey(wsA.id, "A")).key;
  keyB = (await createApiKey(wsB.id, "B")).key;
});

beforeEach(() => resetRateLimits());

describe("searchWorkspace", () => {
  it("finds contacts by name and email, campaigns, ad sets and ads, with URLs", async () => {
    const byName = await searchWorkspace(db, wsA, "zeller", { kinds: ["contact"] });
    expect(byName.map((r) => r.title)).toEqual(["Priya Zeller"]);
    expect(byName[0]).toMatchObject({ kind: "contact", subtitle: PRIYA, status: "customer", url: `/contacts/${byName[0].id}` });

    const byEmail = await searchWorkspace(db, wsA, "  PRIYA.ZELLER@northwind.test ", { kinds: ["contact"] });
    expect(byEmail[0]?.title).toBe("Priya Zeller");

    const ads = await searchWorkspace(db, wsA, "zephyr");
    const kinds = ads.map((r) => r.kind);
    expect(kinds).toEqual(["campaign", "ad_group", "ad"]);
    const [campaign, group, ad] = ads;
    expect(campaign).toMatchObject({ title: "Zephyr prospecting", platform: "meta", url: `/performance?level=ad_group&parent=${campaign.id}` });
    expect(group).toMatchObject({ title: "Zephyr lookalike 1%", subtitle: "Zephyr prospecting", url: `/performance?level=ad&parent=${group.id}` });
    expect(ad).toMatchObject({ title: "Zephyr UGC v3", subtitle: "Zephyr lookalike 1%", url: `/performance?level=ad&parent=${group.id}` });
  });

  it("never returns another workspace's rows", async () => {
    const a = await searchWorkspace(db, wsA, "leak");
    expect(a).toEqual([]);
    const b = await searchWorkspace(db, wsB, "zephyr");
    expect(b.map((r) => r.title).sort()).toEqual(["Zephyr leak ad", "Zephyr leak campaign", "Zephyr leak set"]);
    const bZeller = await searchWorkspace(db, wsB, "zeller", { kinds: ["contact"] });
    expect(bZeller.map((r) => r.title)).toEqual(["Zeller Leak"]);
  });

  it("treats LIKE wildcards literally and ranks exact and prefix matches first", async () => {
    expect((await searchWorkspace(db, wsA, "%", { kinds: ["contact"] })).map((r) => r.title)).toEqual(["promo%deals@shop.test"]);
    expect(await searchWorkspace(db, wsA, "_", { kinds: ["campaign"] })).toEqual([]);
    // Demo data has many campaigns; a prefix match on "zephyr p" puts ours first.
    expect((await searchWorkspace(db, wsA, "zephyr p"))[0]?.title).toBe("Zephyr prospecting");
  });

  it("caps results per kind and masks emails when asked", async () => {
    const many = await searchWorkspace(db, wsA, "a", { kinds: ["contact"], limit: 3 });
    expect(many).toHaveLength(3);
    const masked = await searchWorkspace(db, wsA, "zeller", { kinds: ["contact"], maskEmails: true });
    expect(masked[0].subtitle).toBe("p••••••@northwind.test");
    const unnamed = await searchWorkspace(db, wsA, "promo", { kinds: ["contact"], maskEmails: true });
    expect(unnamed[0].title).not.toContain("promo%deals");
  });

  it("returns nothing for a blank query", async () => {
    expect(await searchWorkspace(db, wsA, "   ")).toEqual([]);
  });
});

describe("POST /api/v1/search", () => {
  it("requires a session or an API key", async () => {
    expect((await call({ body: { q: "zeller" } })).status).toBe(401);
    expect((await call({ body: { q: "zeller" }, bearer: "al_not_a_real_key" })).status).toBe(401);
    expect((await call({ body: { q: "zeller" }, token: "tok_expired_or_unknown" })).status).toBe(401);
  });

  it("scopes a session to its workspace", async () => {
    const viewerA = await member("viewer", wsA);
    const r = await call({ body: { q: "zeller" }, token: viewerA });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    const titles = (await results(r)).map((x) => x.title);
    expect(titles).toContain("Priya Zeller");
    expect(titles).not.toContain("Zeller Leak");

    const viewerB = await member("viewer", wsB);
    const rb = await results(await call({ body: { q: "zephyr" }, token: viewerB }));
    expect(rb.every((x) => x.title.includes("leak"))).toBe(true);
  });

  it("scopes an API key to its workspace", async () => {
    const a = await results(await call({ body: { q: "zeller", kinds: ["contact"] }, bearer: keyA }));
    expect(a.map((x) => x.title)).toEqual(["Priya Zeller"]);
    expect(a[0].subtitle).toBe(PRIYA);
    const b = await results(await call({ body: { q: "zeller", kinds: ["contact"] }, bearer: keyB }));
    expect(b.map((x) => x.title)).toEqual(["Zeller Leak"]);
  });

  it("masks emails for agency clients and refuses workspaces they can't see", async () => {
    const client = await member("client", wsA, [wsA.id]);
    const r = await results(await call({ body: { q: "zeller", kinds: ["contact"] }, token: client }));
    expect(r[0].subtitle).toBe("p••••••@northwind.test");
    // A client session pointed at a workspace outside its list is not a session at all.
    const outsider = await member("client", wsB, [wsA.id]);
    expect((await call({ body: { q: "zeller" }, token: outsider })).status).toBe(401);
  });

  it("blocks cross-site requests made with the session cookie", async () => {
    const owner = await member("owner", wsA);
    expect((await call({ body: { q: "zeller" }, token: owner, site: "cross-site" })).status).toBe(403);
    // API keys carry no ambient credentials, so the browser header doesn't matter for them.
    expect((await call({ body: { q: "zeller" }, bearer: keyA, site: "cross-site" })).status).toBe(200);
  });

  it("validates the body without echoing the query", async () => {
    const owner = await member("owner", wsA);
    const bad = await call({ raw: "{not json", token: owner });
    expect(bad.status).toBe(400);
    const empty = await call({ body: { q: "   " }, token: owner });
    expect(empty.status).toBe(400);
    const long = await call({ body: { q: `${"x".repeat(101)}@secret.test` }, token: owner });
    expect(long.status).toBe(400);
    expect(await long.text()).not.toContain("secret.test");
    const kinds = await call({ body: { q: "zeller", kinds: ["users"] }, token: owner });
    expect(kinds.status).toBe(400);
    const huge = await call({ raw: JSON.stringify({ q: "x".repeat(5000) }), token: owner });
    expect(huge.status).toBe(413);
  });

  it("rate-limits each caller", async () => {
    const owner = await member("owner", wsA);
    let limited = 0;
    for (let i = 0; i < 245; i++) {
      // A malformed body is rejected after the rate limit check, so this stays cheap.
      const r = await call({ raw: "{", token: owner });
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});
