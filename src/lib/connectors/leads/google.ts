import { arr, obj, str } from "../revenue/shared";
import type { ConnectionLike, WebhookRequest } from "../types";
import { contactFromAnswers, parseTime, rawId, secretEquals, type Answers } from "./shared";
import type { LeadConnector, NativeLeadInput } from "./types";

// Google Ads lead form webhook (Search, YouTube, Discovery/Demand Gen and Performance Max lead forms).
// Google POSTs JSON with the answers in `user_column_data` and the advertiser-chosen `google_key`
// in the body for verification; reply 200 to acknowledge. `is_test` leads come from the
// "Send test data" button and are acknowledged but not stored.
// https://developers.google.com/google-ads/webhook/docs/implementation

/** Google `column_id` -> the answer keys contactFromAnswers understands. */
const COLUMN_KEYS: Record<string, string> = {
  FULL_NAME: "full_name",
  FIRST_NAME: "first_name",
  LAST_NAME: "last_name",
  EMAIL: "email",
  WORK_EMAIL: "work_email",
  PHONE_NUMBER: "phone_number",
  WORK_PHONE: "work_phone",
};

function body(rawBody: string): Record<string, unknown> | null {
  try {
    return obj(JSON.parse(rawBody));
  } catch {
    return null;
  }
}

/** A Google lead form webhook body -> normalized lead (empty for test leads or bodies without a lead id). */
export function parseGoogleLead(payload: unknown, rawBody: string): NativeLeadInput[] {
  const p = obj(payload);
  const leadId = str(p?.lead_id);
  if (!p || !leadId || p.is_test === true) return [];
  const answers: Answers = new Map();
  for (const c of arr(p.user_column_data)) {
    const col = obj(c);
    const id = str(col?.column_id)?.toUpperCase();
    const value = str(col?.string_value);
    if (!id || !value) continue;
    answers.set(COLUMN_KEYS[id] ?? id.toLowerCase(), value);
  }
  const formId = rawId(rawBody, "form_id", p.form_id);
  const gclid = str(p.gcl_id);
  return [
    {
      platform: "google",
      externalLeadId: leadId,
      ...contactFromAnswers(answers),
      formName: formId ? `Google Ads lead form ${formId}` : "Google Ads lead form",
      occurredAt: parseTime(p.lead_submit_time),
      campaignExternalId: rawId(rawBody, "campaign_id", p.campaign_id),
      adGroupExternalId: rawId(rawBody, "adgroup_id", p.adgroup_id),
      adExternalId: rawId(rawBody, "creative_id", p.creative_id),
      clickId: gclid ? { type: "gclid", id: gclid } : null,
      details: {
        formId,
        assetGroupId: rawId(rawBody, "asset_group_id", p.asset_group_id),
        leadSource: str(p.lead_source),
        leadStage: str(p.lead_stage),
      },
    },
  ];
}

export const googleLeadsConnector: LeadConnector = {
  platform: "google",
  channel: "paid_search",
  utmSource: "google",
  meta: {
    provider: "google_ads_leads",
    name: "Google Ads lead forms",
    category: "leads",
    description: "Lead form assets on Search, YouTube, Demand Gen and Performance Max, credited to the campaign.",
    status: "beta",
    color: "#ea4335",
    docsUrl: "https://developers.google.com/google-ads/webhook/docs/overview",
    fields: [
      { name: "googleKey", label: "Webhook key", secret: true, hint: "Any long random string. Google sends it back as google_key so AdLedger knows the lead is genuine." },
    ],
    steps: [
      "Choose a long random key, paste it here and save.",
      "In Google Ads open the lead form asset → Export leads from Google Ads → Other data integration options → Webhook integration.",
      "Webhook URL: the webhook URL shown in AdLedger (`/api/v1/webhooks/leads-native/google_ads_leads/<workspace id>`); Key: the same key as here.",
      "Click Send test data — Google should report success (test leads are checked but not stored). Real leads then appear in Contacts, credited to the campaign.",
    ],
  },
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike) {
    return secretEquals(conn.secrets.googleKey, str(body(req.rawBody)?.google_key));
  },
  async parseWebhook(payload, req) {
    return parseGoogleLead(payload, req.rawBody);
  },
};
