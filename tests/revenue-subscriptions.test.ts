import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { POST as revenueHook } from "@/app/api/v1/webhooks/[provider]/[workspaceId]/route";
import { getRevenueConnector } from "@/lib/connectors/registry";
import { schema } from "@/lib/db";
import { saveConnection } from "@/lib/settings";
import { setupWorkspace } from "./helpers";
import { chargebeeConnector } from "@/lib/connectors/revenue/chargebee";
import { gumroadConnector } from "@/lib/connectors/revenue/gumroad";
import { REVENUE_CONNECTORS } from "@/lib/connectors/revenue/index";
import { recurlyConnector, recurlyCurrency } from "@/lib/connectors/revenue/recurly";
import { verifyBasicAuth, verifyUrlToken } from "@/lib/connectors/revenue/webhook-auth";
import type { ConnectionLike, WebhookRequest } from "@/lib/connectors/types";

const raw = (p: string) => readFileSync(`fixtures/${p}`, "utf8");
const BASE = "https://adledger.example.com/api/v1/webhooks";
const req = (rawBody: string, headers: Record<string, string> = {}, url = `${BASE}/x/ws`): WebhookRequest => ({
  rawBody,
  headers: new Headers(headers),
  url,
});
const basic = (user: string, pass: string) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });
const USER = "adledger";
const PASS = "pw_9Xq2LmV7tR4sK8nB";
const authConn: ConnectionLike = { config: { webhookUsername: USER }, secrets: { webhookPassword: PASS } };
/** What the webhook route hands parseWebhook: JSON when the body parses, else the raw string. */
const payloadOf = (body: string) => {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
};

describe("subscription revenue connectors registry", () => {
  it("registers Chargebee, Recurly and Gumroad with secret fields marked", () => {
    for (const c of [chargebeeConnector, recurlyConnector, gumroadConnector]) {
      expect(REVENUE_CONNECTORS).toContain(c);
      expect(getRevenueConnector(c.meta.provider)).toBe(c);
      expect(c.source).toBe(c.meta.provider);
      expect(c.meta).toMatchObject({ category: "revenue", status: "beta" });
      expect(c.meta.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.meta.steps.length).toBeGreaterThanOrEqual(3);
      expect(c.meta.steps.length).toBeLessThanOrEqual(4);
      expect(c.meta.steps.some((s) => s.includes("webhook URL"))).toBe(true);
      expect(c.meta.docsUrl).toMatch(/^https:\/\//);
      for (const f of c.meta.fields) if (/secret|token|password/i.test(f.name)) expect(f.secret).toBe(true);
    }
  });
});

describe("webhook-auth helpers", () => {
  it("basic auth accepts only the exact credentials", () => {
    expect(verifyBasicAuth(new Headers(basic(USER, PASS)), USER, PASS)).toBe(true);
    expect(verifyBasicAuth(new Headers(basic(USER, `${PASS}x`)), USER, PASS)).toBe(false);
    expect(verifyBasicAuth(new Headers(basic("other", PASS)), USER, PASS)).toBe(false);
    expect(verifyBasicAuth(new Headers({ Authorization: `Bearer ${PASS}` }), USER, PASS)).toBe(false);
    expect(verifyBasicAuth(new Headers(), USER, PASS)).toBe(false);
    // Unconfigured credentials never match, not even an empty header.
    expect(verifyBasicAuth(new Headers(basic("", "")), "", "")).toBe(false);
    expect(verifyBasicAuth(new Headers(basic(USER, PASS)), USER, undefined)).toBe(false);
  });

  it("URL token accepts only the exact token", () => {
    expect(verifyUrlToken(`${BASE}/g/ws?token=tok_abc123`, "tok_abc123")).toBe(true);
    expect(verifyUrlToken(`${BASE}/g/ws?token=tok_abc12`, "tok_abc123")).toBe(false);
    expect(verifyUrlToken(`${BASE}/g/ws`, "tok_abc123")).toBe(false);
    expect(verifyUrlToken(`${BASE}/g/ws?token=`, "")).toBe(false);
    expect(verifyUrlToken("not a url", "tok_abc123")).toBe(false);
  });
});

describe("Chargebee", () => {
  it("verifies basic auth and rejects a wrong password / missing header", () => {
    const body = raw("chargebee/payment_succeeded.json");
    expect(chargebeeConnector.verifyWebhook(req(body, basic(USER, PASS)), authConn)).toBe(true);
    expect(chargebeeConnector.verifyWebhook(req(body, basic(USER, "wrong")), authConn)).toBe(false);
    expect(chargebeeConnector.verifyWebhook(req(body), authConn)).toBe(false);
    expect(chargebeeConnector.verifyWebhook(req(body, basic(USER, PASS)), { config: {}, secrets: {} })).toBe(false);
  });

  it("payment_succeeded -> payment", () => {
    const r = req(raw("chargebee/payment_succeeded.json"));
    expect(chargebeeConnector.parseWebhook(payloadOf(r.rawBody), r)).toEqual([
      {
        type: "payment",
        externalId: "txn_AzZTQnUQ8bV2i1rKa",
        amountMinor: 4900,
        currency: "USD",
        occurredAt: new Date(1758873610 * 1000),
        customer: {
          email: "priya.raman@example.com",
          name: "Priya Raman",
          phone: "+14155550142",
          visitorId: "5d7e9a1b-2c3f-4a6b-8d9e-0f1a2b3c4d5e",
          externalCustomerId: "AzZTQnUQ8bUx81rJZ",
        },
      },
    ]);
  });

  it("payment_refunded -> refund linked to the refunded payment", () => {
    const r = req(raw("chargebee/payment_refunded.json"));
    const [e, ...rest] = chargebeeConnector.parseWebhook(payloadOf(r.rawBody), r);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      type: "refund",
      externalId: "txn_AzZTQnUQ8cX7k2sLb",
      relatedExternalId: "txn_AzZTQnUQ8bV2i1rKa",
      amountMinor: 1500,
      currency: "USD",
      occurredAt: new Date(1759132838 * 1000),
    });
  });

  it("ignores failed transactions and other events", () => {
    const p = JSON.parse(raw("chargebee/payment_succeeded.json"));
    p.content.transaction.status = "failure";
    expect(chargebeeConnector.parseWebhook(p, req(""))).toEqual([]);
    const other = JSON.parse(raw("chargebee/payment_succeeded.json"));
    other.event_type = "subscription_created";
    expect(chargebeeConnector.parseWebhook(other, req(""))).toEqual([]);
  });
});

