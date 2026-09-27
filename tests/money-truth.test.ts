import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { recomputeAttribution } from "@/lib/attribution";
import { rows, schema, type DB } from "@/lib/db";
import type { AttributionModel, Channel, Platform } from "@/lib/db/schema";
import {
  acquisitionLedger,
  allocateAdDays,
  bpsToPercent,
  clearUnitEconomics,
  contactCosts,
  contactReceipt,
  getUnitEconomics,
  isTooEarly,
  parsePercent,
  COST_BASES,
  paybackOf,
  pauseDraftCsv,
  pauseDrafts,
  paymentReceipt,
  profitLedger,
  profitRows,
  receiptList,
  saveUnitEconomics,
  timeToMoney,
  tooEarlyRule,
} from "@/lib/reports-profit";
import { biggestGap, truthGap } from "@/lib/reports-trust";
import type { Workspace } from "@/lib/settings";
import { upsertAdRows } from "@/lib/sync";
import { setupWorkspace } from "./helpers";

// A hand-checkable ledger (USD, UTC, 30-day window, linear model unless noted):
//
//   Meta ad "Prospecting"  Jul 1  spend $100, 10 clicks  (claims 5 conversions worth $300)
//   Google ad "Brand"      Jul 3  spend  $50,  5 clicks  (claims 2 conversions, no value)
//
//   Alice  clicks Meta Jul 1 10:00, Google Jul 3 10:00  → pays $90 Jul 5 12:00
//   Bob    clicks Meta Jul 1 12:00                      → pays $60 Jul 12 12:00 and $60 Aug 12
//   Carol  no clicks                                    → pays $40 Aug 20 (unattributed)
//
// Customer credit (linear): Alice ½ Meta + ½ Google, Bob 1 Meta.
//   Meta Jul 1:   $10/click → Alice ½ click $5, Bob 1 click $10, 8.5 unsold clicks $85
//   Google Jul 3: $10/click → Alice ½ click $5, 4.5 unsold clicks $45
//   Alice cost $10, Bob cost $10, unallocated $130: $150 of spend in total.

let db: DB;
let ws: Workspace;
const campaignId: Record<string, string> = {};
const adId: Record<string, string> = {};
const contactId: Record<string, string> = {};
const paymentId: Record<string, string> = {};

const adRow = (platform: Platform, key: string, name: string, date: string, spendMinor: number, clicks: number, conversions: string, valueMinor: number | null) => ({
  platform,
  account: { externalId: `acc-${key}`, name: `${name} account`, currency: "USD", timezone: null },
  campaign: { externalId: `c-${key}`, name, status: "active", objective: null },
  adGroup: { externalId: `g-${key}`, name: `${name} group`, status: null },
  ad: { externalId: `a-${key}`, name: `${name} ad`, status: null },
  date,
  spendMinor,
  impressions: 1000,
  clicks,
  conversions,
  conversionValueMinor: valueMinor,
});

async function person(
  w: Workspace,
  name: string,
  touches: { at: string; key: "meta" | "google" }[],
  payments: { id: string; at: string; amount: number }[],
  ids: { campaign: Record<string, string>; ad: Record<string, string> } = { campaign: campaignId, ad: adId },
) {
  const [c] = await db
    .insert(schema.contacts)
    .values({ workspaceId: w.id, email: `${name.toLowerCase()}@example.com`, name, firstSeenAt: new Date("2026-07-01T00:00:00Z"), lifecycle: "customer" })
    .returning();
  if (touches.length) {
    const [v] = await db
      .insert(schema.visitors)
      .values({ workspaceId: w.id, anonymousId: `vid-${name}-${w.id}`, firstSeenAt: new Date(touches[0].at), lastSeenAt: new Date(touches.at(-1)!.at), contactId: c.id })
      .returning();
    for (const t of touches) {
      const channel: Channel = t.key === "meta" ? "paid_social" : "paid_search";
      await db
        .insert(schema.touchpoints)
        .values({ workspaceId: w.id, visitorId: v.id, occurredAt: new Date(t.at), channel, platform: t.key, campaignId: ids.campaign[t.key], adId: ids.ad[t.key] });
    }
  }
  for (const p of payments) {
    const [r] = await db
      .insert(schema.revenueEvents)
      .values({ workspaceId: w.id, contactId: c.id, source: "api", externalId: p.id, type: "payment", amountMinor: p.amount, currency: "USD", occurredAt: new Date(p.at) })
      .returning();
    paymentId[p.id] = r.id;
  }
  return c.id;
}

