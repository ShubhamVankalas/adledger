import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { beforeAll, describe, expect, it } from "vitest";
import { POST as collect } from "@/app/api/v1/collect/route";
import { GET as health } from "@/app/api/v1/health/route";
import { POST as leadHook } from "@/app/api/v1/webhooks/leads/[token]/route";
import { POST as stripeHook } from "@/app/api/v1/webhooks/stripe/[workspaceId]/route";
import { GET as reports } from "@/app/api/v1/reports/[report]/route";
import { createApiKey } from "@/lib/auth";
import { schema, type DB } from "@/lib/db";
import { saveConnection, type Workspace } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

let db: DB;
let ws: Workspace;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await db.insert(schema.pixelSites).values({ workspaceId: ws.id, name: "Site", domains: "", publicKey: "pk_routes000001" });
  await db.insert(schema.leadWebhooks).values({ workspaceId: ws.id, name: "Typeform", token: "lw_routes_token_1", fieldMapping: {} });
});

describe("HTTP routes", () => {
  it("health reports the database", async () => {
    const r = await health();
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ status: "ok", db: "ok" });
  });

  it("collect accepts text/plain beacons and drops bots", async () => {
    const body = JSON.stringify({ site: "pk_routes000001", vid: "vid-route-0001", events: [{ t: "page_view", url: "https://shop.test/?utm_source=google&utm_medium=cpc&gclid=1" }] });
    const ok = await collect(new Request("http://localhost/api/v1/collect", { method: "POST", body, headers: { "content-type": "text/plain", "user-agent": UA, origin: "https://shop.test" } }));
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://shop.test");
    const bot = await collect(new Request("http://localhost/api/v1/collect", { method: "POST", body, headers: { "user-agent": "Googlebot/2.1" } }));
    expect(bot.status).toBe(204);
    const bad = await collect(new Request("http://localhost/api/v1/collect", { method: "POST", body: "{nope", headers: { "user-agent": UA } }));
    expect(bad.status).toBe(400);
    const tps = await db.select().from(schema.touchpoints);
    expect(tps).toHaveLength(1);
  });

  it("lead webhook creates a contact + lead from JSON and form posts", async () => {
    const params = Promise.resolve({ token: "lw_routes_token_1" });
    const r1 = await leadHook(
      new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "webhook@example.com", name: "Web Hook", al_vid: "vid-route-0001" }) }),
      { params },
    );
    expect(r1.status).toBe(201);
    const r2 = await leadHook(
      new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "Email=form%40example.com&phone=%2B15551112222" }),
      { params },
    );
    expect(r2.status).toBe(201);
    const r3 = await leadHook(new Request("http://localhost/x", { method: "POST", body: JSON.stringify({ hello: "world" }) }), { params });
    expect(r3.status).toBe(422);
    const r4 = await leadHook(new Request("http://localhost/x", { method: "POST", body: "{}" }), { params: Promise.resolve({ token: "nope" }) });
    expect(r4.status).toBe(404);
    const leads = await db.select().from(schema.leads);
    expect(leads).toHaveLength(2);
    const [v] = await db.select().from(schema.visitors).where(eq(schema.visitors.anonymousId, "vid-route-0001"));
    expect(v.contactId).not.toBeNull();
  });

  it("stripe webhook: 400 on bad signature (nothing stored), 200 on valid", async () => {
    await saveConnection(ws.id, "stripe", { mode: "live", secrets: { webhookSecret: "whsec_route" } }, db);
    const payload = JSON.stringify({
      id: "evt_r1",
      object: "event",
      type: "charge.succeeded",
      created: 1790000000,
      data: { object: { id: "ch_r1", amount: 1234, amount_refunded: 0, currency: "usd", created: 1790000000, status: "succeeded", payment_intent: "pi_r1", billing_details: { email: "webhook@example.com" } } },
    });
    const params = Promise.resolve({ workspaceId: ws.id });
    const bad = await stripeHook(new Request("http://localhost/x", { method: "POST", body: payload, headers: { "stripe-signature": "t=1,v1=00" } }), { params });
    expect(bad.status).toBe(400);
    expect(await db.select().from(schema.revenueEvents)).toHaveLength(0);
    const sig = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret: "whsec_route" });
    const good = await stripeHook(new Request("http://localhost/x", { method: "POST", body: payload, headers: { "stripe-signature": sig } }), { params });
    expect(good.status).toBe(200);
    expect(await db.select().from(schema.revenueEvents)).toHaveLength(1);
  });

  it("reports require an API key", async () => {
    const url = "http://localhost/api/v1/reports/overview?start=2026-01-01&end=2026-12-31&model=linear";
    const params = { params: Promise.resolve({ report: "overview" }) };
    expect((await reports(new Request(url), params)).status).toBe(401);
    expect((await reports(new Request(url, { headers: { authorization: "Bearer al_wrong" } }), params)).status).toBe(401);
    const { key } = await createApiKey(ws.id, "test");
    const ok = await reports(new Request(url, { headers: { authorization: `Bearer ${key}` } }), params);
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ currency: "USD", model: "linear" });
    expect(body.data.revenueMinor).toBe(1234);
    const badParams = await reports(new Request("http://localhost/api/v1/reports/overview?start=nope", { headers: { authorization: `Bearer ${key}` } }), params);
    expect(badParams.status).toBe(400);
  });
});
