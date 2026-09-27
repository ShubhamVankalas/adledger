import { and, eq, sql } from "drizzle-orm";
import Stripe from "stripe";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { changePasswordAction } from "@/app/actions/account";
import { acceptInviteAction } from "@/app/actions/auth";
import { inviteMemberAction } from "@/app/actions/org";
import { saveAiAction, saveIntegrationAction, saveOnboardingAction } from "@/app/actions/settings";
import { GET as mcpGet } from "@/app/api/mcp/route";
import { POST as collect } from "@/app/api/v1/collect/route";
import { GET as reports } from "@/app/api/v1/reports/[report]/route";
import { POST as spend } from "@/app/api/v1/spend/route";
import { POST as sync } from "@/app/api/v1/sync/[provider]/route";
import { POST as leadHook } from "@/app/api/v1/webhooks/leads/[token]/route";
import { POST as stripeHook } from "@/app/api/v1/webhooks/stripe/[workspaceId]/route";
import { fail, run } from "@/lib/actions";
import {
  acceptInvitation,
  createApiKey,
  InvitationError,
  login,
  MAX_FAILURES_PER_EMAIL,
  MAX_FAILURES_PER_IP_EMAIL,
  resetPasswordThrottle,
  SESSION_COOKIE,
} from "@/lib/auth";
import { hashPassword, randomToken, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { resetRateLimits } from "@/lib/http";
import { setLookupForTests } from "@/lib/net";
import { getConnection, saveConnection, type Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

// Server actions read the session cookie and client IP through next/headers: back them with a jar.
const ctx = vi.hoisted(() => ({ jar: new Map<string, string>(), headers: new Headers({ "x-forwarded-for": "198.51.100.7" }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.jar.has(name) ? { name, value: ctx.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void ctx.jar.set(name, value),
    delete: (name: string) => void ctx.jar.delete(name),
  }),
  headers: async () => ctx.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let db: DB;
let ws: Workspace;
let orgId: string;
const PASSWORD = "correct-horse-battery";
const users: Partial<Record<Role, { id: string; email: string }>> = {};

async function addMember(role: Role, email: string, workspaceIds: string[] | null = null) {
  const [u] = await db.insert(schema.users).values({ email, passwordHash: await hashPassword(PASSWORD) }).returning();
  await db.insert(schema.memberships).values({ organizationId: orgId, userId: u.id, role, workspaceIds });
  return u;
}

async function sessionToken(userId: string, workspaceId = ws.id) {
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ userId, workspaceId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  return token;
}

/** Sign the "browser" (next/headers mock) in as a role. */
async function signInAs(role: Role) {
  ctx.jar.set(SESSION_COOKIE, await sessionToken(users[role]!.id));
}

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  orgId = ws.organizationId;
  for (const role of ["owner", "admin", "analyst", "viewer", "client"] as Role[]) {
    users[role] = await addMember(role, `${role}@sec.test`, role === "client" ? [ws.id] : null);
  }
  // DNS in tests: everything resolves to a public address.
  setLookupForTests(async () => ["93.184.216.34"]);
});

beforeEach(() => {
  ctx.jar.clear();
  resetRateLimits();
  resetPasswordThrottle();
});

describe("REST API permissions", () => {
  const spendReq = (headers: Record<string, string>) =>
    new Request("http://app.test/api/v1/spend", {
      method: "POST",
      headers: { host: "app.test", "content-type": "application/json", ...headers },
      body: JSON.stringify({ rows: [{ date: "2026-09-01", platform: "meta", campaign_name: "Sec", spend: "1.00", currency: "USD" }] }),
    });
  const ctxNone = { params: Promise.resolve({}) } as never;

  it("dashboard sessions need the right role to write, API keys need the right scope", async () => {
    const viewer = `${SESSION_COOKIE}=${await sessionToken(users.viewer!.id)}`;
    expect((await spend(spendReq({ cookie: viewer, origin: "http://app.test" }), ctxNone)).status).toBe(403);
    const analyst = `${SESSION_COOKIE}=${await sessionToken(users.analyst!.id)}`;
    expect((await spend(spendReq({ cookie: analyst, origin: "http://app.test" }), ctxNone)).status).toBe(403);
    const admin = `${SESSION_COOKIE}=${await sessionToken(users.admin!.id)}`;
    expect((await spend(spendReq({ cookie: admin, origin: "http://app.test" }), ctxNone)).status).toBe(200);
    // New keys are read-only; writing needs the ingest:write scope.
    const { key: readOnly } = await createApiKey(ws.id, "sec-read");
    expect((await spend(spendReq({ authorization: `Bearer ${readOnly}` }), ctxNone)).status).toBe(403);
    const { key } = await createApiKey(ws.id, "sec", ["ingest:write"]);
    expect((await spend(spendReq({ authorization: `Bearer ${key}` }), ctxNone)).status).toBe(200);
  });

  it("blocks cross-site writes that ride on the session cookie", async () => {
    const admin = `${SESSION_COOKIE}=${await sessionToken(users.admin!.id)}`;
    expect((await spend(spendReq({ cookie: admin, origin: "https://evil.test" }), ctxNone)).status).toBe(403);
    expect((await spend(spendReq({ cookie: admin }), ctxNone)).status).toBe(403);
  });

  it("clients can read reports and MCP for their workspace only", async () => {
    const [other] = await db.insert(schema.workspaces).values({ organizationId: orgId, name: "Other", slug: `other-${randomToken(3)}` }).returning();
    const url = "http://app.test/api/v1/reports/overview?start=2026-01-01&end=2026-12-31&model=linear";
    const params = { params: Promise.resolve({ report: "overview" }) };
    const clientCookie = `${SESSION_COOKIE}=${await sessionToken(users.client!.id)}`;
    expect((await reports(new Request(url, { headers: { cookie: clientCookie } }), params)).status).toBe(200);
    // A session pointing at a workspace the client isn't allowed in is not a session at all.
    const sneaky = `${SESSION_COOKIE}=${await sessionToken(users.client!.id, other.id)}`;
    expect((await reports(new Request(url, { headers: { cookie: sneaky } }), params)).status).toBe(401);
    expect((await mcpGet(new Request("http://app.test/api/mcp", { headers: { cookie: sneaky } }), ctxNone)).status).toBe(401);
    expect((await mcpGet(new Request("http://app.test/api/mcp"), ctxNone)).status).toBe(401);
  });

  it("rate limits the sync endpoint per workspace", async () => {
    const { key } = await createApiKey(ws.id, "sync", ["ingest:write"]);
    const call = () =>
      sync(new Request("http://app.test/api/v1/sync/nope", { method: "POST", headers: { authorization: `Bearer ${key}` } }), {
        params: Promise.resolve({ provider: "nope" }),
      });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await call()).status);
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("public endpoints", () => {
  it("collect and lead webhooks refuse oversized bodies", async () => {
    const big = "x".repeat(70_000);
    expect((await collect(new Request("http://app.test/api/v1/collect", { method: "POST", body: big, headers: { "user-agent": "Mozilla/5.0" } }))).status).toBe(413);
    await db.insert(schema.leadWebhooks).values({ workspaceId: ws.id, name: "Big", token: "lw_security_test_1", fieldMapping: {} });
    const r = await leadHook(new Request("http://app.test/x", { method: "POST", body: "y".repeat(300_000) }), { params: Promise.resolve({ token: "lw_security_test_1" }) });
    expect(r.status).toBe(413);
    const odd = await leadHook(new Request("http://app.test/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ token: "../../etc" }) });
    expect(odd.status).toBe(404);
  });

  it("Stripe webhooks outside the 5-minute replay window are rejected", async () => {
    await saveConnection(ws.id, "stripe", { mode: "live", secrets: { webhookSecret: "whsec_sec" } }, db);
    const payload = JSON.stringify({ id: "evt_old", object: "event", type: "charge.succeeded", data: { object: {} } });
    const stripe = new Stripe("sk_test_x");
    const params = { params: Promise.resolve({ workspaceId: ws.id }) };
    const old = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_sec", timestamp: Math.floor(Date.now() / 1000) - 3600 });
    expect((await stripeHook(new Request("http://app.test/x", { method: "POST", body: payload, headers: { "stripe-signature": old } }), params)).status).toBe(400);
    const tampered = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    expect((await stripeHook(new Request("http://app.test/x", { method: "POST", body: payload, headers: { "stripe-signature": tampered } }), params)).status).toBe(400);
  });
});

describe("login throttling and sessions", () => {
  it("locks an (IP, email) pair after repeated failures, even for the right password", async () => {
    const email = users.viewer!.email;
    for (let i = 0; i < MAX_FAILURES_PER_IP_EMAIL; i++) expect((await login(email, "wrong-password", "203.0.113.1")).ok).toBe(false);
    const r = await login(email, PASSWORD, "203.0.113.1");
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/Too many attempts/) });
  });

  it("locks the account across rotating (spoofed) IPs", async () => {
    const email = users.analyst!.email;
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) await login(email, "wrong-password", `203.0.113.${i + 10}`);
    expect(await login(email, PASSWORD, "198.51.100.200")).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
  });

  it("issues a fresh session on login and revokes the one the browser carried (fixation)", async () => {
    const fixed = await sessionToken(users.owner!.id);
    ctx.jar.set(SESSION_COOKIE, fixed);
    expect(await login(users.owner!.email, PASSWORD, "203.0.113.50")).toEqual({ ok: true });
    const issued = ctx.jar.get(SESSION_COOKIE)!;
    expect(issued).not.toBe(fixed);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(fixed)))).toHaveLength(0);
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(issued)))).toHaveLength(1);
  });

  it("changing the password signs out every device and rotates this one", async () => {
    const u = await addMember("viewer", "rotate@sec.test");
    const other = await sessionToken(u.id);
    const current = await sessionToken(u.id);
    ctx.jar.set(SESSION_COOKIE, current);
    const bad = await changePasswordAction(form({ current: "nope-nope", next: "another-long-password" }));
    expect(bad.ok).toBe(false);
    const r = await changePasswordAction(form({ current: PASSWORD, next: "another-long-password" }));
    expect(r.ok).toBe(true);
    const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(sha256(other));
    expect(rows[0].tokenHash).not.toBe(sha256(current));
    expect(rows[0].tokenHash).toBe(sha256(ctx.jar.get(SESSION_COOKIE)!));
  });
});