const Q3 = { start: "2026-07-01", end: "2026-09-30" };
const MODELS: AttributionModel[] = ["first_touch", "last_touch", "linear"];

beforeAll(async () => {
  ({ db, ws } = await setupWorkspace());
  await upsertAdRows(db, ws.id, [
    adRow("meta", "meta", "Prospecting", "2026-07-01", 10_000, 10, "5", 30_000),
    adRow("google", "google", "Brand", "2026-07-03", 5_000, 5, "2", null),
  ]);
  for (const c of await db.select().from(schema.campaigns)) campaignId[c.platform] = c.id;
  for (const a of await db.select().from(schema.ads)) adId[a.platform] = a.id;
  contactId.alice = await person(ws, "Alice", [
    { at: "2026-07-01T10:00:00Z", key: "meta" },
    { at: "2026-07-03T10:00:00Z", key: "google" },
  ], [{ id: "a1", at: "2026-07-05T12:00:00Z", amount: 9_000 }]);
  contactId.bob = await person(ws, "Bob", [{ at: "2026-07-01T12:00:00Z", key: "meta" }], [
    { id: "b1", at: "2026-07-12T12:00:00Z", amount: 6_000 },
    { id: "b2", at: "2026-08-12T12:00:00Z", amount: 6_000 },
  ]);
  contactId.carol = await person(ws, "Carol", [], [{ id: "c1", at: "2026-08-20T12:00:00Z", amount: 4_000 }]);
  await recomputeAttribution(db, ws.id);
});

