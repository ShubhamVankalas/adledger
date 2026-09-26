import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as revenueHook } from "@/app/api/v1/webhooks/[provider]/[workspaceId]/route";
import { cashfreeConnector, rawDecimal, verifyCashfreeSignature } from "@/lib/connectors/revenue/cashfree";
import { REVENUE_CONNECTORS } from "@/lib/connectors/revenue/index";
import { instamojoConnector, instamojoMac, verifyInstamojoMac } from "@/lib/connectors/revenue/instamojo";
import { phonepeConnector, verifyPhonepeAuthorization } from "@/lib/connectors/revenue/phonepe";
import type { ConnectionLike, RevenueConnector, WebhookRequest } from "@/lib/connectors/types";
import { schema } from "@/lib/db";
import { saveConnection } from "@/lib/settings";
import { setupWorkspace } from "./helpers";

const SECRET = "whsec_test_4f1c9a2b7e";
const raw = (p: string) => readFileSync(`fixtures/${p}`, "utf8");
const req = (rawBody: string, headers: Record<string, string>): WebhookRequest => ({
  rawBody,
  headers: new Headers(headers),
  url: "https://adledger.example.com/api/v1/webhooks/x",
});
const conn = (secrets: Record<string, string>, config: Record<string, string> = {}): ConnectionLike => ({ config, secrets });
const parse = (c: RevenueConnector, r: WebhookRequest) => c.parseWebhook(JSON.parse(r.rawBody), r);

afterEach(() => {
  vi.useRealTimers();
});

describe("Indian gateway registry entries", () => {
  it("registers Cashfree, Instamojo and PhonePe with secrets marked", () => {
    for (const provider of ["cashfree", "instamojo", "phonepe"]) {
      const c = REVENUE_CONNECTORS.find((x) => x.meta.provider === provider);
      expect(c, provider).toBeDefined();
      expect(c!.source).toBe(provider);
      expect(c!.meta).toMatchObject({ category: "revenue", status: "beta" });
      expect(c!.meta.steps.length).toBeGreaterThanOrEqual(3);
      expect(c!.meta.steps.some((s) => /sandbox|test mode/i.test(s))).toBe(true);
    }
    const secretFields = REVENUE_CONNECTORS.filter((c) => ["cashfree", "instamojo", "phonepe"].includes(c.source)).flatMap((c) =>
      c.meta.fields.filter((f) => f.secret).map((f) => `${c.source}.${f.name}`),
    );
    expect(secretFields).toEqual(["cashfree.clientSecret", "instamojo.privateSalt", "phonepe.webhookPassword"]);
  });
});