describe("Recurly", () => {
  it("verifies basic auth and rejects a wrong password / missing header", () => {
    const body = raw("recurly/successful_payment_notification.xml");
    expect(recurlyConnector.verifyWebhook(req(body, basic(USER, PASS)), authConn)).toBe(true);
    expect(recurlyConnector.verifyWebhook(req(body, basic(USER, "nope")), authConn)).toBe(false);
    expect(recurlyConnector.verifyWebhook(req(body), authConn)).toBe(false);
  });

  it("successful_payment_notification -> payment (XML entities decoded, nil fields null)", () => {
    const r = req(raw("recurly/successful_payment_notification.xml"));
    expect(recurlyConnector.parseWebhook(payloadOf(r.rawBody), r)).toEqual([
      {
        type: "payment",
        externalId: "6a1f3c9e2b7d4e58a0c1f2e3d4b5a697",
        amountMinor: 9900,
        currency: "USD",
        occurredAt: new Date("2026-09-24T14:05:31Z"),
        customer: { email: "jonas.berg@example.com", name: "Jonas Berg", phone: null, externalCustomerId: "acct-7731" },
      },
    ]);
  });

  it("successful_refund_notification -> refund, in the currency from the URL", () => {
    const r = req(raw("recurly/successful_refund_notification.xml"), {}, `${BASE}/recurly/ws?currency=eur`);
    const [e, ...rest] = recurlyConnector.parseWebhook(payloadOf(r.rawBody), r);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      type: "refund",
      externalId: "6a2b7e41c3d94f60b1a2c3d4e5f60718",
      relatedExternalId: null,
      amountMinor: 2500,
      currency: "EUR",
      occurredAt: new Date("2026-09-26T09:12:07Z"),
    });
    expect(recurlyCurrency(`${BASE}/recurly/ws?currency=euro`)).toBe("USD");
  });

  it("ignores declined payments and other notifications", () => {
    const declined = raw("recurly/successful_payment_notification.xml")
      .replace(/successful_payment_notification/g, "failed_payment_notification")
      .replace("<status>success</status>", "<status>declined</status>");
    expect(recurlyConnector.parseWebhook(declined, req(declined))).toEqual([]);
    const notSuccess = raw("recurly/successful_payment_notification.xml").replace("<status>success</status>", "<status>void</status>");
    expect(recurlyConnector.parseWebhook(notSuccess, req(notSuccess))).toEqual([]);
    expect(recurlyConnector.parseWebhook({}, req('{"id":"rafhdbbf41mc","object_type":"payment","event_type":"succeeded"}'))).toEqual([]);
  });

  it("void_payment_notification -> full refund linked to the voided payment", () => {
    const r = req(raw("recurly/void_payment_notification.xml"));
    const [e, ...rest] = recurlyConnector.parseWebhook(payloadOf(r.rawBody), r);
    expect(rest).toHaveLength(0);
    expect(e).toMatchObject({
      type: "refund",
      externalId: "void:6a1f3c9e2b7d4e58a0c1f2e3d4b5a697",
      relatedExternalId: "6a1f3c9e2b7d4e58a0c1f2e3d4b5a697",
      amountMinor: 9900,
      currency: "USD",
    });
    const notVoid = r.rawBody.replace("<status>void</status>", "<status>success</status>");
    expect(recurlyConnector.parseWebhook(notVoid, req(notVoid))).toEqual([]);
  });

  it("a self-closing nil element does not swallow a later element", () => {
    const body = raw("recurly/successful_payment_notification.xml")
      .replace("<email>jonas.berg@example.com</email>", "<email />")
      .replace('<phone nil="true"></phone>', '<phone nil="true"/>\n    <address><email>billing@example.com</email><phone>+4930123</phone></address>');
    const [e] = recurlyConnector.parseWebhook(body, req(body));
    expect(e.customer).toMatchObject({ email: null, phone: null, name: "Jonas Berg" });
  });
});

