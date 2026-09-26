import { META_API_VERSION_DEFAULT } from "../ads";
import { arr, fetchJson, obj, str, verifyHmac, type Json } from "../revenue/shared";
import type { ConnectionLike, WebhookRequest } from "../types";
import { contactFromAnswers, parseTime, secretEquals, type Answers } from "./shared";
import type { LeadConnector, NativeLeadInput } from "./types";

// Meta Lead Ads (Facebook + Instagram instant forms).
// The Page `leadgen` webhook carries only ids; the answers are fetched with
// GET /{leadgen_id} using a Page access token that has `leads_retrieval`.
// Deliveries are signed: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(rawBody, app secret)).
// https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started

const LEAD_FIELDS = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,field_data,is_organic,platform";

/** `value` of one `leadgen` change in the Page webhook. */
export type MetaLeadgenValue = {
  leadgen_id: string;
  page_id?: string;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
};

/** A Lead node from the Graph API. */
export type MetaGraphLead = {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  is_organic?: boolean;
  platform?: string; // "fb" | "ig"
  field_data?: { name: string; values: string[] }[];
};

/** All `leadgen` changes in a Page webhook payload. */
export function metaLeadgenValues(payload: unknown): MetaLeadgenValue[] {
  const p = obj(payload);
  if (!p || str(p.object) !== "page") return [];
  const out: MetaLeadgenValue[] = [];
  for (const entry of arr(p.entry)) {
    for (const change of arr(obj(entry)?.changes)) {
      const c = obj(change);
      const v = obj(c?.value);
      const id = str(v?.leadgen_id);
      if (str(c?.field) !== "leadgen" || !v || !id) continue;
      out.push({
        leadgen_id: id,
        page_id: str(v.page_id) ?? undefined,
        form_id: str(v.form_id) ?? undefined,
        ad_id: str(v.ad_id) ?? undefined,
        adgroup_id: str(v.adgroup_id) ?? undefined,
        created_time: typeof v.created_time === "number" ? v.created_time : undefined,
      });
    }
  }
  return out;
}

/** Graph Lead (+ the webhook value for ids the lead may omit) -> normalized lead. */
export function parseMetaLead(lead: MetaGraphLead, hook?: MetaLeadgenValue): NativeLeadInput {
  const answers: Answers = new Map();
  for (const f of arr(lead.field_data)) {
    const fd = obj(f) as Json | null;
    const key = str(fd?.name)?.toLowerCase();
    const value = arr(fd?.values).map(str).find(Boolean);
    if (key && value) answers.set(key, value);
  }
  const formId = str(lead.form_id) ?? hook?.form_id ?? null;
  const organic = lead.is_organic === true;
  return {
    platform: "meta",
    externalLeadId: String(lead.id),
    ...contactFromAnswers(answers),
    formName: formId ? `Meta lead form ${formId}` : "Meta lead form",
    occurredAt: parseTime(lead.created_time ?? hook?.created_time),
    campaignExternalId: organic ? null : (str(lead.campaign_id) ?? null),
    adGroupExternalId: organic ? null : (str(lead.adset_id) ?? hook?.adgroup_id ?? null),
    adExternalId: organic ? null : (str(lead.ad_id) ?? hook?.ad_id ?? null),
    organic,
    details: {
      formId,
      pageId: hook?.page_id ?? null,
      publisher: str(lead.platform),
      adName: str(lead.ad_name),
      campaignName: str(lead.campaign_name),
    },
  };
}

/**
 * Demo/test mode: a Graph Lead in the real response format, built from the webhook ids, so the
 * whole flow runs without a Page token.
 */
