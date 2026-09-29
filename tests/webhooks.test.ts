import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebhookEndpointAction,
  deleteWebhookEndpointAction,
  redeliverWebhookAction,
  revealWebhookSecretAction,
  sendWebhookTestAction,
} from "@/app/actions/developers";
import { createRoleAction } from "@/app/actions/roles";
import { GET as leadsRoute } from "@/app/api/v1/leads/route";
import { gatePage } from "@/components/access-denied";
import { createApiKey, SESSION_COOKIE } from "@/lib/auth";
import { ingestRevenue } from "@/lib/connectors/revenue/ingest";
import { randomToken, sha256 } from "@/lib/crypto";
import { schema, type DB } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { setLookupForTests } from "@/lib/net";
import { roleCan } from "@/lib/permissions";
import { listStages, moveContacts } from "@/lib/pipeline";
import type { Workspace } from "@/lib/settings";
import { recordLead, upsertContact } from "@/lib/tracking/identity";
import { MAX_ATTEMPTS, sampleEvent, WEBHOOK_EVENT_TYPES } from "@/lib/webhooks/catalog";
import { dispatchDueWebhooks, pruneWebhookDeliveries, retryDelayMs } from "@/lib/webhooks/deliver";
import { createEndpoint, EndpointError, parseEndpointInput, revealEndpointSecret } from "@/lib/webhooks/endpoints";
import { signatureHeader, verifySignature } from "@/lib/webhooks/signature";
import { setupWorkspace } from "./helpers";

const ctx = vi.hoisted(() => ({ jar: new Map<string, string>(), headers: new Headers({ "x-forwarded-for": "198.51.100.9" }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (ctx.jar.has(name) ? { name, value: ctx.jar.get(name)! } : undefined),
    set: (name: string, value: string) => void ctx.jar.set(name, value),
    delete: (name: string) => void ctx.jar.delete(name),
  }),
  headers: async () => ctx.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const PUBLIC_IP = "93.184.216.34";
let db: DB;
let ws: Workspace;
const users: Record<string, string> = {};

type Sent = { url: string; headers: Headers; body: string };
const sent: Sent[] = [];
let reply: (s: Sent) => Response = () => new Response("ok", { status: 200 });

async function addMember(role: Role, email: string) {
  const [u] = await db.insert(schema.users).values({ email, passwordHash: "x" }).returning();
  await db.insert(schema.memberships).values({ organizationId: ws.organizationId, userId: u.id, role });
  return u.id;
}

async function signIn(userId: string) {
  const token = randomToken(32);
  await db.insert(schema.sessions).values({ userId, workspaceId: ws.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86_400_000) });
  ctx.jar.set(SESSION_COOKIE, token);
}

function endpointForm(url: string, events: string[], includePii = false) {
  const f = new FormData();
  f.set("url", url);
  f.set("description", "test");
  for (const e of events) f.append("events", e);
  if (includePii) f.set("includePii", "on");
  return f;
}

const deliveries = (endpointId?: string) =>
  db
    .select()
    .from(schema.webhookDeliveries)
    .where(and(eq(schema.webhookDeliveries.workspaceId, ws.id), endpointId ? eq(schema.webhookDeliveries.endpointId, endpointId) : undefined));

async function clearDeliveries() {
  await db.delete(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.workspaceId, ws.id));
  sent.length = 0;
}

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  for (const role of ["owner", "admin", "analyst", "viewer"] as const) users[role] = await addMember(role, `${role}@hooks.test`);
  setLookupForTests(async (host) => (host.startsWith("internal.") ? ["10.0.0.7"] : [PUBLIC_IP]));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init: RequestInit) => {
      const s = { url: String(url), headers: new Headers(init.headers), body: String(init.body) };
      sent.push(s);
      return reply(s);
    }),
  );
});

afterAll(() => {
  setLookupForTests();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  ctx.jar.clear();
  reply = () => new Response("ok", { status: 200 });
});