describe("ad receipts: cost allocation", () => {
  it("splits an ad-day between buyers and unsold clicks, to the cent", () => {
    const a = allocateAdDays(
      [
        { adId: "m", day: "2026-07-01", spendMinor: 10_000, clicks: 10 },
        { adId: "g", day: "2026-07-03", spendMinor: 5_000, clicks: 5 },
        { adId: "x", day: "2026-07-04", spendMinor: 700, clicks: 0 },
      ],
      [
        { contactId: "alice", touchpointId: "t1", adId: "m", day: "2026-07-01", credit: 0.5 },
        { contactId: "bob", touchpointId: "t2", adId: "m", day: "2026-07-01", credit: 1 },
        { contactId: "alice", touchpointId: "t3", adId: "g", day: "2026-07-03", credit: 0.5 },
      ],
    );
    expect(Object.fromEntries(a.costByTouch)).toEqual({ t1: 500, t2: 1_000, t3: 500 });
    expect(a.allocatedMinor).toBe(2_000);
    expect(a.unallocatedMinor).toBe(8_500 + 4_500 + 700);
    expect(a.noClickMinor).toBe(700);
  });

  it("gives buyers the whole ad-day when more credited clicks than clicks were recorded", () => {
    const a = allocateAdDays(
      [{ adId: "m", day: "d", spendMinor: 1_001, clicks: 1 }],
      [
        { contactId: "a", touchpointId: "t1", adId: "m", day: "d", credit: 1 },
        { contactId: "b", touchpointId: "t2", adId: "m", day: "d", credit: 1 },
      ],
    );
    expect(a.allocatedMinor).toBe(1_001);
    expect(a.unallocatedMinor).toBe(0);
    expect([...a.costByTouch.values()].sort()).toEqual([500, 501]);
  });

  it("clicks only: prices each customer from the clicks credited to them", async () => {
    const linear = await contactCosts(db, ws, "linear", [contactId.alice, contactId.bob, contactId.carol], "clicks");
    expect(linear.get(contactId.alice)!.costMinor).toBe(1_000);
    expect(linear.get(contactId.alice)!.lines.map((l) => [l.adName, l.costMinor, l.credit])).toEqual([
      ["Prospecting ad", 500, 0.5],
      ["Brand ad", 500, 0.5],
    ]);
    expect(linear.get(contactId.bob)!.costMinor).toBe(1_000);
    expect(linear.get(contactId.carol)!.costMinor).toBe(0);

    // Last touch: Alice's Google click carries her whole customer credit.
    const last = await contactCosts(db, ws, "last_touch", [contactId.alice], "clicks");
    expect(last.get(contactId.alice)!.lines.map((l) => [l.adName, l.costMinor])).toEqual([["Brand ad", 1_000]]);
  });

  it("share of spend: each ad's monthly spend is shared by the customers it brought, by credit", async () => {
    // Meta July $100 shared by Alice ½ and Bob 1 → $33.33 / $66.67; Google July $50 all Alice's.
    const share = await contactCosts(db, ws, "linear", [contactId.alice, contactId.bob, contactId.carol]);
    expect(share.get(contactId.alice)!.lines.map((l) => [l.adName, l.costMinor, l.pool, l.poolSpendMinor, l.poolCredits])).toEqual([
      ["Prospecting ad", 3_333, "2026-07", 10_000, 1.5],
      ["Brand ad", 5_000, "2026-07", 5_000, 0.5],
    ]);
    expect(share.get(contactId.alice)!.costMinor).toBe(8_333);
    expect(share.get(contactId.bob)!.costMinor).toBe(6_667);
    expect(share.get(contactId.carol)!.costMinor).toBe(0);
    const l = await acquisitionLedger(db, ws, { ...Q3, model: "linear" });
    expect(l).toMatchObject({ basis: "share", spendMinor: 15_000, allocatedMinor: 15_000, unallocatedMinor: 0, customers: 2 });
    // First touch: nobody's first click was Google, so its $50 stays unallocated.
    expect(await acquisitionLedger(db, ws, { ...Q3, model: "first_touch" })).toMatchObject({ allocatedMinor: 10_000, unallocatedMinor: 5_000 });
  });

  it("reconciles every model and basis to total spend: customer costs + unallocated", async () => {
    for (const model of MODELS) {
      for (const basis of COST_BASES) {
        for (const range of [Q3, { start: "2026-07-02", end: "2026-07-31" }]) {
          const l = await acquisitionLedger(db, ws, { ...range, model }, basis);
          expect(l.allocatedMinor + l.unallocatedMinor, `${model} ${basis}`).toBe(l.spendMinor);
          expect(l.contacts.reduce((s, c) => s + c.costMinor, 0), `${model} ${basis}`).toBe(l.allocatedMinor);
        }
        expect((await acquisitionLedger(db, ws, { ...Q3, model }, basis)).spendMinor).toBe(15_000);
      }
    }
    const first = await acquisitionLedger(db, ws, { ...Q3, model: "first_touch" }, "clicks");
    // Both first clicks were on Meta: Google's $50 has no buyer.
    expect(first.allocatedMinor).toBe(2_000);
    expect(first.unallocatedMinor).toBe(13_000);
  });
});