export function mockMetaLead(v: MetaLeadgenValue): MetaGraphLead {
  const n = v.leadgen_id.slice(-4);
  return {
    id: v.leadgen_id,
    created_time: new Date((v.created_time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString().replace(/\.\d{3}Z$/, "+0000"),
    ad_id: v.ad_id,
    adset_id: v.adgroup_id,
    form_id: v.form_id,
    is_organic: !v.ad_id,
    platform: "fb",
    field_data: [
      { name: "full_name", values: [`Meta Lead ${n}`] },
      { name: "email", values: [`meta.lead.${v.leadgen_id}@example.com`] },
      { name: "phone_number", values: [`+1415555${n.padStart(4, "0")}`] },
    ],
  };
}

async function fetchMetaLead(conn: ConnectionLike, leadgenId: string): Promise<MetaGraphLead> {
  const token = conn.secrets.pageAccessToken;
  if (!token) throw new Error("Meta Lead Ads: Page access token is missing");
  if (!/^\d+$/.test(leadgenId)) throw new Error("Meta Lead Ads: invalid leadgen id");
  const version = conn.config.apiVersion?.trim() || META_API_VERSION_DEFAULT;
  const url = `https://graph.facebook.com/${encodeURIComponent(version)}/${leadgenId}?fields=${LEAD_FIELDS}`;
  const { body } = await fetchJson<MetaGraphLead>(url, { headers: { Authorization: `Bearer ${token}` } }, "Meta lead fetch");
  return body;
}

export const metaLeadsConnector: LeadConnector = {
  platform: "meta",
  channel: "paid_social",
  utmSource: "facebook",
  meta: {
    provider: "meta_leads",
    name: "Meta Lead Ads",
    category: "leads",
    description: "Facebook and Instagram instant-form leads, credited straight to the ad that collected them.",
    status: "beta",
    color: "#0866ff",
    docsUrl: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving",
    fields: [
      { name: "appSecret", label: "App secret", secret: true, hint: "Meta app → App settings → Basic. Used to check the X-Hub-Signature-256 header." },
      { name: "verifyToken", label: "Verify token", secret: true, hint: "Any random string; type the same value when adding the webhook in Meta." },
      { name: "pageAccessToken", label: "Page access token", secret: true, placeholder: "EAAB…", hint: "A never-expiring Page token (System User) with leads_retrieval and pages_manage_metadata." },
      { name: "apiVersion", label: "API version", placeholder: META_API_VERSION_DEFAULT, optional: true },
    ],
    steps: [
      "In developers.facebook.com open (or create) your Business app → Webhooks → Page → Subscribe, with callback URL `/api/v1/webhooks/leads-native/meta_leads/<workspace id>` on your AdLedger address and the verify token you enter here; then subscribe to the `leadgen` field.",
      "Business Settings → System users → generate a token for your Page with `leads_retrieval`, `pages_manage_metadata` and `pages_show_list`, and subscribe the app to the Page (POST /{page-id}/subscribed_apps?subscribed_fields=leadgen).",
      "Paste the app secret, verify token and Page token here. In Meta Business Suite → Integrations → Leads access, make sure the app is allowed to read leads.",
      "Test for free with Meta's Lead Ads Testing Tool (developers.facebook.com/tools/lead-ads-testing): submit a test lead and it appears in Contacts within seconds.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    const header = req.headers.get("x-hub-signature-256");
    if (!header?.startsWith("sha256=")) return false;
    return verifyHmac(req.rawBody, conn.secrets.appSecret, header.slice(7), "hex");
  },
  verifyChallenge(params: URLSearchParams, conn: ConnectionLike) {
    if (params.get("hub.mode") !== "subscribe") return null;
    if (!secretEquals(conn.secrets.verifyToken, params.get("hub.verify_token"))) return null;
    const challenge = params.get("hub.challenge");
    return challenge && /^[\w.-]{1,256}$/.test(challenge) ? challenge : null;
  },
  async parseWebhook(payload, _req, { conn, mock }) {
    const out: NativeLeadInput[] = [];
    for (const v of metaLeadgenValues(payload)) {
      const lead = mock ? mockMetaLead(v) : await fetchMetaLead(conn, v.leadgen_id);
      out.push(parseMetaLead(lead, v));
    }
    return out;
  },
};
