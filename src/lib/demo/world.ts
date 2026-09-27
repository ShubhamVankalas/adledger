// Deterministic demo "world": ad accounts, campaigns, daily metrics, visitor journeys,
// leads and Stripe payments that all agree with each other. Mock connectors serve
// slices of it in the platforms' real API formats, so the same parsing code runs
// in demo mode and live mode.

import type { Platform } from "../connectors/types";
import { currencyExponent } from "../money";

// ---------------------------------------------------------------- PRNG

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number | string) {
  let a = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    /** Poisson sample (Knuth), fine for small lambdas. */
    poisson: (lambda: number) => {
      if (lambda <= 0) return 0;
      if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (next() + next() + next() - 1.5) * 1.41));
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= next();
      } while (p > L);
      return k - 1;
    },
  };
}

// ---------------------------------------------------------------- dates

export const DAY = 86_400_000;
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);
export const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
export function dateRange(since: string, until: string): string[] {
  const out: string[] = [];
  for (let t = parseDate(since).getTime(); t <= parseDate(until).getTime(); t += DAY) out.push(isoDate(new Date(t)));
  return out;
}

// ---------------------------------------------------------------- structure

type CampaignSpec = {
  key: string;
  platform: Platform;
  account: number;
  name: string;
  objective: string;
  dailySpend: number; // USD major units
  cpc: number;
  leadRate: number; // per visitor
  custRate: number; // per lead
  firstOrder: number; // USD
  groups: string[];
  adsPerGroup: number;
  adNames: string[];
};

const CAMPAIGNS: CampaignSpec[] = [
  { key: "lal", platform: "meta", account: 0, name: "Prospecting – Lookalike 1% Purchasers", objective: "OUTCOME_SALES",
    dailySpend: 420, cpc: 6, leadRate: 0.05, custRate: 0.3, firstOrder: 1800,
    groups: ["LAL 1% – US", "LAL 1% – UK/CA", "LAL 3% – US"], adsPerGroup: 2, adNames: ["Founder story video", "ROAS calculator carousel", "Customer quote static"] },
  { key: "rt", platform: "meta", account: 0, name: "Retargeting – Site Visitors 30d", objective: "OUTCOME_SALES",
    dailySpend: 150, cpc: 4, leadRate: 0.07, custRate: 0.15, firstOrder: 900,
    groups: ["Visitors 7d", "Visitors 30d"], adsPerGroup: 3, adNames: ["Demo walkthrough", "Case study: 3.2x ROAS", "Limited offer"] },
  { key: "broad", platform: "meta", account: 0, name: "Broad – Interest Stack", objective: "OUTCOME_LEADS",
    dailySpend: 380, cpc: 3, leadRate: 0.05, custRate: 0.008, firstOrder: 300,
    groups: ["Marketing interests", "Ecommerce interests", "Small business"], adsPerGroup: 2, adNames: ["Free template meme", "Giveaway static", "UGC testimonial"] },
  { key: "video", platform: "meta", account: 1, name: "Brand Awareness – Video Views", objective: "OUTCOME_AWARENESS",
    dailySpend: 120, cpc: 12, leadRate: 0.005, custRate: 0.02, firstOrder: 600,
    groups: ["Broad 18-45"], adsPerGroup: 4, adNames: ["Brand film 30s", "Brand film 15s", "Behind the scenes", "Product teaser"] },
  { key: "guide", platform: "meta", account: 1, name: "Lead Gen – Free Attribution Guide", objective: "OUTCOME_LEADS",
    dailySpend: 200, cpc: 5, leadRate: 0.1, custRate: 0.04, firstOrder: 600,
    groups: ["Founders", "Marketers"], adsPerGroup: 2, adNames: ["Guide cover static", "Checklist carousel"] },
  { key: "brand", platform: "google", account: 2, name: "Search – Brand", objective: "SEARCH",
    dailySpend: 90, cpc: 2.5, leadRate: 0.12, custRate: 0.18, firstOrder: 1000,
    groups: ["Brand – Exact", "Brand – Phrase"], adsPerGroup: 2, adNames: ["RSA – Official site", "RSA – Pricing"] },
  { key: "comp", platform: "google", account: 2, name: "Search – Competitor Alternatives", objective: "SEARCH",
    dailySpend: 260, cpc: 14, leadRate: 0.04, custRate: 0.1, firstOrder: 700,
    groups: ["Hyros alternative", "Triple Whale alternative", "Cometly alternative"], adsPerGroup: 2, adNames: ["RSA – Cheaper alternative", "RSA – Open source"] },
  { key: "pmax", platform: "google", account: 2, name: "Performance Max – All Products", objective: "PERFORMANCE_MAX",
    dailySpend: 300, cpc: 8, leadRate: 0.04, custRate: 0.2, firstOrder: 1000,
    groups: ["Asset group – Core", "Asset group – Seasonal"], adsPerGroup: 3, adNames: ["Assets – Dashboard", "Assets – AI insights", "Assets – Integrations"] },
  { key: "tiktok", platform: "tiktok", account: 3, name: "TikTok – Spark Ads Creators", objective: "CONVERSIONS",
    dailySpend: 220, cpc: 3.5, leadRate: 0.045, custRate: 0.12, firstOrder: 700,
    groups: ["Creators – US 18-34", "Creators – Founders"], adsPerGroup: 2, adNames: ["Creator: I found my wasted spend", "Screen recording walkthrough"] },
  { key: "linkedin", platform: "linkedin", account: 4, name: "LinkedIn – Lead Gen Forms (Marketing Leaders)", objective: "LEAD_GENERATION",
    dailySpend: 180, cpc: 11, leadRate: 0.09, custRate: 0.05, firstOrder: 1500,
    groups: ["Heads of Growth – NA"], adsPerGroup: 2, adNames: ["Document ad: Attribution playbook", "Single image: Stop guessing"] },
  { key: "bing", platform: "microsoft", account: 5, name: "Microsoft Search – Brand + Category", objective: "SEARCH",
    dailySpend: 60, cpc: 2, leadRate: 0.1, custRate: 0.2, firstOrder: 900,
    groups: ["Brand", "Marketing attribution software"], adsPerGroup: 2, adNames: ["RSA – Official site", "RSA – Free & open source"] },
];