describe("Cashfree", () => {
  const cfConn = conn({ clientSecret: SECRET });
  const sign = (body: string, ts: string, secret = SECRET) => createHmac("sha256", secret).update(ts + body, "utf8").digest("base64");
  const signed = (body: string, ts = String(Date.now()), secret = SECRET) =>
    req(body, { "x-webhook-signature": sign(body, ts, secret), "x-webhook-timestamp": ts });

  it("verifies base64 HMAC-SHA256 of timestamp + raw body and rejects tampering / wrong secret / stale / missing", () => {
    const body = raw("cashfree/payment_success.json");
    expect(cashfreeConnector.verifyWebhook(signed(body), cfConn)).toBe(true);
    expect(cashfreeConnector.verifyWebhook({ ...signed(body), rawBody: body.replace("2499.00", "9499.00") }, cfConn)).toBe(false);
    expect(cashfreeConnector.verifyWebhook(signed(body, undefined, "wrong"), cfConn)).toBe(false);
    expect(cashfreeConnector.verifyWebhook(signed(body, String(Date.now() - 10 * 60_000)), cfConn)).toBe(false);
    expect(cashfreeConnector.verifyWebhook(req(body, {}), cfConn)).toBe(false);
    expect(cashfreeConnector.verifyWebhook(signed(body), conn({}))).toBe(false);
  });

  it("the signature covers the timestamp (it cannot be swapped for a fresh one)", () => {
    const body = raw("cashfree/payment_success.json");
    const now = 1790158649000;
    const sig = sign(body, String(now - 60 * 60_000));
    expect(verifyCashfreeSignature(body, String(now), sig, SECRET, now)).toBe(false);
    expect(verifyCashfreeSignature(body, String(now), sign(body, String(now)), SECRET, now)).toBe(true);
    // seconds-precision timestamps are tolerated too
    expect(verifyCashfreeSignature(body, String(now / 1000), sign(body, String(now / 1000)), SECRET, now)).toBe(true);
  });

  it("PAYMENT_SUCCESS_WEBHOOK -> payment in paise from the decimal rupee amount", () => {
    expect(parse(cashfreeConnector, signed(raw("cashfree/payment_success.json")))).toEqual([
      {
        type: "payment",
        externalId: "order_al_20260917_4f2a",
        amountMinor: 249900,
        currency: "INR",
        occurredAt: new Date("2026-09-17T06:17:22Z"),
        customer: {
          email: "rohan.mehta@example.com",
          name: "Rohan Mehta",
          phone: "9876501234",
          visitorId: "b7e3c1d2-5a6f-4e8b-9c0d-1f2a3b4c5d6e",
          externalCustomerId: "cust_rohan_1042",
        },
      },
    ]);
  });

  it("REFUND_STATUS_WEBHOOK SUCCESS -> refund linked to the order; other statuses ignored", () => {
    const body = raw("cashfree/refund_success.json");
    expect(parse(cashfreeConnector, signed(body))).toEqual([
      {
        type: "refund",
        externalId: "refund:refund_al_20260920_01",
        relatedExternalId: "order_al_20260917_4f2a",
        amountMinor: 50050,
        currency: "INR",
        occurredAt: new Date("2026-09-20T07:34:27Z"),
        customer: {},
      },
    ]);
    const cancelled = body.replace('"refund_status": "SUCCESS"', '"refund_status": "CANCELLED"');
    expect(parse(cashfreeConnector, signed(cancelled))).toEqual([]);
    const other = body.replace("REFUND_STATUS_WEBHOOK", "PAYMENT_FAILED_WEBHOOK");
    expect(parse(cashfreeConnector, signed(other))).toEqual([]);
  });

  it("reads amounts from the raw decimal literal, not a float", () => {
    expect(rawDecimal('{"payment_amount": 170.10}', "payment_amount", 170.1)).toBe("170.10");
    // a same-named key elsewhere (e.g. in order tags) with a different value is not trusted
    expect(rawDecimal('{"order_tags":{"payment_amount":"1"},"payment":{"payment_amount":19.99}}', "payment_amount", 19.99)).toBe("19.99");
    const body = raw("cashfree/payment_success.json").replace(/2499\.00/g, "0.29");
    expect(parse(cashfreeConnector, signed(body))[0].amountMinor).toBe(29);
  });
});

describe("Instamojo", () => {
  const imConn = conn({ privateSalt: SECRET });
  const body = raw("instamojo/payment_credit.txt");

  it("matches the documented MAC example (values sorted by key, joined with |, HMAC-SHA1)", () => {
    const fields: [string, string][] = [
      ["phone", "9821485060"],
      ["name", "Aditya Sengupta"],
      ["email", "aditya@instamojo.com"],
      ["amount", "123.45"],
    ];
    expect(instamojoMac(fields, "abcde")).toBe("6f905be9811990707f9d833da8e93bfebb23abbc");
  });

  it("verifies the mac field and rejects tampering / wrong salt / missing or duplicate mac", () => {
    expect(instamojoConnector.verifyWebhook(req(body, {}), imConn)).toBe(true);
    expect(instamojoConnector.verifyWebhook(req(body.replace("amount=1499.00", "amount=9499.00"), {}), imConn)).toBe(false);
    expect(instamojoConnector.verifyWebhook(req(body, {}), conn({ privateSalt: "other" }))).toBe(false);
    expect(instamojoConnector.verifyWebhook(req(body, {}), conn({}))).toBe(false);
    expect(verifyInstamojoMac(body.replace(/&mac=[0-9a-f]+/, ""), SECRET)).toBe(false);
    expect(verifyInstamojoMac(`${body}&mac=${"0".repeat(40)}`, SECRET)).toBe(false);
    // an injected extra field changes the signed message
    expect(verifyInstamojoMac(`${body}&zz=1`, SECRET)).toBe(false);
  });

  it("status=Credit -> payment in paise, dated on receipt; failed payments ignored", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T09:30:00Z"));
    expect(instamojoConnector.parseWebhook({}, req(body, {}))).toEqual([
      {
        type: "payment",
        externalId: "MOJO6917W05A12345678",
        amountMinor: 149900,
        currency: "INR",
        occurredAt: new Date("2026-09-21T09:30:00Z"),
        customer: { email: "kavya.iyer@example.com", name: "Kavya Iyer", phone: "+919812345670" },
      },
    ]);
    expect(instamojoConnector.parseWebhook({}, req(body.replace("status=Credit", "status=Failed"), {}))).toEqual([]);
  });
});