describe("ad receipts: payments and contacts", () => {
  it("splits each payment across the ads that earned it, summing to the amount", async () => {
    const r = await paymentReceipt(db, ws, paymentId.a1, "linear");
    expect(r!.payment.amountMinor).toBe(9_000);
    expect(r!.earnedBy.map((e) => [e.adName, e.revenueMinor, e.credit])).toEqual([
      ["Prospecting ad", 4_500, 0.5],
      ["Brand ad", 4_500, 0.5],
    ]);
    for (const model of MODELS) {
      for (const id of Object.values(paymentId)) {
        const pr = await paymentReceipt(db, ws, id, model);
        expect(pr!.earnedBy.reduce((s, e) => s + e.revenueMinor, 0), `${model} ${id}`).toBe(pr!.payment.amountMinor);
      }
    }
    const carol = await paymentReceipt(db, ws, paymentId.c1, "linear");
    expect(carol!.earnedBy).toHaveLength(1);
    expect(carol!.earnedBy[0]).toMatchObject({ key: "unattributed", touchpointId: null, revenueMinor: 4_000 });
  });

  it("shows what a customer cost, earned and when they paid it back", async () => {
    const r = await contactReceipt(db, ws, contactId.bob, "linear", { basis: "clicks" });
    expect(r!.basis).toBe("clicks");
    expect(r!.costMinor).toBe(1_000);
    expect(r!.lifetime).toMatchObject({ grossMinor: 12_000, refundsMinor: 0, netMinor: 12_000, payments: 2 });
    expect(r!.payback).toEqual({ status: "paid_back", at: "2026-07-12T12:00:00.000Z", days: 11, remainingMinor: 0 });
    expect(r!.earnedBy.map((e) => [e.adName, e.revenueMinor])).toEqual([["Prospecting ad", 12_000]]);
    expect(r!.contact.email).toBe("b••@example.com");
    expect((await contactReceipt(db, ws, contactId.bob, "linear", { revealEmail: true }))!.contact.email).toBe("bob@example.com");
    expect(r!.profit).toBeNull();

    const alice = await contactReceipt(db, ws, contactId.alice, "linear", { basis: "clicks" });
    expect(alice!.payback).toMatchObject({ status: "paid_back", days: 4 });
    // Fully loaded, Bob's $66.67 needs both payments: paid back on the second, 42 days in.
    const loaded = await contactReceipt(db, ws, contactId.bob, "linear");
    expect(loaded!.costMinor).toBe(6_667);
    expect(loaded!.payback).toEqual({ status: "paid_back", at: "2026-08-12T12:00:00.000Z", days: 42, remainingMinor: 0 });
    const carol = await contactReceipt(db, ws, contactId.carol, "linear");
    expect(carol!.payback.status).toBe("no_ad_cost");
  });

  it("finds the payback crossing and survives refunds dipping below cost", () => {
    const ev = (at: string, cumMinor: number) => ({ at, cumMinor });
    expect(paybackOf(0, [], null).status).toBe("no_ad_cost");
    expect(paybackOf(1_000, [ev("2026-01-02T00:00:00Z", 500)], "2026-01-01T00:00:00Z")).toEqual({ status: "not_yet", at: null, days: null, remainingMinor: 500 });
    // Crossed on Jan 3, a refund dropped below, crossed again Jan 10.
    const p = paybackOf(
      1_000,
      [ev("2026-01-03T00:00:00Z", 1_200), ev("2026-01-05T00:00:00Z", 200), ev("2026-01-10T00:00:00Z", 1_400)],
      "2026-01-01T00:00:00Z",
    );
    expect(p).toEqual({ status: "paid_back", at: "2026-01-10T00:00:00Z", days: 9, remainingMinor: 0 });
    expect(paybackOf(1_000, [ev("2026-01-03T00:00:00Z", 1_200), ev("2026-01-05T00:00:00Z", -100)], null)).toMatchObject({ status: "not_yet", remainingMinor: 1_000 });
  });

  it("lists payments newest first with the top-credited ad and customer cost", async () => {
    const l = await receiptList(db, ws, { ...Q3, model: "linear" }, { basis: "clicks" });
    expect(l.total).toBe(4);
    expect(l.rows.map((r) => r.amountMinor)).toEqual([4_000, 6_000, 6_000, 9_000]);
    expect(l.rows[0]).toMatchObject({ contactName: "Carol", topEarner: null, costMinor: 0 });
    expect(l.rows[1]).toMatchObject({ contactName: "Bob", costMinor: 1_000, topEarner: { name: "Prospecting ad", platform: "meta", touches: 1 } });
    expect(l.rows[3].topEarner).toMatchObject({ credit: 0.5, touches: 2 });
    const paged = await receiptList(db, ws, { ...Q3, model: "linear" }, { limit: 1, offset: 1 });
    expect(paged.rows.map((r) => r.paymentId)).toEqual([paymentId.b2]);
    expect(paged.rows[0]).toMatchObject({ costMinor: 6_667, payback: { status: "paid_back", days: 42 } });
  });
});

