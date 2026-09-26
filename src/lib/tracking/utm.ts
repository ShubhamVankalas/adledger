import type { Channel, Platform } from "../db/schema";

export type ClickIdType = "gclid" | "gbraid" | "wbraid" | "fbclid" | "ttclid" | "msclkid" | "li_fat_id";
const CLICK_IDS: ClickIdType[] = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid", "msclkid", "li_fat_id"];

export type MarketingParams = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  clickIdType: ClickIdType | null;
  clickId: string | null;
};

const clean = (v: string | null) => {
  const t = v?.trim();
  return t ? t.slice(0, 500) : null;
};

export function parseMarketingParams(url: string | null | undefined): MarketingParams {
  let params = new URLSearchParams();
  try {
    if (url) params = new URL(url).searchParams;
  } catch {
    /* ignore malformed URLs */
  }
  // Case-insensitive lookup (some tools emit UTM_SOURCE).
  const get = (name: string) => {
    for (const [k, v] of params) if (k.toLowerCase() === name) return clean(v);
    return null;
  };
  let clickIdType: ClickIdType | null = null;
  let clickId: string | null = null;
  for (const id of CLICK_IDS) {
    const v = get(id);
    if (v) {
      clickIdType = id;
      clickId = v;
      break;
    }
  }
  return {
    utmSource: get("utm_source"),
    utmMedium: get("utm_medium"),
    utmCampaign: get("utm_campaign"),
    utmContent: get("utm_content"),
    utmTerm: get("utm_term"),
    clickIdType,
    clickId,
  };
}

const SEARCH_ENGINES = [
  "google.", "bing.com", "yahoo.", "duckduckgo.com", "baidu.com", "yandex.", "ecosia.org",
  "search.brave.com", "naver.com", "perplexity.ai", "chatgpt.com",
];
const SOCIAL = [
  "facebook.com", "fb.com", "fb.me", "instagram.com", "l.instagram.com", "t.co", "twitter.com",
  "x.com", "linkedin.com", "lnkd.in", "tiktok.com", "youtube.com", "youtu.be", "pinterest.",
  "reddit.com", "snapchat.com", "threads.net", "whatsapp.com", "wa.me", "quora.com",
];
const AD_DOMAINS = ["googleadservices.com", "doubleclick.net", "googlesyndication.com", "ads.", "adclick."];

const SOCIAL_SOURCES = /^(facebook|fb|instagram|ig|meta|an|audience_network|messenger|tiktok|linkedin|twitter|x|snapchat|pinterest|reddit|youtube|threads|whatsapp)$/i;
const SEARCH_SOURCES = /^(google|adwords|bing|microsoft|yahoo|duckduckgo|baidu|yandex)$/i;
const PAID_MEDIUM = /^(cpc|ppc|cpm|cpv|cpa|paid|paid[_ -]?(social|search|media|ads?)|social[_ -]?paid|display|ads?|sem|retargeting|remarketing)$/i;

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const matchesAny = (host: string, list: string[]) =>
  list.some((d) => (d.endsWith(".") ? host.startsWith(d) || host.includes(`.${d}`) : host === d || host.endsWith(`.${d}`)));

/** Which ad platform a touchpoint most likely belongs to (for matching to synced campaigns). */
export function platformOf(p: MarketingParams): Platform | null {
  if (p.clickIdType === "gclid" || p.clickIdType === "gbraid" || p.clickIdType === "wbraid") return "google";
  if (p.clickIdType === "fbclid") return "meta";
  const s = p.utmSource?.toLowerCase() ?? "";
  if (/^(facebook|fb|instagram|ig|meta|an|audience_network|messenger)$/.test(s)) return "meta";
  if (/^(google|adwords|youtube)$/.test(s)) return "google";
  return null;
}

/**
 * Classify a landing into a channel. Returns null when there is no marketing signal
 * (plain direct/internal navigation), in which case no touchpoint is created.
 */
export function classify(
  p: MarketingParams,
  referrer: string | null | undefined,
  landingHost: string | null,
): Channel | null {
  const source = p.utmSource ?? "";
  const medium = p.utmMedium ?? "";
  if (p.clickIdType === "gclid" || p.clickIdType === "gbraid" || p.clickIdType === "wbraid" || p.clickIdType === "msclkid") {
    return "paid_search";
  }
  if (/^(e-?mail|newsletter)$/i.test(medium) || /^(e-?mail|newsletter)$/i.test(source)) return "email";
  if (PAID_MEDIUM.test(medium)) {
    if (SOCIAL_SOURCES.test(source)) return "paid_social";
    if (SEARCH_SOURCES.test(source)) return /display|cpm/i.test(medium) ? "paid_social" : "paid_search";
    return /social/i.test(medium) ? "paid_social" : "paid_search";
  }
  if (p.clickIdType) return "paid_social"; // fbclid, ttclid, li_fat_id
  if (/social/i.test(medium) || SOCIAL_SOURCES.test(source)) return "organic";
  if (/organic/i.test(medium)) return "organic";
  if (source || medium || p.utmCampaign) return "referral";

  const refHost = hostOf(referrer);
  if (!refHost || refHost === landingHost) return null;
  if (matchesAny(refHost, AD_DOMAINS)) return "paid_search";
  if (matchesAny(refHost, SEARCH_ENGINES) || matchesAny(refHost, SOCIAL)) return "organic";
  return "referral";
}

/** Build Meta's `_fbc` value from an fbclid when the cookie isn't present. */
export function fbcFromClickId(fbclid: string, atMs: number): string {
  return `fb.1.${atMs}.${fbclid}`;
}