describe("signatures", () => {
  const body = JSON.stringify(sampleEvent("lead.created"));
  const secret = "whsec_test";
  const now = new Date("2026-09-29T10:00:00Z");

  it("round-trips and rejects tampering, replays and junk", () => {
    const header = signatureHeader(body, secret, now);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifySignature(body, header, secret, { now })).toMatchObject({ ok: true });
    expect(verifySignature(body.replace("Priya", "Mallory"), header, secret, { now })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature(body, header, "whsec_other", { now })).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature(body, header, secret, { now: new Date(now.getTime() + 301_000) })).toEqual({ ok: false, reason: "expired" });
    expect(verifySignature(body, "v1=abc", secret, { now })).toEqual({ ok: false, reason: "malformed" });
    expect(verifySignature(body, null, secret, { now })).toEqual({ ok: false, reason: "malformed" });
  });

  it("accepts any of several v1 values (receiver-side rotation)", () => {
    const header = signatureHeader(body, secret, now);
    const other = signatureHeader(body, "whsec_old", now).split(",")[1];
    expect(verifySignature(body, `${header},${other}`, secret, { now }).ok).toBe(true);
  });
});

describe("SSRF guard on endpoint URLs", () => {
  const input = (url: string) => parseEndpointInput({ url, description: "", events: ["lead.created"], includePii: false });

  it("blocks private, loopback, link-local and internal hosts, and plain http", async () => {
    for (const url of [
      "https://127.0.0.1/hook",
      "https://10.1.2.3/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/hook",
      "https://localhost/hook",
      "https://metadata.google.internal/",
      "https://internal.example.com/hook",
      "http://hooks.example.com/hook",
      "ftp://hooks.example.com/",
      "https://user:pass@hooks.example.com/",
    ]) {
      await expect(input(url), url).rejects.toBeInstanceOf(EndpointError);
    }
  });

  it("accepts a public https URL and validates the event list", async () => {
    await expect(input("https://hooks.example.com/catch/1")).resolves.toMatchObject({ url: "https://hooks.example.com/catch/1", events: ["lead.created"] });
    await expect(parseEndpointInput({ url: "https://hooks.example.com/", description: "", events: [], includePii: false })).rejects.toThrow(/at least one event/);
    await expect(parseEndpointInput({ url: "https://hooks.example.com/", description: "", events: ["lead.deleted"], includePii: false })).rejects.toThrow(/at least one event/);
  });

  it("ALLOW_PRIVATE_URLS=true lets local receivers through (development)", async () => {
    vi.stubEnv("ALLOW_PRIVATE_URLS", "true");
    try {
      await expect(input("http://localhost:4000/hook")).resolves.toMatchObject({ url: "http://localhost:4000/hook" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("re-checks the host at delivery time (DNS may have changed)", async () => {
    await clearDeliveries();
    const { endpoint } = await createEndpoint(db, ws.id, { url: "https://rebind.example.com/hook", description: "", events: ["contact.created"], includePii: false }, null);
    setLookupForTests(async (host) => (host.startsWith("rebind.") ? ["10.9.9.9"] : [PUBLIC_IP]));
    try {
      await upsertContact(db, ws.id, { email: "rebind@example.com" }, new Date());
      const r = await dispatchDueWebhooks({ db });
      expect(r).toMatchObject({ attempted: 1, failed: 1 });
      expect(sent).toHaveLength(0);
      const [d] = await deliveries(endpoint.id);
      expect(d.status).toBe("failed"); // blocked: permanent, never retried
      expect(d.lastError).toMatch(/private or internal/);
    } finally {
      setLookupForTests(async (host) => (host.startsWith("internal.") ? ["10.0.0.7"] : [PUBLIC_IP]));
      await db.delete(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, endpoint.id));
    }
  });
});

describe("event fan-out and delivery", () => {
  it("queues one delivery per subscribed endpoint, keeps PII out of the log and signs every request", async () => {
    await clearDeliveries();
    const plain = await createEndpoint(db, ws.id, { url: "https://plain.example.com/hook", description: "", events: ["lead.created", "contact.created"], includePii: false }, null);
    const pii = await createEndpoint(db, ws.id, { url: "https://pii.example.com/hook", description: "", events: ["lead.created"], includePii: true }, null);
    const money = await createEndpoint(db, ws.id, { url: "https://money.example.com/hook", description: "", events: ["payment.succeeded"], includePii: false }, null);
    // Contacts without a stage are reported in the first open stage.
    await listStages(db, ws.id);

    const at = new Date();
    const contact = (await upsertContact(db, ws.id, { email: "Priya@Northwind.io", phone: "+1 415 555 0142", name: "Priya" }, at))!;
    await recordLead(db, { workspaceId: ws.id, contactId: contact.id, source: "webhook", formName: "Demo", occurredAt: at, raw: {}, phone: "+1 415 555 0142" });
    // An existing contact is not "created" again.
    await upsertContact(db, ws.id, { email: "priya@northwind.io" }, at);

    const rows = await deliveries();
    expect(rows.filter((r) => r.endpointId === plain.endpoint.id).map((r) => r.event).sort()).toEqual(["contact.created", "lead.created"]);
    expect(rows.filter((r) => r.endpointId === pii.endpoint.id).map((r) => r.event)).toEqual(["lead.created"]);
    expect(rows.filter((r) => r.endpointId === money.endpoint.id)).toHaveLength(0);
    // The stored payload never has raw PII; only the personal-data endpoint carries the encrypted copy.
    const stored = JSON.stringify(rows.map((r) => r.payload));
    expect(stored).not.toContain("priya@northwind.io");
    expect(stored).not.toContain("415");
    expect(rows.find((r) => r.endpointId === pii.endpoint.id)?.piiEnc).toBeTruthy();
    expect(rows.filter((r) => r.endpointId === plain.endpoint.id).every((r) => r.piiEnc === null)).toBe(true);
    // Both lead deliveries share the event id (receivers dedupe on it).
    const leadIds = new Set(rows.filter((r) => r.event === "lead.created").map((r) => r.eventId));
    expect(leadIds.size).toBe(1);

    const r = await dispatchDueWebhooks({ db });
    expect(r).toMatchObject({ attempted: 3, delivered: 3 });
    expect(sent).toHaveLength(3);
    const toPii = sent.find((s) => s.url.startsWith("https://pii."))!;
    const toPlain = sent.find((s) => s.url.startsWith("https://plain.") && s.headers.get("AdLedger-Event") === "lead.created")!;
    const piiBody = JSON.parse(toPii.body);
    const plainBody = JSON.parse(toPlain.body);
    expect(piiBody.data.contact).toMatchObject({ email: "priya@northwind.io", phone: "+1 415 555 0142", name: "Priya" });
    expect(plainBody.data.contact).toMatchObject({ email: null, phone: null, email_masked: "p••••@northwind.io", email_sha256: sha256("priya@northwind.io") });
    expect(plainBody.data.lead).toMatchObject({ source: "webhook", form_name: "Demo" });
    expect(plainBody.data.contact.stage).toMatchObject({ kind: "open" });
    expect(plainBody).toMatchObject({ type: "lead.created", test: false, workspace_id: ws.id });
    // Each endpoint's own secret signs its request.
    for (const [s, ep] of [
      [toPii, pii.secret],
      [toPlain, plain.secret],
    ] as const) {
      expect(verifySignature(s.body, s.headers.get("AdLedger-Signature"), ep).ok).toBe(true);
      expect(s.headers.get("AdLedger-Event-Id")).toBe(JSON.parse(s.body).id);
    }
    expect(verifySignature(toPii.body, toPii.headers.get("AdLedger-Signature"), plain.secret).ok).toBe(false);
    expect((await deliveries()).every((d) => d.status === "delivered" && d.responseCode === 200)).toBe(true);
  });

  it("fires payment.succeeded and contact.updated (won by the payment) for new payments only", async () => {
    await clearDeliveries();
    const hook = await createEndpoint(db, ws.id, { url: "https://all.example.com/hook", description: "", events: [...WEBHOOK_EVENT_TYPES], includePii: false }, null);
    const pay = { type: "payment" as const, externalId: "pi_1", amountMinor: 14900, currency: "usd", occurredAt: new Date(), customer: { email: "buyer@example.com", name: "Buyer" } };
    await ingestRevenue(db, ws.id, "stripe", [pay]);
    await ingestRevenue(db, ws.id, "stripe", [pay]); // replayed webhook: nothing new
    await ingestRevenue(db, ws.id, "stripe", [{ ...pay, type: "refund", externalId: "re_1", relatedExternalId: "pi_1", amountMinor: 4900 }]);
    const rows = (await deliveries(hook.endpoint.id)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    expect(rows.map((r) => r.event).sort()).toEqual(["contact.created", "contact.updated", "payment.refunded", "payment.succeeded"]);
    const paid = rows.find((r) => r.event === "payment.succeeded")!.payload as { data: { payment: { amount_minor: number; currency: string }; contact: { lifecycle: string; stage: { kind: string } } } };
    expect(paid.data.payment).toMatchObject({ amount_minor: 14900, currency: "USD" });
    expect(paid.data.contact).toMatchObject({ lifecycle: "customer", stage: { kind: "won" } });
    const updated = rows.find((r) => r.event === "contact.updated")!.payload as { data: { changes: { stage: { source: string; to: { kind: string } } } } };
    expect(updated.data.changes.stage).toMatchObject({ source: "payment", to: { kind: "won" } });
    const refund = rows.find((r) => r.event === "payment.refunded")!.payload as { data: { refund: { amount_minor: number; related_external_id: string } } };
    expect(refund.data.refund).toMatchObject({ amount_minor: 4900, related_external_id: "pi_1" });
  });

  it("fires contact.updated for manual pipeline moves", async () => {
    await clearDeliveries();
    const [c] = await db.select().from(schema.contacts).where(and(eq(schema.contacts.workspaceId, ws.id), eq(schema.contacts.email, "priya@northwind.io")));
    const stages = await listStages(db, ws.id);
    const target = stages.find((s) => s.kind === "open" && s.position > 0)!;
    await moveContacts(db, { workspaceId: ws.id, contactIds: [c.id], stageId: target.id, userId: null });
    const rows = (await deliveries()).filter((r) => r.event === "contact.updated");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].payload).toMatchObject({ data: { contact: { id: c.id, stage: { id: target.id } }, changes: { stage: { source: "manual", to: { id: target.id } } } } });
  });

  it("retries failures with backoff and gives up after the last attempt", async () => {
    await clearDeliveries();
    await db.update(schema.webhookEndpoints).set({ enabled: false }).where(eq(schema.webhookEndpoints.workspaceId, ws.id));
    const flaky = await createEndpoint(db, ws.id, { url: "https://flaky.example.com/hook", description: "", events: ["contact.created"], includePii: false }, null);
    reply = () => new Response("boom", { status: 503 });
    await upsertContact(db, ws.id, { email: "retry@example.com" }, new Date());

    const t0 = new Date();
    expect(await dispatchDueWebhooks({ db, now: t0 })).toMatchObject({ attempted: 1, retrying: 1 });
    let [d] = await deliveries(flaky.endpoint.id);
    expect(d).toMatchObject({ status: "pending", attempts: 1, responseCode: 503, lastError: "HTTP 503", responseBody: "boom" });
    expect(d.nextAttemptAt!.getTime()).toBe(t0.getTime() + retryDelayMs(1));

    // Not due yet: nothing is sent.
    expect(await dispatchDueWebhooks({ db, now: new Date(t0.getTime() + 30_000) })).toMatchObject({ attempted: 0 });
    // Due: second attempt, next delay is longer.
    const t1 = new Date(t0.getTime() + retryDelayMs(1) + 1);
    await dispatchDueWebhooks({ db, now: t1 });
    [d] = await deliveries(flaky.endpoint.id);
    expect(d.attempts).toBe(2);
    expect(d.nextAttemptAt!.getTime()).toBe(t1.getTime() + retryDelayMs(2));
    expect(retryDelayMs(2)).toBeGreaterThan(retryDelayMs(1));

    // The last attempt fails for good.
    await db.update(schema.webhookDeliveries).set({ attempts: MAX_ATTEMPTS - 1, nextAttemptAt: t1 }).where(eq(schema.webhookDeliveries.id, d.id));
    await dispatchDueWebhooks({ db, now: new Date(t1.getTime() + 1) });
    [d] = await deliveries(flaky.endpoint.id);
    expect(d).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, nextAttemptAt: null });

    // A network error is retried like a 5xx; a later success is recorded.
    reply = () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    };
    await upsertContact(db, ws.id, { email: "retry2@example.com" }, new Date());
    await dispatchDueWebhooks({ db });
    const [d2] = (await deliveries(flaky.endpoint.id)).filter((x) => x.id !== d.id);
    expect(d2).toMatchObject({ status: "pending", lastError: "Connection refused", responseCode: null });
    reply = () => new Response(null, { status: 204 });
    await dispatchDueWebhooks({ db, now: new Date(Date.now() + retryDelayMs(1) + 1) });
    expect((await deliveries(flaky.endpoint.id)).find((x) => x.id === d2.id)).toMatchObject({ status: "delivered", attempts: 2, responseCode: 204 });

    // Paused endpoints get no new events.
    await db.update(schema.webhookEndpoints).set({ enabled: false }).where(eq(schema.webhookEndpoints.id, flaky.endpoint.id));
    const { invalidateWebhookSubscribers } = await import("@/lib/webhooks/emit");
    invalidateWebhookSubscribers(ws.id);
    const before = (await deliveries()).length;
    await upsertContact(db, ws.id, { email: "paused@example.com" }, new Date());
    expect((await deliveries()).length).toBe(before);

    // Logs older than the retention window are pruned.
    expect(await pruneWebhookDeliveries(db, new Date(Date.now() + 31 * 86_400_000))).toBeGreaterThan(0);
    expect(await deliveries()).toHaveLength(0);
  });
});