describe("truth gap", () => {
  it("compares what each platform claims with verified payments", async () => {
    const t = await truthGap(db, ws, { ...Q3, model: "linear" });
    const meta = t.platforms.find((r) => r.platform === "meta")!;
    expect(meta).toMatchObject({
      spendMinor: 10_000,
      platformConversions: 5,
      platformValueMinor: 30_000,
      verifiedConversions: 2, // Alice and Bob became customers after clicking
      verifiedCustomers: 2,
      verifiedRevenueMinor: 21_000, // $90 + $60 + $60 from buyers who clicked Meta
      creditedRevenueMinor: 16_500, // Alice ½ × $90 + Bob $120
      conversionRatio: 2.5,
      valueGapMinor: 9_000,
      platformRoas: 3,
      creditedRoas: 1.65,
    });
    expect(meta.valueRatio).toBeCloseTo(30_000 / 21_000, 10);
    const google = t.platforms.find((r) => r.platform === "google")!;
    expect(google).toMatchObject({ platformConversions: 2, platformValueMinor: null, verifiedConversions: 1, verifiedRevenueMinor: 9_000, conversionRatio: 2, valueRatio: null, valueGapMinor: null });
    expect(t.totals).toMatchObject({ spendMinor: 15_000, platformConversions: 7, platformValueMinor: 30_000, revenueMinor: 25_000, creditedRevenueMinor: 21_000, claimToRevenue: 1.2 });
    expect(t.campaigns.map((c) => c.name)).toEqual(["Prospecting", "Brand"]);
    expect(biggestGap(t.platforms)?.platform).toBe("meta");
    // The platform filter narrows both sides.
    const only = await truthGap(db, ws, { ...Q3, model: "linear", platform: "google" });
    expect(only.platforms.map((r) => r.platform)).toEqual(["google"]);
  });
});

