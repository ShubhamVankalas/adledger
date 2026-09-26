// Deterministic demo "world": ad accounts, campaigns, daily metrics, visitor journeys,
// leads and Stripe payments that all agree with each other. Mock connectors serve
// slices of it in the platforms' real API formats, so the same parsing code runs
// in demo mode and live mode.

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
  platform: "meta" | "google";
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
];

export const DEMO_ACCOUNTS = [
  { platform: "meta" as const, externalId: "act_1010101010", name: "Acme Analytics – Meta (Main)", timezone: "America/New_York" },
  { platform: "meta" as const, externalId: "act_2020202020", name: "Acme Analytics – Meta (Brand)", timezone: "America/New_York" },
  { platform: "google" as const, externalId: "1234567890", name: "Acme Analytics – Google Ads", timezone: "America/New_York" },
];

export type DemoAd = {
  platform: "meta" | "google";
  account: (typeof DEMO_ACCOUNTS)[number];
  campaign: { externalId: string; name: string; objective: string; spec: CampaignSpec };
  group: { externalId: string; name: string };
  ad: { externalId: string; name: string };
  share: number; // share of campaign spend
};

export function demoAds(): DemoAd[] {
  const out: DemoAd[] = [];
  CAMPAIGNS.forEach((c, ci) => {
    const account = DEMO_ACCOUNTS[c.account];
    const cid = c.platform === "meta" ? `23850${ci}00000${ci}` : `1700${ci}0000${ci}`;
    const r = rng(`shares:${c.key}`);
    const weights: number[] = [];
    const tmp: Omit<DemoAd, "share">[] = [];
    c.groups.forEach((g, gi) => {
      const gid = c.platform === "meta" ? `23851${ci}${gi}0000${gi}` : `1400${ci}${gi}000${gi}`;
      for (let ai = 0; ai < c.adsPerGroup; ai++) {
        const aid = c.platform === "meta" ? `23852${ci}${gi}${ai}000${ai}` : `6800${ci}${gi}${ai}00${ai}`;
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
  const ctr = spec.platform === "google" ? r.range(0.03, 0.08) : r.range(0.008, 0.02);
  const impressions = Math.round(clicks / ctr);
  const conversions = Math.round(clicks * spec.leadRate * 0.7 * r.range(0.8, 1.3) * 100) / 100;
  return { spend: spendRounded, clicks, impressions, conversions };
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

function landingUrl(ad: DemoAd, r: ReturnType<typeof rng>): string {
  const pages = ["/", "/pricing", "/features/attribution", "/guide"];
  const path = ad.campaign.spec.key === "guide" ? "/guide" : r.pick(pages);
  const u = new URL(path, DEMO_SITE);
  if (ad.platform === "meta") {
    u.searchParams.set("utm_source", r.chance(0.8) ? "facebook" : "instagram");
    u.searchParams.set("utm_medium", "paid_social");
    u.searchParams.set("utm_campaign", ad.campaign.externalId);
    u.searchParams.set("utm_term", ad.group.externalId);
    u.searchParams.set("utm_content", ad.ad.externalId);
    u.searchParams.set("fbclid", `IwAR${Math.floor(r.next() * 1e12).toString(36)}`);
  } else {
    u.searchParams.set("utm_source", "google");
    u.searchParams.set("utm_medium", "cpc");
    u.searchParams.set("utm_campaign", ad.campaign.externalId);
    u.searchParams.set("utm_term", ad.group.externalId);
    u.searchParams.set("utm_content", ad.ad.externalId);
    u.searchParams.set("gclid", `Cj0K${Math.floor(r.next() * 1e14).toString(36)}`);
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
        addVisit(v, at, landingUrl(ad, r), ad.platform === "meta" ? "https://l.facebook.com/" : "https://www.google.com/", true);
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

  return { anchor, since, currency, siteUrl: DEMO_SITE, visitors, contacts, payments };
}