export const DEMO_ACCOUNTS = [
  { platform: "meta" as const, externalId: "act_1010101010", name: "Acme Analytics – Meta (Main)", timezone: "America/New_York" },
  { platform: "meta" as const, externalId: "act_2020202020", name: "Acme Analytics – Meta (Brand)", timezone: "America/New_York" },
  { platform: "google" as const, externalId: "1234567890", name: "Acme Analytics – Google Ads", timezone: "America/New_York" },
  { platform: "tiktok" as const, externalId: "7300000000000000001", name: "Acme Analytics – TikTok", timezone: "America/New_York" },
  { platform: "linkedin" as const, externalId: "508000001", name: "Acme Analytics – LinkedIn", timezone: "America/New_York" },
  { platform: "microsoft" as const, externalId: "180000001", name: "Acme Analytics – Microsoft Ads", timezone: "America/New_York" },
] as { platform: Platform; externalId: string; name: string; timezone: string }[];

export type DemoAd = {
  platform: Platform;
  account: (typeof DEMO_ACCOUNTS)[number];
  campaign: { externalId: string; name: string; objective: string; spec: CampaignSpec };
  group: { externalId: string; name: string };
  ad: { externalId: string; name: string };
  share: number; // share of campaign spend
};

/** Platform-shaped ids (Meta/Google ids are kept stable for existing demos and fixtures). */
function idFor(platform: Platform, level: "c" | "g" | "a", key: string): string {
  const k = key.split("");
  if (platform === "meta") return level === "c" ? `23850${k[0]}00000${k[0]}` : level === "g" ? `23851${k[0]}${k[1]}0000${k[1]}` : `23852${k[0]}${k[1]}${k[2]}000${k[2]}`;
  if (platform === "google") return level === "c" ? `1700${k[0]}0000${k[0]}` : level === "g" ? `1400${k[0]}${k[1]}000${k[1]}` : `6800${k[0]}${k[1]}${k[2]}00${k[2]}`;
  const prefix: Record<string, string> = { tiktok: "17", linkedin: "5", microsoft: "4", pinterest: "54", snapchat: "9", reddit: "2", x: "14", other: "0" };
  const lvl = { c: "1", g: "2", a: "3" }[level];
  return `${prefix[platform] ?? "0"}${lvl}${key.padStart(6, "0")}`;
}