describe("profit ledger", () => {
  it("parses percentages into basis points", () => {
    expect(parsePercent("35.5")).toBe(3_550);
    expect(parsePercent("2.9%")).toBe(290);
    expect(parsePercent("100")).toBe(10_000);
    expect(parsePercent("0,5")).toBe(50);
    for (const bad of ["", "101", "-1", "1.234", "abc"]) expect(parsePercent(bad), bad).toBeNull();
    expect(bpsToPercent(3_550)).toBe("35.5");
    expect(bpsToPercent(290)).toBe("2.9");
    expect(bpsToPercent(0)).toBe("0");
  });

  it("without unit economics, contribution equals net revenue", async () => {
    await clearUnitEconomics(db, ws.id);
    const l = await profitLedger(db, ws, Q3);
    expect(l.unitEconomics.configured).toBe(false);
    expect(l).toMatchObject({ grossSalesMinor: 25_000, netRevenueMinor: 25_000, orders: 4, cogsMinor: 0, feesMinor: 0, shippingMinor: 0, contributionMinor: 25_000, spendMinor: 15_000, profitAfterAdsMinor: 10_000 });
    expect(l.breakEvenRoas).toBe(1);
  });

  it("applies COGS, fees and shipping for POAS and contribution", async () => {
    await saveUnitEconomics(db, ws.id, { grossMarginBps: 6_000, feeBps: 300, feeFixedMinor: 30, shippingPerOrderMinor: 500 });
    const ue = await getUnitEconomics(db, ws.id);
    expect(ue).toMatchObject({ configured: true, grossMarginBps: 6_000, feeBps: 300, feeFixedMinor: 30, shippingPerOrderMinor: 500 });

    // net 250.00 · COGS 40% = 100.00 · fees 3% of 250.00 + 4 × 0.30 = 8.70 · shipping 4 × 5.00 = 20.00
    const l = await profitLedger(db, ws, Q3);
    expect(l).toMatchObject({ cogsMinor: 10_000, feesMinor: 870, shippingMinor: 2_000, contributionMinor: 12_130, profitAfterAdsMinor: -2_870 });
    expect(l.poas).toBeCloseTo(12_130 / 15_000, 10);
    expect(l.mer).toBeCloseTo(25_000 / 15_000, 10);
    expect(l.breakEvenRoas).toBeCloseTo(1 / 0.6, 10);

    const rowsByName = Object.fromEntries((await profitRows(db, ws, { ...Q3, model: "linear" }, "campaign")).map((r) => [r.name, r]));
    // Meta: credited 165.00 over 2.5 orders (Alice ½ + Bob 2).
    expect(rowsByName.Prospecting).toMatchObject({ spendMinor: 10_000, revenueMinor: 16_500, orders: 2.5, cogsMinor: 6_600, feesMinor: 570, shippingMinor: 1_250, contributionMinor: 8_080, profitAfterAdsMinor: -1_920, customers: 1.5 });
    expect(rowsByName.Prospecting.poas).toBeCloseTo(0.808, 10);
    expect(rowsByName.Prospecting.repeatRate).toBeCloseTo(1 / 1.5, 10); // Bob paid twice
    expect(rowsByName.Prospecting.refunderRate).toBe(0);
    expect(rowsByName.Brand).toMatchObject({ revenueMinor: 4_500, contributionMinor: 2_300 });
    expect(rowsByName.Brand.poas).toBeCloseTo(0.46, 10);

    const platforms = await profitRows(db, ws, { ...Q3, model: "linear" }, "platform");
    expect(platforms.map((r) => r.id)).toEqual(["meta", "google"]);
    const ads = await profitRows(db, ws, { ...Q3, model: "linear" }, "ad");
    expect(ads.find((r) => r.name === "Prospecting ad")?.parentName).toBe("Prospecting");

    // A receipt's profit uses the same unit economics.
    const bob = await contactReceipt(db, ws, contactId.bob, "linear");
    // 120.00 − 48.00 COGS − (3.60 + 0.60) fees − 10.00 shipping = 57.80; minus 66.67 acquisition.
    expect(bob!.profit).toEqual({ contributionMinor: 5_780, profitMinor: -887 });
  });

  it("rejects out-of-range unit economics", async () => {
    await expect(saveUnitEconomics(db, ws.id, { grossMarginBps: 10_001, feeBps: 0, feeFixedMinor: 0, shippingPerOrderMinor: 0 })).rejects.toThrow();
    await expect(saveUnitEconomics(db, ws.id, { grossMarginBps: 5_000, feeBps: 0, feeFixedMinor: -1, shippingPerOrderMinor: 0 })).rejects.toThrow();
  });
});