describe("invitations", () => {
  async function invite(role: Role, invitedBy: string | null, email = `inv-${randomToken(4).toLowerCase()}@sec.test`) {
    const token = randomToken(24);
    const [inv] = await db
      .insert(schema.invitations)
      .values({ organizationId: orgId, email, role, workspaceIds: null, tokenHash: sha256(token), invitedBy, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    return { inv, token, email };
  }

  it("can only be used once", async () => {
    const { inv } = await invite("viewer", users.admin!.id);
    const u = await addMember("viewer", `once-${randomToken(3).toLowerCase()}@sec.test`);
    await db.delete(schema.memberships).where(eq(schema.memberships.userId, u.id));
    await db.transaction((tx) => acceptInvitation(tx, inv.id, u.id));
    await expect(db.transaction((tx) => acceptInvitation(tx, inv.id, u.id))).rejects.toBeInstanceOf(InvitationError);
  });

  it("is void when the inviter can no longer grant the role", async () => {
    const boss = await addMember("owner", `boss-${randomToken(3).toLowerCase()}@sec.test`);
    const { inv } = await invite("owner", boss.id);
    await db.update(schema.memberships).set({ role: "admin" }).where(eq(schema.memberships.userId, boss.id));
    const u = await addMember("viewer", `demoted-${randomToken(3).toLowerCase()}@sec.test`);
    await expect(db.transaction((tx) => acceptInvitation(tx, inv.id, u.id))).rejects.toThrow(/can no longer grant/);
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, u.id));
    expect(m.role).toBe("viewer");
    // Rolled back: the invitation is still unused.
    const [row] = await db.select().from(schema.invitations).where(eq(schema.invitations.id, inv.id));
    expect(row.acceptedAt).toBeNull();
  });

  it("never demotes an existing owner", async () => {
    const { inv } = await invite("client", users.admin!.id);
    await db.transaction((tx) => acceptInvitation(tx, inv.id, users.owner!.id));
    const [m] = await db.select().from(schema.memberships).where(and(eq(schema.memberships.userId, users.owner!.id), eq(schema.memberships.organizationId, orgId)));
    expect(m.role).toBe("owner");
  });

  it("admins cannot invite owners", async () => {
    await signInAs("admin");
    const r = await inviteMemberAction(form({ email: "newowner@sec.test", role: "owner" }));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/Only owners/) });
  });

  it("accepting as a different signed-in user never hands them the membership", async () => {
    const { token, email } = await invite("analyst", users.admin!.id);
    await signInAs("viewer"); // signed in as someone else
    const r = await acceptInviteAction(token, undefined, form({ name: "New Person", password: "a-good-password" })).catch((e: Error) => e);
    // Success redirects (Next.js throws a redirect error); the membership goes to the invited email.
    expect(r instanceof Error ? r.message : "").toMatch(/NEXT_REDIRECT/);
    const [created] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    const [m] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, created.id));
    expect(m.role).toBe("analyst");
    const [viewerM] = await db.select().from(schema.memberships).where(eq(schema.memberships.userId, users.viewer!.id));
    expect(viewerM.role).toBe("viewer");
    // The link is now spent.
    expect(await acceptInviteAction(token, undefined, form({ name: "X", password: "a-good-password" }))).toMatchObject({ error: expect.stringMatching(/expired or was already used/) });
  });

  it("existing accounts: wrong passwords are throttled", async () => {
    const { token } = await invite("viewer", users.admin!.id, users.client!.email);
    for (let i = 0; i < MAX_FAILURES_PER_IP_EMAIL; i++) {
      expect(await acceptInviteAction(token, undefined, form({ password: "wrong-password" }))).toMatchObject({ error: expect.stringMatching(/doesn't match/) });
    }
    expect(await acceptInviteAction(token, undefined, form({ password: PASSWORD }))).toMatchObject({ error: expect.stringMatching(/Too many/) });
  });
});

describe("settings actions", () => {
  it("reject internal URLs for AI base URLs and integrations", async () => {
    await signInAs("admin");
    const ai = await saveAiAction(form({ provider: "custom", model: "m", baseUrl: "http://169.254.169.254/v1" }));
    expect(ai).toMatchObject({ ok: false, message: expect.stringMatching(/Base URL/) });
    expect((await saveAiAction(form({ provider: "ollama", model: "llama3.1", baseUrl: "http://host.docker.internal:11434" }))).ok).toBe(true);

    const hook = await saveIntegrationAction("notify_webhook", form({ url: "http://10.0.0.5:8080/hook" }));
    expect(hook).toMatchObject({ ok: false, message: expect.stringMatching(/Endpoint URL/) });
    expect(await getConnection(ws.id, "notify_webhook", db)).toBeUndefined();
    const slack = await saveIntegrationAction("notify_slack", form({ webhookUrl: "http://localhost:9000/services/x" }));
    expect(slack.ok).toBe(false);
    // Host-only fields (TikTok's configurable API host) are checked too.
    const tiktok = await saveIntegrationAction("tiktok_ads", form({ advertiserIds: "1", accessToken: "t", apiHost: "https://169.254.169.254" }));
    expect(tiktok).toMatchObject({ ok: false, message: expect.stringMatching(/API host/) });
    expect((await saveIntegrationAction("notify_webhook", form({ url: "https://hooks.example.com/adledger" }))).ok).toBe(true);
  });

  it("viewers can't change integrations; onboarding input is sanitized", async () => {
    await signInAs("viewer");
    expect(await saveIntegrationAction("notify_webhook", form({ url: "https://hooks.example.com/x" }))).toMatchObject({ ok: false, message: expect.stringMatching(/permission/) });
    const r = await saveOnboardingAction({ platforms: ["meta", { evil: true } as unknown as string, "x".repeat(500), "site:shopify"], dismissed: "yes" as unknown as boolean });
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, ws.id));
    expect(row.onboarding).toMatchObject({ platforms: ["meta", "site:shopify"] });
    expect((row.onboarding as { dismissed?: unknown }).dismissed).not.toBe("yes");
  });

  it("server actions never return raw database errors", async () => {
    const r = await run(async () => {
      await db.execute(sql.raw("select * from table_that_does_not_exist"));
      return fail("unreachable");
    });
    expect(r.ok).toBe(false);
    expect(r.message).not.toMatch(/table_that_does_not_exist|select/);
  });
});