describe("Gumroad", () => {
  const TOKEN = "gr_tok_4Kd9Qm2xV7";
  const conn = (config: Record<string, string> = {}): ConnectionLike => ({ config, secrets: { webhookToken: TOKEN } });
  const ping = (body: string, token = TOKEN) => req(body, { "Content-Type": "application/x-www-form-urlencoded" }, `${BASE}/gumroad/ws?token=${token}`);

  it("verifies the URL token (and optional seller id)", () => {
    const body = raw("gumroad/sale.txt");
    expect(gumroadConnector.verifyWebhook(ping(body), conn())).toBe(true);
    expect(gumroadConnector.verifyWebhook(ping(body, "wrong"), conn())).toBe(false);
    expect(gumroadConnector.verifyWebhook(req(body, {}, `${BASE}/gumroad/ws`), conn())).toBe(false);
    expect(gumroadConnector.verifyWebhook(ping(body), { config: {}, secrets: {} })).toBe(false);
    expect(gumroadConnector.verifyWebhook(ping(body), conn({ sellerId: "wKFz8Qe2vN0bXyT1cR3hJg==" }))).toBe(true);
    expect(gumroadConnector.verifyWebhook(ping(body), conn({ sellerId: "someoneElse==" }))).toBe(false);
  });

  it("sale -> payment in USD cents with the visitor id from url_params", () => {
    const r = ping(raw("gumroad/sale.txt"));
    expect(gumroadConnector.parseWebhook(payloadOf(r.rawBody), r)).toEqual([
      {
        type: "payment",
        externalId: "Xk3PqR8sT2uV5wY1zA7bCd==",
        amountMinor: 2900,
        currency: "USD",
        occurredAt: new Date("2026-09-25T18:42:07Z"),
        customer: {
          email: "lena.fischer@example.com",
          name: "Lena Fischer",
          visitorId: "a3c5e7f9-1b2d-4f6a-8c0e-2d4f6a8c0e1b",
          externalCustomerId: "6120934812745",
        },
      },
    ]);
  });

  it("reads the JSON content type the same way (and ignores the display `currency`)", () => {
    const body = raw("gumroad/sale.json");
    const r = ping(body);
    expect(gumroadConnector.parseWebhook(payloadOf(body), r)).toEqual(gumroadConnector.parseWebhook(payloadOf(raw("gumroad/sale.txt")), ping(raw("gumroad/sale.txt"))));
    expect(gumroadConnector.parseWebhook(payloadOf(body), r)[0]).toMatchObject({ currency: "USD", amountMinor: 2900, customer: { visitorId: "a3c5e7f9-1b2d-4f6a-8c0e-2d4f6a8c0e1b" } });
    expect(gumroadConnector.verifyWebhook(r, conn({ sellerId: "wKFz8Qe2vN0bXyT1cR3hJg==" }))).toBe(true);
    expect(gumroadConnector.verifyWebhook(r, conn({ sellerId: "someoneElse==" }))).toBe(false);
  });

  it("refund post -> only a full refund referencing the sale", () => {
    const r = ping(raw("gumroad/refund.txt"));
    const events = gumroadConnector.parseWebhook(payloadOf(r.rawBody), r);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "refund",
      externalId: "refund:Xk3PqR8sT2uV5wY1zA7bCd==",
      relatedExternalId: "Xk3PqR8sT2uV5wY1zA7bCd==",
      amountMinor: 2900,
      currency: "USD",
    });
    expect(events[0].occurredAt).toBeInstanceOf(Date);
    // A refund post for a sale that is not (fully) refunded records nothing.
    const partial = r.rawBody.replace("refunded=true", "refunded=false");
    expect(gumroadConnector.parseWebhook(partial, ping(partial))).toEqual([]);
  });

  it("a sale ping of an already refunded sale records the payment and the refund", () => {
    const body = raw("gumroad/sale.txt").replace("refunded=false", "refunded=true");
    expect(gumroadConnector.parseWebhook(body, ping(body)).map((e) => [e.type, e.externalId])).toEqual([
      ["payment", "Xk3PqR8sT2uV5wY1zA7bCd=="],
      ["refund", "refund:Xk3PqR8sT2uV5wY1zA7bCd=="],
    ]);
  });

  it("ignores pre-order authorizations and malformed prices", () => {
    const pre = `${raw("gumroad/sale.txt").trim()}&is_preorder_authorization=true`;
    expect(gumroadConnector.parseWebhook(pre, ping(pre))).toEqual([]);
    const float = raw("gumroad/sale.txt").replace("price=2900", "price=29.00");
    expect(gumroadConnector.parseWebhook(float, ping(float))).toEqual([]);
  });
});

