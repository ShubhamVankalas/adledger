import { readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { EXTRA_ADS_CONNECTORS } from "@/lib/connectors/ads/index";
import { linkedinDateRange, parseLinkedInAnalytics } from "@/lib/connectors/ads/linkedin";
import { microsoftReportRequest, parseCsv, parseMicrosoftAdPerformanceCsv, readZip } from "@/lib/connectors/ads/microsoft";
import { parsePinterestAnalytics } from "@/lib/connectors/ads/pinterest";
import { parseRedditReport, redditBoundary } from "@/lib/connectors/ads/reddit";
import { localMidnight, parseSnapchatStats } from "@/lib/connectors/ads/snapchat";
import { parseTikTokReport } from "@/lib/connectors/ads/tiktok";
import { mergeXRows, oauth1Header, oauth1Signature, parseXStats, xBoundary } from "@/lib/connectors/ads/x";

const text = (p: string) => readFileSync(`fixtures/${p}`, "utf8");
const fixture = (p: string) => JSON.parse(text(p));

// Contract tests: real-format API payloads (fixtures/) parse into exact minor units.

describe("TikTok integrated report parser", () => {
  it("parses AUCTION_AD daily rows", () => {
    const res = fixture("tiktok/integrated_report.json");
    const rows = parseTikTokReport(res.data.list, { externalId: "7300000000000000001", name: "Acme TikTok", currency: "USD", timezone: "America/New_York" });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "tiktok",
      date: "2026-09-20",
      spendMinor: 12847,
      impressions: 40211,
      clicks: 362,
      conversions: "14.00",
      campaign: { externalId: "1790000000000000101", name: "Spark Ads – Creators", objective: "WEB_CONVERSIONS" },
      adGroup: { externalId: "1790000000000000201", name: "US 18-34" },
      ad: { externalId: "1790000000000000301", name: "Creator: I found my wasted spend" },
    });
    expect(rows[1]).toMatchObject({ date: "2026-09-21", spendMinor: 50, clicks: 0, conversions: "0.00" });
  });
});

describe("LinkedIn adAnalytics parser", () => {
  it("maps creatives → campaigns → campaign groups and parses decimal cost", () => {
    const rows = parseLinkedInAnalytics(fixture("linkedin/ad_analytics.json").elements, fixture("linkedin/entities.json"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "linkedin",
      account: { externalId: "508000001", currency: "EUR" },
      campaign: { externalId: "700100001", name: "Q3 Lead Gen – Marketing Leaders", status: "ACTIVE", objective: "LEAD_GENERATION" },
      adGroup: { externalId: "360000001", name: "Heads of Growth – NA" },
      ad: { externalId: "612340001", name: "Document ad: Attribution playbook" },
      date: "2026-09-20",
      spendMinor: 18792, // €187.91833 -> €187.92
      impressions: 5120,
      clicks: 41,
      conversions: "7.00",
    });
    expect(rows[1]).toMatchObject({ date: "2026-09-21", spendMinor: 0, ad: { externalId: "612340002", name: "Creative 612340002", status: "PAUSED" } });
  });
  it("builds a Rest.li date range", () => {
    expect(linkedinDateRange({ since: "2026-09-01", until: "2026-09-03" })).toBe("(start:(year:2026,month:9,day:1),end:(year:2026,month:9,day:3))");
  });
});

describe("Microsoft Ads report", () => {
  const csv = text("microsoft/ad_performance_report.csv");

  it("parses the AdPerformanceReport CSV (thousands separators, -- placeholders)", () => {
    const rows = parseMicrosoftAdPerformanceCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "microsoft",
      account: { externalId: "180000001", name: "Acme Analytics – Microsoft Ads", currency: "USD" },
      campaign: { externalId: "410000010", name: "Microsoft Search – Brand + Category", status: "Active", objective: "Search & content" },
      adGroup: { externalId: "420000100", name: "Brand" },
      ad: { externalId: "430000100", name: "RSA – Official site" },
      date: "2026-09-20",
      spendMinor: 123456,
      impressions: 1204,
      clicks: 87,
      conversions: "6.50",
    });
    expect(rows[1]).toMatchObject({ spendMinor: 5, conversions: "0.00", adGroup: { status: "Paused" }, ad: { name: "Ad 430000110" } });
  });

  it("reads deflated and stored ZIP entries", () => {
    const zip = buildZip([
      { name: "report.csv", data: Buffer.from(csv, "utf8"), deflate: true },
      { name: "readme.txt", data: Buffer.from("hello"), deflate: false },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(["report.csv", "readme.txt"]);
    expect(files[0].data.toString("utf8")).toBe(csv);
    expect(files[1].data.toString()).toBe("hello");
    expect(parseMicrosoftAdPerformanceCsv(files[0].data.toString("utf8"))[0].spendMinor).toBe(123456);
  });

  it("parses quoted CSV fields", () => {
    expect(parseCsv('"a","b ""x"", y"\r\n"1",""\r\n')).toEqual([["a", 'b "x", y'], ["1", ""]]);
  });

  it("builds a daily AdPerformanceReportRequest", () => {
    const req = microsoftReportRequest("180000001", { since: "2026-09-01", until: "2026-09-03" });
    expect(req.ReportRequest).toMatchObject({
      Type: "AdPerformanceReportRequest",
      Aggregation: "Daily",
      Format: "Csv",
      Scope: { AccountIds: [180000001] },
      Time: { CustomDateRangeStart: { Day: 1, Month: 9, Year: 2026 }, CustomDateRangeEnd: { Day: 3, Month: 9, Year: 2026 } },
    });
    expect(req.ReportRequest.Columns).toContain("TimePeriod");
  });
});