describe("permissions", () => {
  it("defaults: owners and admins only", () => {
    for (const p of ["developers.access", "page.developers"] as const) {
      expect(roleCan("owner", p)).toBe(true);
      expect(roleCan("admin", p)).toBe(true);
      expect(roleCan("analyst", p)).toBe(false);
      expect(roleCan("viewer", p)).toBe(false);
      expect(roleCan("client", p)).toBe(false);
    }
  });

  it("gates the Developers page and every webhook action", async () => {
    await signIn(users.analyst);
    expect(await gatePage("page.developers")).not.toBeNull();
    const denied = await createWebhookEndpointAction(endpointForm("https://hooks.example.com/a", ["lead.created"]));
    expect(denied).toMatchObject({ ok: false });
    expect(denied.message).toMatch(/permission/);

    await signIn(users.admin);
    expect(await gatePage("page.developers")).toBeNull();
    const created = await createWebhookEndpointAction(endpointForm("https://hooks.example.com/a", ["lead.created"], true));
    expect(created.ok).toBe(true);
    const id = String(created.data?.id);
    expect(String(created.data?.secret)).toMatch(/^whsec_/);
    const [row] = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.id, id));
    expect(row.secretEnc).not.toContain("whsec_"); // encrypted at rest
    expect(await revealEndpointSecret(db, row)).toBe(created.data?.secret);
    expect((await revealWebhookSecretAction(id)).data?.secret).toBe(created.data?.secret);

    // SSRF through the action, and the audit trail.
    expect((await createWebhookEndpointAction(endpointForm("https://169.254.169.254/", ["lead.created"]))).ok).toBe(false);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.organizationId, ws.organizationId));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["webhook.created", "webhook.secret_revealed"]));
    expect(JSON.stringify(audit)).not.toContain("hooks.example.com/a"); // host only, never the full URL

    // Test event and redelivery.
    sent.length = 0;
    const test = await sendWebhookTestAction(id, "payment.succeeded");
    expect(test.ok).toBe(true);
    expect(JSON.parse(sent[0].body)).toMatchObject({ type: "payment.succeeded", test: true, data: { contact: { email: "priya@example.com" } } });
    const [testDelivery] = await deliveries(id);
    expect(testDelivery.maxAttempts).toBe(1);
    expect((await redeliverWebhookAction(testDelivery.id)).ok).toBe(true);
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1].body).id).toBe(JSON.parse(sent[0].body).id);

    // Viewers can't touch it either.
    await signIn(users.viewer);
    expect((await deleteWebhookEndpointAction(id)).ok).toBe(false);
    await signIn(users.admin);
    expect((await deleteWebhookEndpointAction(id)).ok).toBe(true);
  });

  it("personal data needs contacts.pii on top of developers.access", async () => {
    await signIn(users.owner);
    const role = await createRoleAction(
      (() => {
        const f = new FormData();
        f.set("name", "Integrator");
        f.set("description", "");
        for (const p of ["page.developers", "developers.access", "reports.view"]) f.append("permissions", p);
        return f;
      })(),
    );
    expect(role.ok).toBe(true);
    const integrator = await addMember(String(role.data?.key), "integrator@hooks.test");
    await signIn(integrator);
    expect(await gatePage("page.developers")).toBeNull();
    const withPii = await createWebhookEndpointAction(endpointForm("https://hooks.example.com/b", ["lead.created"], true));
    expect(withPii.ok).toBe(false);
    expect(withPii.message).toMatch(/contact emails/);
    expect((await createWebhookEndpointAction(endpointForm("https://hooks.example.com/b", ["lead.created"]))).ok).toBe(true);
  });
});

