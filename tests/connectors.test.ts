import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { googleAdsQuery, parseGoogleAdsStream, parseMetaInsights } from "@/lib/connectors/ads";
import { mockStripeCharges } from "@/lib/connectors/stripe";
import { adDayMetrics, demoAds } from "@/lib/demo/world";

const fixture = (p: string) => JSON.parse(readFileSync(`fixtures/${p}`, "utf8"));

// Contract tests: real-format API payloads (fixtures/) parse into exact minor units.

describe("Meta insights parser", () => {
  it("parses the Graph API format", () => {
    const rows = parseMetaInsights(fixture("meta/insights.json").data, { externalId: "act_1", name: "Acme", currency: "USD", timezone: null });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "meta",
      date: "2026-09-20",
      spendMinor: 41237,
      impressions: 31502,
      clicks: 688,
      conversions: "25.00",
      campaign: { externalId: "120210000000000001" },
      adGroup: { externalId: "120210000000000101", name: "LAL 1% – US" },
      ad: { externalId: "120210000000001001" },
    });
    expect(rows[1].spendMinor).toBe(10);
    expect(rows[1].conversions).toBe("0.00");
  });
});

describe("Google Ads parser", () => {
  it("parses searchStream with a zero-decimal currency and falls back to the ad id for names", () => {
    const rows = parseGoogleAdsStream(fixture("google_ads/search_stream.json"), "1234567890");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      platform: "google",
      spendMinor: 12346, // ¥12,345.5 -> ¥12,346
      clicks: 84,
      conversions: "6.50",
      account: { currency: "JPY", timezone: "Asia/Tokyo" },
      ad: { externalId: "68001", name: "Ad 68001" },
    });
  });
  it("builds a bounded GAQL query", () => {
    const q = googleAdsQuery({ since: "2026-09-01", until: "2026-09-07" });
    expect(q).toContain("FROM ad_group_ad");
    expect(q).toContain("segments.date BETWEEN '2026-09-01' AND '2026-09-07'");
  });
});

describe("demo world / mock connectors", () => {
  it("has 11 campaigns and ~50 ads across 6 accounts on 5 platforms", () => {
    const ads = demoAds();
    expect(new Set(ads.map((a) => a.campaign.externalId)).size).toBe(11);
    expect(ads.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ads.map((a) => a.account.externalId)).size).toBe(6);
  });
  it("ad-day metrics are a pure function of (ad, date)", () => {
    const ad = demoAds()[0];
    expect(adDayMetrics(ad, "2026-09-01", "USD")).toEqual(adDayMetrics(ad, "2026-09-01", "USD"));
  });
  it("mock Stripe charges look like Stripe charges", () => {
    const charges = mockStripeCharges("2026-09-01", "USD", 0);
    expect(charges.length).toBeGreaterThan(100);
    for (const c of charges.slice(0, 20)) {
      expect(c.id).toMatch(/^ch_/);
      expect(Number.isInteger(c.amount)).toBe(true);
      expect(c.currency).toBe("usd");
      expect(c.created * 1000).toBeLessThanOrEqual(Date.parse("2026-09-02T00:00:00Z"));
    }
  });
});