describe("Pinterest ads analytics parser", () => {
  it("converts SPEND_IN_MICRO_DOLLAR (account currency micros) to minor units", () => {
    const rows = parsePinterestAnalytics(fixture("pinterest/ads_analytics.json"), fixture("pinterest/entities.json"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "pinterest",
      account: { externalId: "549755885175", currency: "GBP" },
      campaign: { externalId: "626700000001", name: "Consideration – Pinners who save dashboards", objective: "CONSIDERATION" },
      adGroup: { externalId: "2680000000001", name: "Interests – Small business" },
      ad: { externalId: "687000000001", name: "Idea pin – 5 attribution mistakes" },
      date: "2026-09-20",
      spendMinor: 4512,
      impressions: 18230,
      clicks: 212,
      conversions: "9.00",
    });
    expect(rows[1]).toMatchObject({ date: "2026-09-21", spendMinor: 123, ad: { name: "Ad 687000000002", status: "PAUSED" } }); // £1.234567
  });
});

describe("Snapchat stats parser", () => {
  it("flattens the ad breakdown timeseries and skips empty days", () => {
    const rows = parseSnapchatStats(fixture("snapchat/stats.json"), fixture("snapchat/entities.json"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "snapchat",
      account: { currency: "USD", timezone: "America/Los_Angeles" },
      campaign: { externalId: "c1000000-0000-4000-8000-000000000001", name: "Snap – Website conversions", objective: "WEB_CONVERSION" },
      adGroup: { externalId: "d1000000-0000-4000-8000-000000000001", name: "US 18-34 – Founders" },
      ad: { externalId: "a1b2c3d4-0000-4000-8000-00000000a001", name: "Vertical video – Product tour" },
      date: "2026-09-20",
      spendMinor: 9642,
      impressions: 25310,
      clicks: 301,
      conversions: "14.00",
    });
    expect(rows[1]).toMatchObject({ date: "2026-09-21", spendMinor: 101, ad: { name: "Story – Customer quote", status: "PAUSED" } }); // $1.005
  });
  it("aligns stats boundaries to the account's local midnight", () => {
    expect(localMidnight("2026-09-01", "America/New_York")).toBe("2026-09-01T00:00:00-04:00");
    expect(localMidnight("2026-12-01", "America/New_York")).toBe("2026-12-01T00:00:00-05:00");
    expect(localMidnight("2026-09-01", "Asia/Kolkata")).toBe("2026-09-01T00:00:00+05:30");
  });
});

describe("Reddit report parser", () => {
  it("parses v3 report metrics (micro-currency spend)", () => {
    const rows = parseRedditReport(fixture("reddit/report.json").data.metrics, fixture("reddit/entities.json"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "reddit",
      account: { externalId: "t2_acme0001", currency: "USD", timezone: "America/New_York" },
      campaign: { externalId: "t3_cmp0000001", name: "r/marketing – Conversions", status: "ACTIVE", objective: "CONVERSIONS" },
      adGroup: { externalId: "t3_adg0000001", name: "Communities – Marketing & PPC" },
      ad: { externalId: "t3_ad0000001", name: "Promoted post – Open-source Hyros alternative" },
      date: "2026-09-20",
      spendMinor: 5831,
      impressions: 30214,
      clicks: 197,
      conversions: "6.00",
    });
    expect(rows[1]).toMatchObject({ spendMinor: 0, ad: { status: "PAUSED" } }); // $0.004999
  });
  it("uses whole-hour UTC boundaries at local midnight, across DST", () => {
    expect(redditBoundary("2026-09-01", "America/New_York")).toBe("2026-09-01T04:00:00Z");
    expect(redditBoundary("2026-11-01", "America/New_York")).toBe("2026-11-01T04:00:00Z");
    expect(redditBoundary("2026-03-08", "America/New_York")).toBe("2026-03-08T05:00:00Z");
    expect(xBoundary("2026-09-20", "America/Los_Angeles")).toBe("2026-09-20T07:00:00Z");
  });
});

