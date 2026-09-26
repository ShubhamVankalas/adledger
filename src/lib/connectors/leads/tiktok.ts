import { arr, hmacSha256, obj, safeEqual, str, type Json } from "../revenue/shared";
import type { ConnectionLike, WebhookRequest } from "../types";
import { contactFromAnswers, parseTime, type Answers } from "./shared";
import type { LeadConnector, NativeLeadInput } from "./types";

// TikTok Lead Generation (Instant Forms) via a TikTok API for Business webhook subscription
// (POST /open_api/v1.3/subscription/subscribe/ with subscribe_entity=LEAD).
// Deliveries carry `TikTok-Signature: t=<unix seconds>,s=<hex HMAC-SHA256("<t>.<rawBody>", app secret)>`.
// Deliveries are at-least-once, so leads are deduped on lead_id.
// https://business-api.tiktok.com/portal/docs (Webhooks → Lead)

const TOLERANCE_S = 5 * 60;

/** Check a `t=…,s=…` signature header; `nowS` is injectable for tests. */
export function verifyTikTokSignature(rawBody: string, secret: string | undefined, header: string | null, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !header) return false;
  const parts = new Map(header.split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  const t = parts.get("t");
  const s = parts.get("s");
  if (!t || !/^\d{9,11}$/.test(t) || !s || !/^[0-9a-f]{64}$/i.test(s)) return false;
  if (Math.abs(nowS - Number(t)) > TOLERANCE_S) return false;
  return safeEqual(hmacSha256(secret, `${t}.${rawBody}`), Buffer.from(s, "hex"));
}

/** The lead object(s) in a delivery: `lead`, `leads[]`, `data`, or `content` (object or JSON string). */
function leadObjects(payload: unknown): Json[] {
  const p = obj(payload);
  if (!p) return [];
  if (Array.isArray(p.leads)) return p.leads.map(obj).filter((x): x is Json => Boolean(x));
  let inner: unknown = p.lead ?? p.data ?? p.content;
  if (typeof inner === "string") {
    try {
      inner = JSON.parse(inner);
    } catch {
      inner = null;
    }
  }
  const o = obj(inner);
  if (o) return Array.isArray(o.leads) ? leadObjects(o) : [o];
  return p.lead_id ? [p] : [];
}

function answersOf(lead: Json): Answers {
  const answers: Answers = new Map();
  for (const key of ["user_info", "field_data", "answers", "fields"]) {
    for (const a of arr(lead[key])) {
      const f = obj(a);
      const name = str(f?.field_name) ?? str(f?.name) ?? str(f?.key) ?? str(f?.question);
      const value = str(f?.field_value) ?? str(f?.value) ?? str(f?.answer) ?? arr(f?.values).map(str).find(Boolean) ?? null;
      if (name && value) answers.set(name.trim().toLowerCase().replace(/\s+/g, "_"), value);
    }
  }
  return answers;
}

export function parseTikTokLeads(payload: unknown): NativeLeadInput[] {
  const out: NativeLeadInput[] = [];
  for (const lead of leadObjects(payload)) {
    const id = str(lead.lead_id) ?? str(lead.id);
    if (!id) continue;
    const formName = str(lead.form_name) ?? str(lead.page_name);
    out.push({
      platform: "tiktok",
      externalLeadId: id,
      ...contactFromAnswers(answersOf(lead)),
      formName: formName ?? "TikTok instant form",
      occurredAt: parseTime(lead.create_time ?? lead.created_time),
      campaignExternalId: str(lead.campaign_id),
      adGroupExternalId: str(lead.adgroup_id),
      adExternalId: str(lead.ad_id),
      details: { pageId: str(lead.page_id) ?? str(lead.form_id), advertiserId: str(lead.advertiser_id), adName: str(lead.ad_name), campaignName: str(lead.campaign_name) },
    });
  }
  return out;
}

export const tiktokLeadsConnector: LeadConnector = {
  platform: "tiktok",
  channel: "paid_social",
  utmSource: "tiktok",
  meta: {
    provider: "tiktok_leads",
    name: "TikTok Lead Generation",
    category: "leads",
    description: "TikTok instant-form leads, credited straight to the ad, ad group and campaign.",
    status: "beta",
    color: "#000000",
    docsUrl: "https://business-api.tiktok.com/portal/docs",
    fields: [
      { name: "appSecret", label: "App secret", secret: true, hint: "TikTok for Business developer portal → My apps → your app. Used to check the TikTok-Signature header." },
    ],
    steps: [
      "Create an app at business-api.tiktok.com (My apps) with the Lead Generation / Ads Management scope and authorize your advertiser account.",
      "Subscribe to leads: POST /open_api/v1.3/subscription/subscribe/ with `subscribe_entity` LEAD, your advertiser id and callback URL `/api/v1/webhooks/leads-native/tiktok_leads/<workspace id>` on your AdLedger address.",
      "Paste the app secret here and save.",
      "Test for free: in TikTok Ads Manager → Tools → Instant Form, use Preview → submit a test lead (or the Lead Generation sandbox) and check Contacts.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return verifyTikTokSignature(req.rawBody, conn.secrets.appSecret, req.headers.get("tiktok-signature"));
  },
  async parseWebhook(payload) {
    return parseTikTokLeads(payload);
  },
};