describe("webhook route with non-JSON bodies", () => {
  it("rejects unconnected / unauthenticated posts and stores linked payments and refunds", async () => {
    const { db, ws } = await setupWorkspace();
    const post = (provider: string, body: string, headers: Record<string, string> = {}, query = "") =>
      revenueHook(new Request(`http://localhost/api/v1/webhooks/${provider}/${ws.id}${query}`, { method: "POST", body, headers }), {
        params: Promise.resolve({ provider, workspaceId: ws.id }),
      });
    const rows = (source: string) =>
      db.select().from(schema.revenueEvents).where(and(eq(schema.revenueEvents.workspaceId, ws.id), eq(schema.revenueEvents.source, source)));

    // Not connected in this workspace.
    expect((await post("recurly", raw("recurly/successful_payment_notification.xml"), basic(USER, PASS))).status).toBe(400);

    await saveConnection(ws.id, "recurly", { mode: "live", config: { webhookUsername: USER }, secrets: { webhookPassword: PASS } }, db);
    await saveConnection(ws.id, "chargebee", { mode: "live", config: { webhookUsername: USER }, secrets: { webhookPassword: PASS } }, db);
    await saveConnection(ws.id, "gumroad", { mode: "live", secrets: { webhookToken: "gr_route_tok_1" } }, db);

    const xml = { "Content-Type": "application/xml" };
    expect((await post("recurly", raw("recurly/successful_payment_notification.xml"), xml)).status).toBe(401);
    expect((await post("recurly", raw("recurly/successful_payment_notification.xml"), { ...xml, ...basic(USER, "nope") })).status).toBe(401);
    expect(await rows("recurly")).toHaveLength(0);
    const ok = await post("recurly", raw("recurly/successful_payment_notification.xml"), { ...xml, ...basic(USER, PASS) }, "?currency=EUR");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ stored: 1 });
    await post("recurly", raw("recurly/void_payment_notification.xml"), { ...xml, ...basic(USER, PASS) }, "?currency=EUR");
    const recurly = await rows("recurly");
    expect(recurly.map((r) => [r.type, Number(r.amountMinor), r.currency, r.relatedExternalId]).sort()).toEqual([
      ["payment", 9900, "EUR", null],
      ["refund", -9900, "EUR", "6a1f3c9e2b7d4e58a0c1f2e3d4b5a697"],
    ]);

    const json = { "Content-Type": "application/json" };
    await post("chargebee", raw("chargebee/payment_succeeded.json"), { ...json, ...basic(USER, PASS) });
    await post("chargebee", raw("chargebee/payment_refunded.json"), { ...json, ...basic(USER, PASS) });
    const chargebee = await rows("chargebee");
    expect(chargebee.map((r) => [r.type, Number(r.amountMinor), r.relatedExternalId]).sort()).toEqual([
      ["payment", 4900, null],
      ["refund", -1500, "txn_AzZTQnUQ8bV2i1rKa"],
    ]);

    const form = { "Content-Type": "application/x-www-form-urlencoded" };
    expect((await post("gumroad", raw("gumroad/sale.txt"), form, "?token=wrong")).status).toBe(401);
    expect((await post("gumroad", raw("gumroad/sale.txt"), form, "?token=gr_route_tok_1")).status).toBe(200);
    // A retried sale ping and the refund post: no duplicates, net zero, one contact.
    await post("gumroad", raw("gumroad/sale.txt"), form, "?token=gr_route_tok_1");
    await post("gumroad", raw("gumroad/refund.txt"), form, "?token=gr_route_tok_1");
    const gumroad = await rows("gumroad");
    expect(gumroad).toHaveLength(2);
    expect(gumroad.reduce((s, r) => s + Number(r.amountMinor), 0)).toBe(0);
    expect(gumroad[0].contactId).not.toBeNull();
    expect(new Set(gumroad.map((r) => r.contactId)).size).toBe(1);
  });
});