describe("GET /api/v1/leads", () => {
  it("pages through leads with a cursor and masks emails without contacts:pii", async () => {
    const [c] = await db.select().from(schema.contacts).where(eq(schema.contacts.workspaceId, ws.id)).limit(1);
    const base = Date.parse("2026-01-01T00:00:00Z");
    for (let i = 0; i < 5; i++) await recordLead(db, { workspaceId: ws.id, contactId: c.id, source: "api", occurredAt: new Date(base + i * 1000), raw: {} });
    const { key } = await createApiKey(ws.id, "leads", ["contacts:read"]);
    const get = async (qs: string) => {
      const res = await leadsRoute(new Request(`http://localhost/api/v1/leads?${qs}`, { headers: { authorization: `Bearer ${key}` } }), {});
      return { status: res.status, body: (await res.json()) as { rows: { id: string; occurredAt: string; contact: { email: string | null } }[]; next_cursor: string | null; emailsMasked: boolean } };
    };
    const seen: string[] = [];
    let cursor: string | null = "";
    let pages = 0;
    while (cursor !== null) {
      const { status, body } = await get(`source=api&limit=2&until=2026-01-02T00:00:00Z${cursor ? `&cursor=${cursor}` : ""}`);
      expect(status).toBe(200);
      expect(body.emailsMasked).toBe(true);
      seen.push(...body.rows.map((r) => r.id));
      cursor = body.next_cursor;
      pages++;
    }
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect((await get("cursor=not-a-cursor")).status).toBe(400);
    const noScope = await createApiKey(ws.id, "reports only", ["reports:read"]);
    const res = await leadsRoute(new Request("http://localhost/api/v1/leads", { headers: { authorization: `Bearer ${noScope.key}` } }), {});
    expect(res.status).toBe(403);
  });
});
