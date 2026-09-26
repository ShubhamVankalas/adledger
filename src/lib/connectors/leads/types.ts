import type { Channel } from "../../db/schema";
import type { ConnectionLike, IntegrationMeta, Platform, WebhookRequest } from "../types";

// Native lead forms on ad platforms (Meta Lead Ads, Google Ads lead forms, TikTok Instant Forms).
// These people never visit the website, so the pixel never sees them: the lead is credited
// straight to the ad through a synthetic touchpoint at the moment the form was submitted.

/** One lead-form submission, normalized across platforms. External ids are strings (int64-safe). */
export type NativeLeadInput = {
  platform: Platform;
  externalLeadId: string; // unique per platform; used to dedupe webhook retries
  email: string | null;
  phone: string | null;
  name: string | null;
  formName: string | null;
  occurredAt: Date;
  campaignExternalId: string | null;
  adGroupExternalId: string | null;
  adExternalId: string | null;
  /** Organic form submissions (e.g. a Page's own form) carry no ad and get no paid touchpoint. */
  organic?: boolean;
  clickId?: { type: string; id: string } | null;
  /** Extra non-identifying context stored (PII-redacted) on the lead row. */
  details?: Record<string, unknown>;
};

export type LeadParseContext = {
  conn: ConnectionLike;
  /** CONNECTOR_MODE=mock or a demo connection: never call the platform's API. */
  mock: boolean;
};

export interface LeadConnector {
  meta: IntegrationMeta & { category: "leads" };
  platform: Platform;
  /** Channel of the synthetic touchpoint (paid_social / paid_search). */
  channel: Channel;
  /** utm_source written on the synthetic touchpoint, e.g. "facebook". */
  utmSource: string;
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike): boolean | Promise<boolean>;
  /** GET subscription handshake (Meta's hub.challenge). Returns the body to echo, or null to reject. */
  verifyChallenge?(params: URLSearchParams, conn: ConnectionLike): string | null;
  /** May call the platform API (Meta sends only ids); must not in mock mode. */
  parseWebhook(payload: unknown, req: WebhookRequest, ctx: LeadParseContext): Promise<NativeLeadInput[]>;
}