describe("time to money", () => {
  it("judges a campaign only after its buyers have had time to pay", () => {
    expect(tooEarlyRule(3, 7)).toBe(true);
    expect(tooEarlyRule(7, 7)).toBe(false);
    expect(tooEarlyRule(null, 7)).toBe(true);
  });

  it("measures lag from first click to first payment per campaign", async () => {
    const t = await timeToMoney(db, ws, { asOf: "2026-07-20" });
    const meta = t.campaigns.find((c) => c.name === "Prospecting")!;
    // Alice 4d 2h, Bob 11d → median 7.54, p80 9.62 (2 buyers: too few, so the default window applies).
    expect(meta.own.samples).toBe(2);
    expect(meta.own.p50Days).toBeCloseTo(7.54, 2);
    expect(meta.own.p80Days).toBeCloseTo(9.62, 2);
    expect(meta.basis).toBe("default");
    expect(meta).toMatchObject({ firstSpendDate: "2026-07-01", ageDays: 19, judgeAfterDays: 7, judgeFrom: "2026-07-08", tooEarly: false });
    expect(t.workspace.samples).toBe(2);
    // Only payments made by `asOf` count: on Jul 5 Bob hasn't paid yet.
    const early = await timeToMoney(db, ws, { asOf: "2026-07-05" });
    expect(early.campaigns.find((c) => c.name === "Prospecting")).toMatchObject({ own: { samples: 1 }, ageDays: 4, tooEarly: true });
    expect(await isTooEarly(db, ws, campaignId.meta, "2026-07-05")).toBe(true);
    expect(await isTooEarly(db, ws, campaignId.meta, "2026-07-20")).toBe(false);
    expect(await isTooEarly(db, ws, "00000000-0000-4000-8000-000000000000", "2026-07-20")).toBe(false);
  });

  it("drafts pauses for losing campaigns old enough to judge, as a bulk-edit CSV", async () => {
    const d = await pauseDrafts(db, ws, { ...Q3, model: "linear" });
    expect(d.metric).toBe("poas"); // unit economics are set above
    expect(d.drafts.map((x) => x.name)).toEqual(["Brand"]);
    expect(d.tooEarly).toEqual([]);
    expect(pauseDraftCsv(d.drafts, "google")).toBe("Campaign,Campaign Status\r\nBrand,Paused\r\n");
    expect(pauseDraftCsv(d.drafts, "meta")).toBe("Campaign ID,Campaign Name,Campaign Status\r\n");
    expect(pauseDraftCsv([{ ...d.drafts[0], platform: "meta", externalId: "c-1", name: "=HYPERLINK(1)" }], "meta")).toBe(
      "Campaign ID,Campaign Name,Campaign Status\r\nc-1,'=HYPERLINK(1),PAUSED\r\n",
    );
    // Judged on the campaign's first days, the same loser is only "too early".
    const early = await pauseDrafts(db, ws, { start: "2026-07-01", end: "2026-07-04", model: "linear" });
    expect(early.drafts).toEqual([]);
    expect(early.tooEarly.map((x) => x.name)).toContain("Brand");
  });
});

describe("workspace isolation", () => {
  it("never reads another workspace's payments, contacts or spend", async () => {
    const { ws: other } = await setupWorkspace();
    expect(await paymentReceipt(db, other, paymentId.a1, "linear")).toBeNull();
    expect(await contactReceipt(db, other, contactId.alice, "linear")).toBeNull();
    expect((await contactCosts(db, other, "linear", [contactId.alice])).get(contactId.alice)!.costMinor).toBe(0);
    const l = await acquisitionLedger(db, other, { ...Q3, model: "linear" });
    expect(l).toMatchObject({ spendMinor: 0, allocatedMinor: 0, customers: 0 });
    expect((await truthGap(db, other, { ...Q3, model: "linear" })).platforms).toEqual([]);
    expect((await profitLedger(db, other, Q3)).netRevenueMinor).toBe(0);
    expect((await getUnitEconomics(db, other.id)).configured).toBe(false);
    expect((await receiptList(db, other, { ...Q3, model: "linear" })).total).toBe(0);
    expect((await timeToMoney(db, other, { asOf: "2026-07-20" })).campaigns).toEqual([]);
  });
});