describe("X Ads stats parser", () => {
  it("expands daily metric arrays into ad-day rows", () => {
    const rows = parseXStats(fixture("x/stats.json"), fixture("x/entities.json"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      platform: "x",
      account: { externalId: "18ce54d4x5t", currency: "USD", timezone: "America/Los_Angeles" },
      campaign: { externalId: "8wku2", name: "Website traffic – Founders", objective: "WEBSITE_CLICKS" },
      adGroup: { externalId: "8v7jo", name: "Followers of growth accounts" },
      ad: { externalId: "8u94t", name: "Post 1839000000000000001" },
      date: "2026-09-20",
      spendMinor: 7425,
      impressions: 18402,
      clicks: 233,
      conversions: "7.00",
    });
    expect(rows[1]).toMatchObject({ date: "2026-09-21", spendMinor: 200, conversions: "0.00" }); // $1.995
  });
  it("merges placements for the same ad-day", () => {
    const rows = parseXStats(fixture("x/stats.json"), fixture("x/entities.json"));
    const merged = mergeXRows([...rows, ...rows]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ spendMinor: 14850, impressions: 36804, conversions: "14.00" });
    expect(rows[0].spendMinor).toBe(7425);
  });
  it("signs requests with OAuth 1.0a HMAC-SHA1 (X's documented example)", () => {
    const sig = oauth1Signature(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      [
        ["status", "Hello Ladies + Gentlemen, a signed OAuth request!"],
        ["oauth_consumer_key", "xvz1evFS4wEEPTGEFPHBog"],
        ["oauth_nonce", "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg"],
        ["oauth_signature_method", "HMAC-SHA1"],
        ["oauth_timestamp", "1318622958"],
        ["oauth_token", "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb"],
        ["oauth_version", "1.0"],
      ],
      "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
      "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
    );
    expect(sig).toBe("hCtSmYh+iHYCEqBWrE7C7hYmtUk=");

    const header = oauth1Header(
      "POST",
      "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      {
        consumerKey: "xvz1evFS4wEEPTGEFPHBog",
        consumerSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        token: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        tokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      { nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp: 1318622958, extra: [["status", "Hello Ladies + Gentlemen, a signed OAuth request!"]] },
    );
    expect(header).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"');
    expect(header.startsWith('OAuth oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"')).toBe(true);
  });
});

describe("extra ad connectors: registry + mock mode", () => {
  const window = { since: "2026-09-01", until: "2026-09-03" };

  it("registers all seven platforms with unique providers", () => {
    const providers = EXTRA_ADS_CONNECTORS.map((c) => c.meta.provider).sort();
    expect(providers).toEqual(["linkedin_ads", "microsoft_ads", "pinterest_ads", "reddit_ads", "snapchat_ads", "tiktok_ads", "x_ads"]);
    for (const c of EXTRA_ADS_CONNECTORS) {
      expect(c.meta.category).toBe("ads");
      expect(c.meta.status).toBe("beta");
      expect(c.meta.steps.length).toBeGreaterThanOrEqual(3);
      expect(c.meta.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.meta.fields.some((f) => f.secret)).toBe(true);
    }
  });

  for (const c of EXTRA_ADS_CONNECTORS) {
    it(`${c.meta.provider} mock returns deterministic, integer-money rows`, () => {
      const rows = c.mock(window, "USD");
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.platform).toBe(c.platform);
        expect(Number.isInteger(r.spendMinor)).toBe(true);
        expect(r.spendMinor).toBeGreaterThanOrEqual(0);
        expect(r.date >= window.since && r.date <= window.until).toBe(true);
        expect(r.conversions).toMatch(/^\d+\.\d{2}$/);
        expect(r.account.currency).toBe("USD");
        expect(r.campaign.name).not.toBe("Unknown campaign");
        expect(r.ad.externalId).not.toBe("");
      }
      expect(new Set(rows.map((r) => r.date))).toEqual(new Set(["2026-09-01", "2026-09-02", "2026-09-03"]));
      expect(c.mock(window, "USD")).toEqual(rows);
    });
  }

  it("mocks handle zero-decimal currencies", () => {
    for (const c of EXTRA_ADS_CONNECTORS) {
      const rows = c.mock(window, "JPY");
      expect(rows.every((r) => Number.isInteger(r.spendMinor) && r.account.currency === "JPY")).toBe(true);
    }
  });

  it("fetchLive fails fast with a clear message when credentials are missing", async () => {
    for (const c of EXTRA_ADS_CONNECTORS) {
      await expect(c.fetchLive({ config: {}, secrets: {} }, window)).rejects.toThrow(new RegExp(c.meta.name.split(" ")[0]));
    }
  });
});

/** Minimal ZIP writer for tests (local headers + central directory + EOCD, CRC left as 0). */
function buildZip(entries: { name: string; data: Buffer; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : e.data;
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}