export function demoAds(): DemoAd[] {
  const out: DemoAd[] = [];
  CAMPAIGNS.forEach((c, ci) => {
    const account = DEMO_ACCOUNTS[c.account];
    const cid = idFor(c.platform, "c", `${ci}`);
    const r = rng(`shares:${c.key}`);
    const weights: number[] = [];
    const tmp: Omit<DemoAd, "share">[] = [];
    c.groups.forEach((g, gi) => {
      const gid = idFor(c.platform, "g", `${ci}${gi}`);
      for (let ai = 0; ai < c.adsPerGroup; ai++) {
        const aid = idFor(c.platform, "a", `${ci}${gi}${ai}`);
        const adName = `${c.adNames[ai % c.adNames.length]}${c.adsPerGroup > c.adNames.length && ai >= c.adNames.length ? " v2" : ""}`;
        tmp.push({
          platform: c.platform,
          account,
          campaign: { externalId: cid, name: c.name, objective: c.objective, spec: c },
          group: { externalId: gid, name: g },
          ad: { externalId: aid, name: adName },
        });
        weights.push(0.4 + r.next());
      }
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    tmp.forEach((t, i) => out.push({ ...t, share: weights[i] / sum }));
  });
  return out;
}

/**
 * Demo ads for one platform. Platforms without campaigns in the demo world get a small
 * deterministic synthetic campaign so every connector's mock mode returns realistic rows.
 */
export function demoAdsFor(platform: Platform): DemoAd[] {
  const real = demoAds().filter((a) => a.platform === platform);
  if (real.length) return real;
  const label = platform === "x" ? "X" : platform.charAt(0).toUpperCase() + platform.slice(1);
  const spec: CampaignSpec = {
    key: `synthetic-${platform}`, platform, account: 0, name: `${label} – Prospecting`, objective: "CONVERSIONS",
    dailySpend: 80, cpc: 2.5, leadRate: 0.04, custRate: 0.08, firstOrder: 500,
    groups: ["Broad – US"], adsPerGroup: 2, adNames: ["Video – Product tour", "Static – Customer quote"],
  };
  const account = { platform, externalId: idFor(platform, "c", "999"), name: `Acme Analytics – ${label}`, timezone: "America/New_York" };
  return [0, 1].map((ai) => ({
    platform,
    account,
    campaign: { externalId: idFor(platform, "c", "90"), name: spec.name, objective: spec.objective, spec },
    group: { externalId: idFor(platform, "g", "900"), name: spec.groups[0] },
    ad: { externalId: idFor(platform, "a", `90${ai}`), name: spec.adNames[ai] },
    share: ai === 0 ? 0.6 : 0.4,
  }));
}

/** Currency scale so the story reads naturally in the workspace currency. */
export function currencyScale(currency: string): number {
  const scales: Record<string, number> = { INR: 80, JPY: 150, KRW: 1300, IDR: 15000, BRL: 5, MXN: 18, ZAR: 18, AUD: 1.5, CAD: 1.35, NZD: 1.6, SGD: 1.35, AED: 3.67, SEK: 10, NOK: 10, DKK: 7, PLN: 4, TRY: 30, PHP: 55, VND: 24000, CHF: 0.9, GBP: 0.8, EUR: 0.92 };
  return scales[currency.toUpperCase()] ?? 1;
}

export type AdDayMetrics = { spend: number; clicks: number; impressions: number; conversions: number };

/** Pure function of (ad, date): stable no matter when it's asked for. `spend` in major units. */
export function adDayMetrics(ad: DemoAd, date: string, currency: string): AdDayMetrics {
  const r = rng(`m:${ad.ad.externalId}:${date}`);
  const d = parseDate(date);
  const dow = d.getUTCDay();
  const weekday = [0.82, 1.05, 1.08, 1.06, 1.04, 0.98, 0.84][dow];
  // Slow drift over the year so the charts aren't flat.
  const doy = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY);
  const season = 1 + 0.12 * Math.sin((doy / 365) * Math.PI * 2 + hashString(ad.campaign.spec.key) % 7);
  const spec = ad.campaign.spec;
  const spend = spec.dailySpend * ad.share * weekday * season * r.range(0.8, 1.2) * currencyScale(currency);
  const exp = currencyExponent(currency);
  const spendRounded = Math.round(spend * 10 ** exp) / 10 ** exp;
  const cpc = spec.cpc * currencyScale(currency) * r.range(0.85, 1.15);
  const clicks = Math.max(0, Math.round(spendRounded / cpc));
  const search = spec.platform === "google" || spec.platform === "microsoft";
  const ctr = search ? r.range(0.03, 0.08) : r.range(0.008, 0.02);
  const impressions = Math.round(clicks / ctr);
  const conversions = Math.round(clicks * spec.leadRate * 0.7 * r.range(0.8, 1.3) * 100) / 100;
  return { spend: spendRounded, clicks, impressions, conversions };
}

/**
 * How much ad platforms over-report purchases in the demo world (view-through, modeled and
 * cross-device conversions). Real-world gaps are commonly 1.2-2x; TikTok and Meta sit highest.
 */
const OVERCLAIM: Partial<Record<Platform, [number, number]>> = {
  meta: [1.45, 2.05],
  google: [1.15, 1.45],
  tiktok: [1.7, 2.5],
  microsoft: [1.05, 1.3],
  linkedin: [1.3, 1.7],
};

export type PlatformClaim = { purchases: number; value: number };

/**
 * What the ad platform itself claims for one ad-day: purchases and purchase value (major units).
 * Pure function of (ad, date) on its own random stream, so `adDayMetrics` is unchanged. The claim
 * is the purchases this ad-day's clicks should produce, inflated by the platform's over-claim factor.
 */
export function platformClaim(ad: DemoAd, date: string, currency: string): PlatformClaim {
  const m = adDayMetrics(ad, date, currency);
  const r = rng(`claim:${ad.ad.externalId}:${date}`);
  const spec = ad.campaign.spec;
  const [lo, hi] = OVERCLAIM[ad.platform] ?? [1.2, 1.6];
  const expected = m.clicks * 0.7 * spec.leadRate * spec.custRate * r.range(lo, hi);
  const purchases = Math.floor(expected) + (r.next() < expected - Math.floor(expected) ? 1 : 0);
  const exp = currencyExponent(currency);
  const value = purchases * spec.firstOrder * currencyScale(currency) * r.range(0.85, 1.2);
  return { purchases, value: Math.round(value * 10 ** exp) / 10 ** exp };
}

// ---------------------------------------------------------------- people & journeys

const FIRST = ["Aarav", "Maya", "Liam", "Sofia", "Noah", "Priya", "Ethan", "Zara", "Lucas", "Ananya", "Oliver", "Isla", "Arjun", "Emma", "Kabir", "Mia", "Leo", "Diya", "Mateo", "Chloe", "Rohan", "Ava", "Omar", "Nora", "Ishaan", "Grace", "Hugo", "Sara", "Vihaan", "Lena"];
const LAST = ["Sharma", "Patel", "Smith", "Garcia", "Chen", "Khan", "Müller", "Rossi", "Kim", "Singh", "Brown", "Silva", "Nguyen", "Iyer", "Cohen", "Novak", "Okafor", "Reddy", "Dubois", "Tanaka", "Mehta", "Walker", "Costa", "Das", "Fischer"];
const DOMAINS = ["example.com", "example.org", "example.net"];

export type DemoTouch = {
  at: Date;
  url: string;
  referrer: string | null;
};

export type DemoVisitor = {
  vid: string;
  touches: DemoTouch[];
  pageViews: { at: Date; url: string; referrer: string | null }[];
};

export type DemoContact = {
  key: string;
  email: string;
  name: string;
  phone: string | null;
  visitorIds: string[];
  leadAt: Date;
  leadVia: "pixel" | "webhook";
  formName: string;
};

export type DemoPayment = {
  chargeId: string;
  paymentIntent: string;
  customerId: string;
  email: string;
  vid: string | null;
  amountMinor: number;
  currency: string;
  at: Date;
  refundedMinor: number;
  refundedAt: Date | null;
};

export type DemoWorld = {
  anchor: string;
  since: string;
  currency: string;
  siteUrl: string;
  visitors: DemoVisitor[];
  contacts: DemoContact[];
  payments: DemoPayment[];
};

export const DEMO_SITE = "https://demo.adledger.local";

const REFERRERS: Partial<Record<Platform, string>> = {
  meta: "https://l.facebook.com/",
  google: "https://www.google.com/",
  tiktok: "https://www.tiktok.com/",
  linkedin: "https://www.linkedin.com/",
  microsoft: "https://www.bing.com/",
};

function landingUrl(ad: DemoAd, r: ReturnType<typeof rng>): string {
  const pages = ["/", "/pricing", "/features/attribution", "/guide"];
  const path = ad.campaign.spec.key === "guide" ? "/guide" : r.pick(pages);
  const u = new URL(path, DEMO_SITE);
  const set = (source: string, medium: string, clickParam: string, clickValue: string) => {
    u.searchParams.set("utm_source", source);
    u.searchParams.set("utm_medium", medium);
    u.searchParams.set("utm_campaign", ad.campaign.externalId);
    u.searchParams.set("utm_term", ad.group.externalId);
    u.searchParams.set("utm_content", ad.ad.externalId);
    u.searchParams.set(clickParam, clickValue);
  };
  const rand = (n: number) => Math.floor(r.next() * 10 ** n).toString(36);
  switch (ad.platform) {
    case "meta":
      set(r.chance(0.8) ? "facebook" : "instagram", "paid_social", "fbclid", `IwAR${rand(12)}`);
      break;
    case "google":
      set("google", "cpc", "gclid", `Cj0K${rand(14)}`);
      break;
    case "tiktok":
      set("tiktok", "paid_social", "ttclid", `E.C.P.${rand(14)}`);
      break;
    case "linkedin":
      set("linkedin", "paid_social", "li_fat_id", rand(12));
      break;
    case "microsoft":
      set("bing", "cpc", "msclkid", rand(14));
      break;
    default:
      set(ad.platform, "paid_social", "utm_id", rand(10));
  }
  return u.toString();
}

/**
 * Build the whole demo world for `days` days ending at `anchor` (inclusive).
 * Deterministic for a given (anchor, currency).
 */
export function buildDemoWorld(anchor: string, currency: string, days = 90): DemoWorld {
  const ads = demoAds();
  const since = isoDate(new Date(parseDate(anchor).getTime() - (days - 1) * DAY));
  const endMs = parseDate(anchor).getTime() + DAY - 1;
  const r = rng(`world:${anchor}:${currency}`);
  const visitors: DemoVisitor[] = [];
  const contacts: DemoContact[] = [];
  const payments: DemoPayment[] = [];
  const scale = currencyScale(currency);
  const exp = currencyExponent(currency);
  const toMinor = (major: number) => Math.round(major * scale) * 10 ** exp;

  const rtAds = ads.filter((a) => a.campaign.spec.key === "rt");
  const brandAds = ads.filter((a) => a.campaign.spec.key === "brand");
  let n = 0;
  const newVisitor = (): DemoVisitor => ({ vid: `demo${(n++).toString(36).padStart(6, "0")}${Math.floor(r.next() * 1e8).toString(36)}`, touches: [], pageViews: [] });

  const addVisit = (v: DemoVisitor, at: Date, url: string, referrer: string | null, isTouch: boolean) => {
    if (at.getTime() > endMs) return;
    if (isTouch) v.touches.push({ at, url, referrer });
    v.pageViews.push({ at, url, referrer });
    const pages = r.int(0, 3);
    for (let i = 1; i <= pages; i++) {
      v.pageViews.push({ at: new Date(at.getTime() + i * r.int(20, 180) * 1000), url: new URL(r.pick(["/pricing", "/features", "/docs", "/signup", "/about"]), DEMO_SITE).toString(), referrer: url });
    }
  };

  const makeContact = (v: DemoVisitor, leadAt: Date, spec: CampaignSpec | null): DemoContact => {
    const idx = contacts.length;
    const first = FIRST[idx % FIRST.length];
    const last = LAST[Math.floor(idx / FIRST.length) % LAST.length];
    const c: DemoContact = {
      key: `c${idx}`,
      email: `${first.toLowerCase()}.${last.toLowerCase().replace(/ü/g, "u")}${idx}@${DOMAINS[idx % 3]}`,
      name: `${first} ${last}`,
      phone: r.chance(0.4) ? `+1555${String(1000000 + idx).slice(-7)}` : null,
      visitorIds: [v.vid],
      leadAt,
      leadVia: r.chance(0.8) ? "pixel" : "webhook",
      formName: spec?.key === "guide" ? "Free guide download" : r.pick(["Book a demo", "Start free trial", "Newsletter"]),
    };
    contacts.push(c);
    return c;
  };

  const purchase = (c: DemoContact, vid: string | null, at: Date, spec: CampaignSpec | null) => {
    if (at.getTime() > endMs) return;
    const base = (spec?.firstOrder ?? 700) * r.range(0.8, 1.25);
    const customerId = `cus_demo${payments.length.toString(36)}${c.key}`;
    let t = at;
    let i = 0;
    do {
      const amountMinor = toMinor(i === 0 ? base : base * 0.35);
      const refundAt = new Date(t.getTime() + r.int(2, 9) * DAY);
      // Refunds only when they would already have happened by the end of the demo window.
      const refunded = i === 0 && r.chance(0.04) && refundAt.getTime() <= endMs;
      payments.push({
        chargeId: `ch_demo_${c.key}_${i}`,
        paymentIntent: `pi_demo_${c.key}_${i}`,
        customerId,
        email: c.email,
        vid: vid && r.chance(0.5) ? vid : null,
        amountMinor,
        currency,
        at: t,
        refundedMinor: refunded ? amountMinor : 0,
        refundedAt: refunded ? refundAt : null,
      });
      if (refunded) break;
      t = new Date(t.getTime() + 30 * DAY);
      i++;
    } while (t.getTime() <= endMs && r.chance(0.8));
  };

  for (const date of dateRange(since, anchor)) {
    const dayStart = parseDate(date).getTime();
    for (const ad of ads) {
      const m = adDayMetrics(ad, date, currency);
      const spec = ad.campaign.spec;
      const landed = Math.round(m.clicks * 0.7);
      for (let i = 0; i < landed; i++) {
        const v = newVisitor();
        const at = new Date(dayStart + r.int(6 * 3600, 23 * 3600) * 1000);
        addVisit(v, at, landingUrl(ad, r), REFERRERS[ad.platform] ?? null, true);
        visitors.push(v);
        if (!r.chance(spec.leadRate)) {
          // Some non-converters come back via retargeting later.
          if (r.chance(0.08)) {
            const rt = r.pick(rtAds);
            addVisit(v, new Date(at.getTime() + r.int(1, 12) * DAY), landingUrl(rt, r), "https://l.facebook.com/", true);
          }
          continue;
        }
        // Converting visitor: maybe more touches before the lead / purchase.
        let leadAt = new Date(at.getTime() + r.int(60, 1800) * 1000);
        if (r.chance(0.3) && spec.key !== "rt" && spec.key !== "brand") {
          const rt = r.pick(rtAds);
          const t2 = new Date(at.getTime() + r.int(1, 8) * DAY);
          addVisit(v, t2, landingUrl(rt, r), "https://l.facebook.com/", true);
          leadAt = new Date(t2.getTime() + r.int(60, 900) * 1000);
        }
        if (leadAt.getTime() > endMs) continue;
        const c = makeContact(v, leadAt, spec);
        v.pageViews.push({ at: leadAt, url: `${DEMO_SITE}/signup`, referrer: null });
        // A few people also use a second device (stitched by email).
        if (r.chance(0.05)) {
          const v2 = newVisitor();
          addVisit(v2, new Date(leadAt.getTime() + r.int(1, 5) * DAY), `${DEMO_SITE}/pricing`, null, false);
          visitors.push(v2);
          c.visitorIds.push(v2.vid);
        }
        if (r.chance(spec.custRate)) {
          let buyAt = new Date(leadAt.getTime() + r.int(1, 18) * DAY + r.int(0, 3600) * 1000);
          if (r.chance(0.2)) {
            const b = r.pick(brandAds);
            const t3 = new Date(buyAt.getTime() - r.int(2, 20) * 3600 * 1000);
            if (t3 > leadAt) {
              addVisit(v, t3, landingUrl(b, r), "https://www.google.com/", true);
              buyAt = new Date(t3.getTime() + r.int(300, 3600) * 1000);
            }
          }
          purchase(c, v.vid, buyAt, spec);
        }
      }
    }

    // Organic / referral / direct traffic.
    const organic = r.poisson(34);
    for (let i = 0; i < organic; i++) {
      const v = newVisitor();
      const at = new Date(dayStart + r.int(0, 86399) * 1000);
      const kind = r.next();
      const [url, ref, touch] =
        kind < 0.45
          ? [`${DEMO_SITE}/blog/marketing-attribution-guide`, "https://www.google.com/", true]
          : kind < 0.6
            ? [`${DEMO_SITE}/?utm_source=newsletter&utm_medium=email&utm_campaign=weekly`, null, true]
            : kind < 0.75
              ? [`${DEMO_SITE}/`, "https://news.ycombinator.com/", true]
              : [`${DEMO_SITE}/`, null, false];
      addVisit(v, at, url, ref, touch);
      visitors.push(v);
      if (r.chance(0.03)) {
        const leadAt = new Date(at.getTime() + r.int(60, 1200) * 1000);
        if (leadAt.getTime() > endMs) continue;
        const c = makeContact(v, leadAt, null);
        if (r.chance(0.15)) purchase(c, v.vid, new Date(leadAt.getTime() + r.int(1, 14) * DAY), null);
      }
    }
    // A few leads arrive only via form webhook with no tracked visit (e.g. offline).
    if (r.chance(0.3)) {
      const v = newVisitor();
      const c = makeContact(v, new Date(dayStart + r.int(9 * 3600, 18 * 3600) * 1000), null);
      c.visitorIds = [];
      c.leadVia = "webhook";
      if (r.chance(0.1)) purchase(c, null, new Date(c.leadAt.getTime() + r.int(1, 10) * DAY), null);
    }
  }

  // Follow-up page views can land a few minutes past the window; nothing may happen after the anchor day.
  for (const v of visitors) {
    v.pageViews = v.pageViews.filter((pv) => pv.at.getTime() <= endMs);
    v.touches = v.touches.filter((t) => t.at.getTime() <= endMs);
  }
  return { anchor, since, currency, siteUrl: DEMO_SITE, visitors, contacts, payments };
}