describe("on demo data", () => {
  let demo: Workspace;
  const RANGE = { start: "2026-06-04", end: "2026-09-01" };

  beforeAll(async () => {
    const { seedDemo } = await import("@/lib/demo/seed");
    ({ ws: demo } = await setupWorkspace());
    await seedDemo(db, demo.id, { anchor: "2026-09-01" });
  }, 240_000);

  it("reconciles customer costs + unallocated to total spend under every model", async () => {
    const [{ spend }] = rows<{ spend: string }>(
      await db.execute(sql`select sum(spend_minor) spend from ad_insights_daily where workspace_id = ${demo.id} and date between ${RANGE.start}::date and ${RANGE.end}::date`),
    );
    for (const model of MODELS) {
      for (const basis of COST_BASES) {
        const l = await acquisitionLedger(db, demo, { ...RANGE, model }, basis);
        expect(l.spendMinor, model).toBe(Number(spend));
        expect(l.allocatedMinor + l.unallocatedMinor, `${model} ${basis}`).toBe(l.spendMinor);
        expect(l.contacts.reduce((s, c) => s + c.costMinor, 0), `${model} ${basis}`).toBe(l.allocatedMinor);
        expect(l.customers, model).toBeGreaterThan(20);
        expect(l.allocatedMinor, model).toBeGreaterThan(0);
      }
      // Over whole months, a contact's own receipt prices them exactly as the ledger does.
      for (const basis of COST_BASES) {
        const l = await acquisitionLedger(db, demo, { start: "2026-07-01", end: "2026-08-31", model }, basis);
        const sample = [...l.contacts.slice(0, 4), ...l.contacts.slice(-2)];
        const own = await contactCosts(db, demo, model, sample.map((c) => c.contactId), basis);
        // (Only the lines inside the period: a buyer may also have clicked in June or September.)
        const inRange = (id: string) => own.get(id)!.lines.filter((x) => x.day >= "2026-07-01" && x.day <= "2026-08-31").reduce((s, x) => s + x.costMinor, 0);
        for (const c of sample) expect(inRange(c.contactId), `${model} ${basis} ${c.contactId}`).toBe(c.costMinor);
      }
    }
    // Fully loaded costs look like CAC: most spend lands on customers.
    const loaded = await acquisitionLedger(db, demo, { ...RANGE, model: "linear" });
    expect(loaded.allocatedMinor / loaded.spendMinor).toBeGreaterThan(0.3);
  });

  it("every payment's credited parts add up to the payment", async () => {
    const pays = rows<{ id: string }>(
      await db.execute(sql`select id from revenue_events where workspace_id = ${demo.id} order by occurred_at desc limit 12`),
    );
    for (const model of MODELS) {
      for (const { id } of pays) {
        const r = await paymentReceipt(db, demo, id, model);
        expect(r!.earnedBy.reduce((s, e) => s + e.revenueMinor, 0)).toBe(r!.payment.amountMinor);
      }
    }
  });

  it("mock platforms over-claim against verified payments", async () => {
    const t = await truthGap(db, demo, { ...RANGE, model: "linear" });
    const meta = t.platforms.find((r) => r.platform === "meta")!;
    expect(meta.platformValueMinor).toBeGreaterThan(0);
    expect(meta.valueRatio).toBeGreaterThan(1);
    expect(meta.conversionRatio).toBeGreaterThan(1);
    for (const p of ["google", "tiktok"] as Platform[]) {
      const r = t.platforms.find((x) => x.platform === p);
      if (r) expect(r.platformValueMinor, p).not.toBeNull();
    }
    expect(t.totals.claimToRevenue).toBeGreaterThan(0);
  });

  it("profit rows add up to credited revenue and platform spend", async () => {
    const [ledger, campaigns] = await Promise.all([
      profitLedger(db, demo, RANGE),
      profitRows(db, demo, { ...RANGE, model: "linear" }, "campaign"),
    ]);
    expect(campaigns.reduce((s, r) => s + r.spendMinor, 0)).toBe(ledger.spendMinor);
    const t = await timeToMoney(db, demo, { asOf: RANGE.end });
    expect(t.workspace.samples).toBeGreaterThan(20);
    expect(t.workspace.p80Days!).toBeGreaterThanOrEqual(t.workspace.p50Days!);
    expect(t.campaigns.some((c) => c.basis === "campaign")).toBe(true);
  });
});
