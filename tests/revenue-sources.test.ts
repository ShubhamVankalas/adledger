import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVENUE_CONNECTORS } from "@/lib/connectors/revenue/index";
import { lemonSqueezyConnector } from "@/lib/connectors/revenue/lemonsqueezy";
import { paddleConnector, verifyPaddleSignature } from "@/lib/connectors/revenue/paddle";
import { clearPaypalTokenCache, paypalConnector, paypalVisitorId } from "@/lib/connectors/revenue/paypal";
import { razorpayConnector } from "@/lib/connectors/revenue/razorpay";
import { shopifyConnector, shopifyGqlOrderToEvents } from "@/lib/connectors/revenue/shopify";
import { woocommerceConnector } from "@/lib/connectors/revenue/woocommerce";
import type { ConnectionLike, RevenueConnector, WebhookRequest } from "@/lib/connectors/types";

const SECRET = "whsec_test_4f1c9a2b7e";
const raw = (p: string) => readFileSync(`fixtures/${p}`, "utf8");
const hmac = (secret: string, data: string, enc: "base64" | "hex") => createHmac("sha256", secret).update(data, "utf8").digest(enc);
const req = (rawBody: string, headers: Record<string, string>): WebhookRequest => ({
  rawBody,
  headers: new Headers(headers),
  url: "https://adledger.example.com/api/v1/webhooks/x",
});
const conn = (secrets: Record<string, string> = { webhookSecret: SECRET }, config: Record<string, string> = {}): ConnectionLike => ({ config, secrets });
const parse = (c: RevenueConnector, r: WebhookRequest) => c.parseWebhook(JSON.parse(r.rawBody), r);
const tamper = (body: string) => body.replace(/"(\d)/, '"9$1');

describe("revenue connector registry", () => {
  it("registers beta revenue sources with secret fields marked", () => {
    const providers = REVENUE_CONNECTORS.map((c) => c.meta.provider);
    expect(providers.slice(0, 6)).toEqual(["shopify", "woocommerce", "paddle", "lemonsqueezy", "razorpay", "paypal"]);
    expect(new Set(providers).size).toBe(providers.length);
    for (const c of REVENUE_CONNECTORS) {
      expect(c.source).toBe(c.meta.provider);
      expect(c.meta).toMatchObject({ category: "revenue", status: "beta" });
      expect(c.meta.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.meta.steps.length).toBeGreaterThanOrEqual(3);
      expect(c.meta.steps.some((s) => s.includes("webhook URL"))).toBe(true);
      for (const f of c.meta.fields) if (/secret|token/i.test(f.name)) expect(f.secret).toBe(true);
    }
  });
});

describe("Shopify", () => {
  const signed = (body: string, topic: string, secret = SECRET) =>
    req(body, { "X-Shopify-Hmac-Sha256": hmac(secret, body, "base64"), "X-Shopify-Topic": topic });

  it("verifies the base64 HMAC and rejects tampering / wrong secret / missing header", () => {
    const body = raw("shopify/orders_paid.json");
    expect(shopifyConnector.verifyWebhook(signed(body, "orders/paid"), conn())).toBe(true);
    const good = signed(body, "orders/paid");
    expect(shopifyConnector.verifyWebhook({ ...good, rawBody: tamper(body) }, conn())).toBe(false);
    expect(shopifyConnector.verifyWebhook(signed(body, "orders/paid", "other"), conn())).toBe(false);
    expect(shopifyConnector.verifyWebhook(req(body, {}), conn())).toBe(false);
    expect(shopifyConnector.verifyWebhook(req(body, { "X-Shopify-Hmac-Sha256": "c2hvcnQ=" }), conn())).toBe(false);
  });

  it("orders/paid -> payment", () => {
    const [e, ...rest] = parse(shopifyConnector, signed(raw("shopify/orders_paid.json"), "orders/paid"));
    expect(rest).toHaveLength(0);
    expect(e).toEqual({
      type: "payment",
      externalId: "5871234567890",
      amountMinor: 10607,
      currency: "USD",
      occurredAt: new Date("2026-09-20T14:14:51Z"),
      customer: {
        email: "buyer@example.com",
        name: "Priya Shah",
        phone: "+14155550142",
        visitorId: "3f6c1b2a-9d4e-4f7a-8b1c-2e5d6a7b8c9d",
        externalCustomerId: "7012345678901",
      },
    });
  });

  it("refunds/create -> refund summing successful refund transactions", () => {
    const events = parse(shopifyConnector, signed(raw("shopify/refunds_create.json"), "refunds/create"));
    expect(events).toEqual([
      {
        type: "refund",
        externalId: "refund:929361465",
        relatedExternalId: "5871234567890",
        amountMinor: 4005,
        currency: "USD",
        occurredAt: new Date("2026-09-23T13:02:11Z"),
        customer: {},
      },
    ]);
  });

  it("ignores other topics and unpaid orders", () => {
    expect(parse(shopifyConnector, signed(raw("shopify/orders_paid.json"), "orders/create"))).toEqual([]);
    const pending = JSON.stringify({ ...JSON.parse(raw("shopify/orders_paid.json")), financial_status: "pending" });
    expect(parse(shopifyConnector, signed(pending, "orders/paid"))).toEqual([]);
  });

  it("maps GraphQL backfill orders to the same ids as webhooks", () => {
    const events = shopifyGqlOrderToEvents({
      legacyResourceId: "5871234567890",
      email: "buyer@example.com",
      createdAt: "2026-09-20T14:14:52Z",
      processedAt: "2026-09-20T14:14:51Z",
      displayFinancialStatus: "PARTIALLY_REFUNDED",
      totalPriceSet: { presentmentMoney: { amount: "106.07", currencyCode: "USD" } },
      customAttributes: [{ key: "_adledger_vid", value: "vid-123" }],
      customer: { legacyResourceId: "7012345678901", firstName: "Priya", lastName: "Shah" },
      refunds: [{ legacyResourceId: "929361465", createdAt: "2026-09-23T13:02:11Z", totalRefundedSet: { presentmentMoney: { amount: "40.05", currencyCode: "USD" } } }],
    });
    expect(events.map((e) => [e.type, e.externalId, e.amountMinor, e.relatedExternalId ?? null])).toEqual([
      ["payment", "5871234567890", 10607, null],
      ["refund", "refund:929361465", 4005, "5871234567890"],
    ]);
    expect(events[0].customer.visitorId).toBe("vid-123");
  });
});

describe("WooCommerce", () => {
  const signed = (body: string, topic = "order.updated", secret = SECRET) =>
    req(body, { "X-WC-Webhook-Signature": hmac(secret, body, "base64"), "X-WC-Webhook-Topic": topic });

  it("verifies the base64 HMAC and rejects tampering / wrong secret", () => {
    const body = raw("woocommerce/order_processing.json");
    expect(woocommerceConnector.verifyWebhook(signed(body), conn())).toBe(true);
    expect(woocommerceConnector.verifyWebhook({ ...signed(body), rawBody: tamper(body) }, conn())).toBe(false);
    expect(woocommerceConnector.verifyWebhook(signed(body, "order.updated", "nope"), conn())).toBe(false);
    expect(woocommerceConnector.verifyWebhook(signed(body), conn({}))).toBe(false);
  });

  it("processing order -> payment (GMT dates, guest customer)", () => {
    expect(parse(woocommerceConnector, signed(raw("woocommerce/order_processing.json"), "order.created"))).toEqual([
      {
        type: "payment",
        externalId: "7271",
        amountMinor: 5980,
        currency: "EUR",
        occurredAt: new Date("2026-09-21T12:03:11Z"),
        customer: {
          email: "lena.fischer@example.com",
          name: "Lena Fischer",
          phone: "+4930123456",
          visitorId: "9a8b7c6d-1111-4222-8333-944455556666",
          externalCustomerId: null,
        },
      },
    ]);
  });

  it("refunds[] -> one cumulative refund per order", () => {
    const events = parse(woocommerceConnector, signed(raw("woocommerce/order_refunded.json")));
    expect(events.map((e) => e.type)).toEqual(["payment", "refund"]);
    expect(events[1]).toMatchObject({
      externalId: "refunds:7271",
      relatedExternalId: "7271",
      amountMinor: 2758,
      currency: "EUR",
      occurredAt: new Date("2026-09-24T08:30:00Z"),
      customer: { email: "lena.fischer@example.com" },
    });
  });

  it("status refunded without refund lines refunds the full total; pending and other topics are ignored", () => {
    const base = JSON.parse(raw("woocommerce/order_processing.json"));
    const full = parse(woocommerceConnector, signed(JSON.stringify({ ...base, status: "refunded" })));
    expect(full.find((e) => e.type === "refund")?.amountMinor).toBe(5980);
    expect(parse(woocommerceConnector, signed(JSON.stringify({ ...base, status: "pending" })))).toEqual([]);
    expect(parse(woocommerceConnector, signed(raw("woocommerce/order_processing.json"), "order.deleted"))).toEqual([]);
  });
});

describe("backfills (mocked fetch)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("WooCommerce pages through /wp-json/wc/v3/orders with basic auth", async () => {
    const fetchMock = vi.fn(async () => Response.json([JSON.parse(raw("woocommerce/order_refunded.json"))], { headers: { "X-WP-TotalPages": "1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const events = await woocommerceConnector.backfill!(conn({ consumerKey: "ck_1", consumerSecret: "cs_1" }, { siteUrl: "shop.example.com/" }), { sinceMs: Date.parse("2026-07-01T00:00:00Z") });
    expect(events.map((e) => e.externalId)).toEqual(["7271", "refunds:7271"]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/shop\.example\.com\/wp-json\/wc\/v3\/orders\?after=2026-07-01T00%3A00%3A00\.000Z&/);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("ck_1:cs_1").toString("base64")}`);
  });

  it("Shopify queries GraphQL orders with the Admin API token", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          orders: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ legacyResourceId: "1", email: "a@example.com", createdAt: "2026-09-01T00:00:00Z", displayFinancialStatus: "PAID", totalPriceSet: { presentmentMoney: { amount: "12.5", currencyCode: "CAD" } }, refunds: [] }],
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events = await shopifyConnector.backfill!(conn({ accessToken: "shpat_x" }, { shopDomain: "acme" }), { sinceMs: 0 });
    expect(events).toMatchObject([{ type: "payment", externalId: "1", amountMinor: 1250, currency: "CAD", customer: { email: "a@example.com" } }]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://acme.myshopify.com/admin/api/2026-07/graphql.json");
    expect((init.headers as Record<string, string>)["X-Shopify-Access-Token"]).toBe("shpat_x");
  });
});

describe("Paddle", () => {
  const now = 1790000000;
  const signed = (body: string, ts = now, secret = SECRET) =>
    req(body, { "Paddle-Signature": `ts=${ts};h1=${hmac(secret, `${ts}:${body}`, "hex")}` });

  beforeEach(() => vi.useFakeTimers({ now: now * 1000 }));
  afterEach(() => vi.useRealTimers());

  it("verifies ts:body HMAC, supports rotated secrets, rejects tampering, wrong secret and stale timestamps", () => {
    const body = raw("paddle/transaction_completed.json");
    expect(paddleConnector.verifyWebhook(signed(body), conn())).toBe(true);
    expect(paddleConnector.verifyWebhook({ ...signed(body), rawBody: tamper(body) }, conn())).toBe(false);
    expect(paddleConnector.verifyWebhook(signed(body, now, "wrong"), conn())).toBe(false);
    expect(paddleConnector.verifyWebhook(signed(body, now - 301), conn())).toBe(false);
    expect(paddleConnector.verifyWebhook(signed(body, now - 120), conn())).toBe(true);
    const rotated = `ts=${now};h1=${hmac("old-secret", `${now}:${body}`, "hex")};h1=${hmac(SECRET, `${now}:${body}`, "hex")}`;
    expect(verifyPaddleSignature(body, rotated, SECRET, now * 1000)).toBe(true);
    expect(verifyPaddleSignature(body, `ts=${now}`, SECRET, now * 1000)).toBe(false);
  });

  it("transaction.completed -> payment from grand_total (lowest denomination)", () => {
    expect(parse(paddleConnector, signed(raw("paddle/transaction_completed.json")))).toEqual([
      {
        type: "payment",
        externalId: "txn_01j8x3sq0a1b2c3d4e5f6g7h8j",
        amountMinor: 65215,
        currency: "USD",
        occurredAt: new Date("2026-09-22T16:45:10.214Z"),
        customer: { visitorId: "5d4c3b2a-aaaa-4bbb-8ccc-dddd11112222", externalCustomerId: "ctm_01j8x3rz9m8n7b6v5c4x3z2l1k" },
      },
    ]);
  });

  it("approved refund adjustment -> refund; pending or credit adjustments are ignored", () => {
    const body = raw("paddle/adjustment_updated.json");
    expect(parse(paddleConnector, signed(body))).toEqual([
      {
        type: "refund",
        externalId: "adj_01j8zyx9w8v7u6t5s4r3q2p1o0",
        relatedExternalId: "txn_01j8x3sq0a1b2c3d4e5f6g7h8j",
        amountMinor: 19979,
        currency: "USD",
        occurredAt: new Date("2026-09-24T11:20:43.902Z"),
        customer: { externalCustomerId: "ctm_01j8x3rz9m8n7b6v5c4x3z2l1k" },
      },
    ]);
    const p = JSON.parse(body);
    expect(paddleConnector.parseWebhook({ ...p, data: { ...p.data, status: "pending_approval" } }, signed(body))).toEqual([]);
    expect(paddleConnector.parseWebhook({ ...p, data: { ...p.data, action: "credit" } }, signed(body))).toEqual([]);
    expect(paddleConnector.parseWebhook({ ...p, event_type: "subscription.updated" }, signed(body))).toEqual([]);
  });
});

describe("Lemon Squeezy", () => {
  const signed = (body: string, secret = SECRET) => req(body, { "X-Signature": hmac(secret, body, "hex"), "X-Event-Name": "x" });

  it("verifies the hex HMAC and rejects tampering / wrong secret", () => {
    const body = raw("lemonsqueezy/order_created.json");
    expect(lemonSqueezyConnector.verifyWebhook(signed(body), conn())).toBe(true);
    expect(lemonSqueezyConnector.verifyWebhook({ ...signed(body), rawBody: tamper(body) }, conn())).toBe(false);
    expect(lemonSqueezyConnector.verifyWebhook(signed(body, "wrong"), conn())).toBe(false);
    expect(lemonSqueezyConnector.verifyWebhook(req(body, { "X-Signature": "zz" }), conn())).toBe(false);
  });

  const customer = {
    email: "marcus.lee@example.com",
    name: "Marcus Lee",
    visitorId: "0f1e2d3c-4b5a-4968-8776-655443322110",
    externalCustomerId: "3890127",
  };

  it("order_created -> payment in cents", () => {
    expect(parse(lemonSqueezyConnector, signed(raw("lemonsqueezy/order_created.json")))).toEqual([
      { type: "payment", externalId: "order:4812339", amountMinor: 5880, currency: "GBP", occurredAt: new Date("2026-09-19T08:31:05Z"), customer },
    ]);
  });

  it("order_refunded -> cumulative refund", () => {
    expect(parse(lemonSqueezyConnector, signed(raw("lemonsqueezy/order_refunded.json")))).toEqual([
      {
        type: "refund",
        externalId: "refunds:order:4812339",
        relatedExternalId: "order:4812339",
        amountMinor: 2940,
        currency: "GBP",
        occurredAt: new Date("2026-09-25T13:12:40Z"),
        customer,
      },
    ]);
  });

  it("subscription_payment_success -> renewal payment; the initial invoice is skipped (order_created covers it)", () => {
    const body = raw("lemonsqueezy/subscription_payment_success.json");
    const [e] = parse(lemonSqueezyConnector, signed(body));
    expect(e).toMatchObject({ type: "payment", externalId: "invoice:1987654", amountMinor: 1800, currency: "GBP", customer });
    const p = JSON.parse(body);
    const initial = { ...p, data: { ...p.data, attributes: { ...p.data.attributes, billing_reason: "initial" } } };
    expect(lemonSqueezyConnector.parseWebhook(initial, signed(body))).toEqual([]);
    expect(lemonSqueezyConnector.parseWebhook({ ...p, meta: { ...p.meta, event_name: "subscription_updated" } }, signed(body))).toEqual([]);
  });
});

describe("Razorpay", () => {
  const signed = (body: string, secret = SECRET) => req(body, { "X-Razorpay-Signature": hmac(secret, body, "hex") });

  it("verifies the hex HMAC and rejects tampering / wrong secret", () => {
    const body = raw("razorpay/payment_captured.json");
    expect(razorpayConnector.verifyWebhook(signed(body), conn())).toBe(true);
    expect(razorpayConnector.verifyWebhook({ ...signed(body), rawBody: tamper(body) }, conn())).toBe(false);
    expect(razorpayConnector.verifyWebhook(signed(body, "wrong"), conn())).toBe(false);
  });

  const customer = {
    email: "ananya.rao@example.com",
    phone: "+919876543210",
    visitorId: "c0ffee00-1234-4567-89ab-cdef01234567",
    externalCustomerId: "cust_Q9a0Zz9Yy8Xx7W",
  };

  it("payment.captured -> payment in paise", () => {
    expect(parse(razorpayConnector, signed(raw("razorpay/payment_captured.json")))).toEqual([
      { type: "payment", externalId: "pay_Q9aB3cD4eF5gH6", amountMinor: 249900, currency: "INR", occurredAt: new Date(1790150400 * 1000), customer },
    ]);
  });

  it("refund.processed -> refund linked to the payment (empty-array notes tolerated)", () => {
    const body = raw("razorpay/refund_processed.json");
    expect(parse(razorpayConnector, signed(body))).toEqual([
      {
        type: "refund",
        externalId: "rfnd_QAb1Cd2Ef3Gh4I",
        relatedExternalId: "pay_Q9aB3cD4eF5gH6",
        amountMinor: 50000,
        currency: "INR",
        occurredAt: new Date(1790409600 * 1000),
        customer,
      },
    ]);
    const p = JSON.parse(body);
    expect(razorpayConnector.parseWebhook({ ...p, event: "refund.created" }, signed(body))).toHaveLength(1);
    expect(razorpayConnector.parseWebhook({ ...p, event: "payment.authorized" }, signed(body))).toEqual([]);
  });
});

describe("PayPal", () => {
  const paypalConn = conn({ clientSecret: "pp-secret" }, { clientId: "pp-client", webhookId: "8PT597110X687430LKGECATA", environment: "sandbox" });
  const headers = {
    "PAYPAL-AUTH-ALGO": "SHA256withRSA",
    "PAYPAL-CERT-URL": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-a5cafa77",
    "PAYPAL-TRANSMISSION-ID": "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
    "PAYPAL-TRANSMISSION-SIG": "lmI95Jx3Y9nhR5SJWlHVIWpg4AgFk7n9bCHSRxbrd8A9zrhdu2rMyFrmz+Zjh3s3boXB07VXCXUZy/UFzUlnGJn0wDugt7FlSvdKeIJenLRemUxYCPVoEZzg9VFNqOa48gMkvF+XTpxBeUx/kWy6B5cp7GkT2+pOowfRK7OaynuxUoKW3JcMWw272VKjLTtTAShncla7tGF+55rxyt2KNZIIqxNMJ48RDZheGU5w1npu9dZHnPgTXB9iomeVRoD8O/jhRpnKsGrDschyNdkeh81BJJMH4Ctc6lnCCquoP/GzCzz33MMsNdid7vL/NIWaCsekQpW26FpWPi/tfj8nLA==",
    "PAYPAL-TRANSMISSION-TIME": "2026-09-21T19:14:10Z",
  };
  let fetchMock: ReturnType<typeof vi.fn>;
  const stubPaypal = (status: "SUCCESS" | "FAILURE") => {
    fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "A21AA-test-token", expires_in: 32400 });
      if (url.endsWith("/v1/notifications/verify-webhook-signature")) return Response.json({ verification_status: status });
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
  };
  beforeEach(() => clearPaypalTokenCache());
  afterEach(() => vi.unstubAllGlobals());

  it("verifies via PayPal's verify-webhook-signature API (sandbox), passing the raw event unchanged", async () => {
    stubPaypal("SUCCESS");
    const body = raw("paypal/payment_capture_completed.json");
    expect(await paypalConnector.verifyWebhook(req(body, headers), paypalConn)).toBe(true);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    expect(tokenInit.headers.Authorization).toBe(`Basic ${Buffer.from("pp-client:pp-secret").toString("base64")}`);
    const [verifyUrl, verifyInit] = fetchMock.mock.calls[1];
    expect(verifyUrl).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    expect(verifyInit.headers.Authorization).toBe("Bearer A21AA-test-token");
    const sent = JSON.parse(verifyInit.body);
    expect(sent).toMatchObject({
      auth_algo: "SHA256withRSA",
      transmission_id: headers["PAYPAL-TRANSMISSION-ID"],
      transmission_sig: headers["PAYPAL-TRANSMISSION-SIG"],
      transmission_time: headers["PAYPAL-TRANSMISSION-TIME"],
      cert_url: headers["PAYPAL-CERT-URL"],
      webhook_id: "8PT597110X687430LKGECATA",
    });
    expect(sent.webhook_event).toEqual(JSON.parse(body));
    expect(verifyInit.body.endsWith(`"webhook_event":${body}}`)).toBe(true);
  });

  it("rejects when PayPal says FAILURE, when headers are missing, or when PayPal is unreachable", async () => {
    const body = raw("paypal/payment_capture_completed.json");
    stubPaypal("FAILURE");
    expect(await paypalConnector.verifyWebhook(req(tamper(body), headers), paypalConn)).toBe(false);
    expect(await paypalConnector.verifyWebhook(req(body, headers), conn({ clientSecret: "wrong" }, { clientId: "pp-client" }))).toBe(false);
    const { ["PAYPAL-TRANSMISSION-SIG"]: _sig, ...noSig } = headers;
    void _sig;
    const calls = fetchMock.mock.calls.length;
    expect(await paypalConnector.verifyWebhook(req(body, noSig), paypalConn)).toBe(false);
    expect(fetchMock.mock.calls.length).toBe(calls);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    clearPaypalTokenCache();
    expect(await paypalConnector.verifyWebhook(req(body, headers), paypalConn)).toBe(false);
  });

  it("uses the live API unless environment is sandbox", async () => {
    stubPaypal("SUCCESS");
    const live = conn({ clientSecret: "pp-secret" }, { clientId: "pp-client", webhookId: "WH1" });
    await paypalConnector.verifyWebhook(req(raw("paypal/payment_capture_completed.json"), headers), live);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api-m.paypal.com/v1/oauth2/token");
  });

  it("PAYMENT.CAPTURE.COMPLETED -> payment from decimal string", () => {
    const body = raw("paypal/payment_capture_completed.json");
    expect(parse(paypalConnector, req(body, headers))).toEqual([
      {
        type: "payment",
        externalId: "42311647XV020574X",
        amountMinor: 12999,
        currency: "USD",
        occurredAt: new Date("2026-09-21T19:14:07Z"),
        customer: {
          email: "jordan.miles@example.com",
          name: "Jordan Miles",
          visitorId: "7e6d5c4b-3a29-4817-9605-f4e3d2c1b0a9",
          externalCustomerId: "QYR5Z8XDVJNXQ",
        },
      },
    ]);
  });

  it("PAYMENT.CAPTURE.REFUNDED -> refund linked to the capture via the `up` link", () => {
    const body = raw("paypal/payment_capture_refunded.json");
    expect(parse(paypalConnector, req(body, headers))).toEqual([
      {
        type: "refund",
        externalId: "1JU08902781691411",
        relatedExternalId: "42311647XV020574X",
        amountMinor: 4000,
        currency: "USD",
        occurredAt: new Date("2026-09-25T08:02:38Z"),
        customer: { email: null, name: null, visitorId: "7e6d5c4b-3a29-4817-9605-f4e3d2c1b0a9", externalCustomerId: null },
      },
    ]);
    const p = JSON.parse(body);
    const viaSupplementary = { ...p, resource: { ...p.resource, links: [], supplementary_data: { related_ids: { capture_id: "CAP-2" } } } };
    expect(paypalConnector.parseWebhook(viaSupplementary, req(body, headers))[0].relatedExternalId).toBe("CAP-2");
    expect(paypalConnector.parseWebhook({ ...p, event_type: "PAYMENT.CAPTURE.PENDING" }, req(body, headers))).toEqual([]);
  });

  it("reads the visitor id from custom_id in several shapes", () => {
    expect(paypalVisitorId("adledger_vid=abc12345")).toBe("abc12345");
    expect(paypalVisitorId('{"adledger_vid":"abc-123-xyz"}')).toBe("abc-123-xyz");
    expect(paypalVisitorId("7e6d5c4b-3a29-4817-9605-f4e3d2c1b0a9")).toBe("7e6d5c4b-3a29-4817-9605-f4e3d2c1b0a9");
    expect(paypalVisitorId('{"order":"42"}')).toBeNull();
    expect(paypalVisitorId(undefined)).toBeNull();
  });
});