describe("PhonePe", () => {
  const ppConn = conn({ webhookPassword: "pp-hook-pass-9f2" }, { webhookUsername: "adledger" });
  const auth = (u = "adledger", p = "pp-hook-pass-9f2") => createHash("sha256").update(`${u}:${p}`).digest("hex");
  const signed = (body: string, header = auth()) => req(body, { Authorization: header });

  it("verifies Authorization = hex SHA256(username:password) and rejects wrong credentials / missing header", () => {
    const body = raw("phonepe/order_completed.json");
    expect(phonepeConnector.verifyWebhook(signed(body), ppConn)).toBe(true);
    expect(phonepeConnector.verifyWebhook(signed(body, auth().toUpperCase()), ppConn)).toBe(true);
    expect(phonepeConnector.verifyWebhook(signed(body, `SHA256 ${auth()}`), ppConn)).toBe(true);
    expect(phonepeConnector.verifyWebhook(signed(body, auth("adledger", "wrong")), ppConn)).toBe(false);
    expect(phonepeConnector.verifyWebhook(signed(body, auth("someone", "pp-hook-pass-9f2")), ppConn)).toBe(false);
    expect(phonepeConnector.verifyWebhook(req(body, {}), ppConn)).toBe(false);
    expect(phonepeConnector.verifyWebhook(signed(body), conn({}, { webhookUsername: "adledger" }))).toBe(false);
    expect(verifyPhonepeAuthorization("Basic YWRsZWRnZXI6eA==", "adledger", "x")).toBe(false);
  });

  it("checkout.order.completed -> payment in paise at the completed attempt's time", () => {
    expect(parse(phonepeConnector, signed(raw("phonepe/order_completed.json")))).toEqual([
      {
        type: "payment",
        externalId: "AL-ORD-20260917-0042",
        amountMinor: 149900,
        currency: "INR",
        occurredAt: new Date(1790158642000),
        customer: { visitorId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d" },
      },
    ]);
  });

  it("pg.refund.completed -> refund linked to the original order; failed / other events ignored", () => {
    const body = raw("phonepe/refund_completed.json");
    expect(parse(phonepeConnector, signed(body))).toEqual([
      {
        type: "refund",
        externalId: "refund:AL-RFD-20260920-0007",
        relatedExternalId: "AL-ORD-20260917-0042",
        amountMinor: 50000,
        currency: "INR",
        occurredAt: new Date(1790409867000),
        customer: {},
      },
    ]);
    const p = JSON.parse(body);
    expect(phonepeConnector.parseWebhook({ ...p, event: "pg.refund.failed", payload: { ...p.payload, state: "FAILED" } }, signed(body))).toEqual([]);
    const order = JSON.parse(raw("phonepe/order_completed.json"));
    expect(phonepeConnector.parseWebhook({ ...order, event: "checkout.order.failed", payload: { ...order.payload, state: "FAILED" } }, signed(body))).toEqual([]);
  });
});

describe("revenue webhook route with form-encoded bodies", () => {
  it("accepts a signed Instamojo form post and stores the payment once", async () => {
    const { db, ws } = await setupWorkspace({ reportingCurrency: "INR" });
    await saveConnection(ws.id, "instamojo", { mode: "live", secrets: { privateSalt: SECRET } }, db);
    const body = raw("instamojo/payment_credit.txt");
    const params = Promise.resolve({ provider: "instamojo", workspaceId: ws.id });
    const post = (b: string) =>
      revenueHook(new Request("http://localhost/x", { method: "POST", body: b, headers: { "content-type": "application/x-www-form-urlencoded" } }), { params });

    expect((await post(body.replace("amount=1499.00", "amount=1.00"))).status).toBe(401);
    const ok = await post(body);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: true, stored: 1 });
    await post(body); // retries are idempotent
    const rows = await db
      .select()
      .from(schema.revenueEvents)
      .where(and(eq(schema.revenueEvents.workspaceId, ws.id), eq(schema.revenueEvents.source, "instamojo")));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "MOJO6917W05A12345678", type: "payment", currency: "INR" });
    expect(Number(rows[0].amountMinor)).toBe(149900);
  });
});
