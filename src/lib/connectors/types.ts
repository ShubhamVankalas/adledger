// Shared contracts for every integration. Each connector lives in its own file and
// registers itself in `registry.ts`; the UI, sync jobs and webhooks are driven by the registry.

/** Ad platforms AdLedger can hold spend for. `other` = CSV / API imports. */
export const AD_PLATFORMS = [
  "meta",
  "google",
  "microsoft",
  "tiktok",
  "linkedin",
  "pinterest",
  "snapchat",
  "reddit",
  "x",
  "other",
] as const;
export type Platform = (typeof AD_PLATFORMS)[number];

export type DateWindow = { since: string; until: string }; // YYYY-MM-DD, inclusive

/** One ad-day of spend, normalized across platforms. Money in minor units (never floats). */
export type AdDayRow = {
  platform: Platform;
  account: { externalId: string; name: string; currency: string; timezone: string | null };
  campaign: { externalId: string; name: string; status: string | null; objective: string | null };
  adGroup: { externalId: string; name: string; status: string | null };
  ad: { externalId: string; name: string; status: string | null };
  date: string; // YYYY-MM-DD in the ad account's timezone
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: string; // decimal string, platform-reported conversions
};

/** What a connector receives: non-secret config + decrypted secrets from Settings. */
export type ConnectionLike = {
  config: Record<string, string>;
  secrets: Record<string, string>;
};

export type FieldDef = {
  name: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
  /** "toggle" renders an on/off switch; the stored config value is "on" or "". */
  type?: "text" | "toggle";
};

/**
 * One-click connect ("Connect with Meta"). The install's admin registers an OAuth app with the
 * platform and sets `env`; users then sign in instead of pasting tokens. See `src/lib/oauth`.
 */
export type OAuthMeta = {
  /** Button label: "Connect with {label}". */
  label: string;
  /** Env vars that must all be set to enable it: [client id, client secret, ...extras]. */
  env: string[];
  /** Env vars read when set but not required (e.g. META_LOGIN_CONFIG_ID). */
  optionalEnv?: string[];
  /** Scopes requested at sign-in (empty = the scopes configured on the platform's app). */
  scopes: string[];
};

/** Metadata shown in the Integrations catalog and used to build the connect form. */
export type IntegrationMeta = {
  provider: string; // stable id stored in connections.provider, e.g. "tiktok_ads"
  name: string; // "TikTok Ads"
  category: "ads" | "revenue" | "leads" | "website" | "notifications" | "import";
  description: string;
  fields: FieldDef[];
  steps: string[]; // plain-text setup steps (may contain `code`)
  docsUrl: string;
  status: "stable" | "beta";
  color: string; // brand-ish hex for the logo badge
  oauth?: OAuthMeta;
};

/**
 * Ad-spend connector. `fetchLive` calls the real API; `mock` must serve realistic data
 * produced from the demo world *in the platform's real API response format* and run it
 * through the same parser `fetchLive` uses.
 */
export interface AdsConnector {
  meta: IntegrationMeta & { category: "ads" };
  platform: Platform;
  fetchLive(conn: ConnectionLike, window: DateWindow): Promise<AdDayRow[]>;
  mock(window: DateWindow, currency: string): AdDayRow[];
}

/** A payment or refund from any revenue source, before contact matching. */
export type RevenueEventInput = {
  type: "payment" | "refund";
  externalId: string; // unique per source (order id, transaction id…)
  relatedExternalId?: string | null; // refunds: the payment's externalId
  /** Positive amount in minor units. Refunds are stored as negative by the ingester. */
  amountMinor: number;
  currency: string; // ISO 4217
  occurredAt: Date;
  customer: {
    email?: string | null;
    name?: string | null;
    phone?: string | null;
    visitorId?: string | null; // AdLedger visitor id passed through checkout metadata
    externalCustomerId?: string | null;
  };
};

export type WebhookRequest = { rawBody: string; headers: Headers; url: string };

/** Revenue connector: verifies and parses webhooks, optionally backfills history. */
export interface RevenueConnector {
  meta: IntegrationMeta & { category: "revenue" };
  source: string; // stored in revenue_events.source, e.g. "shopify"
  verifyWebhook(req: WebhookRequest, conn: ConnectionLike): boolean | Promise<boolean>;
  parseWebhook(payload: unknown, req: WebhookRequest): RevenueEventInput[];
  backfill?(conn: ConnectionLike, opts: { sinceMs: number }): Promise<RevenueEventInput[]>;
}

/** A notification to deliver through any channel. */
export type NotificationMessage = {
  title: string;
  /** Plain text body; may use **bold** and "- " bullets (channels convert as they can). */
  text: string;
  severity: "info" | "success" | "warning" | "critical";
  url?: string; // deep link into the dashboard
  fields?: { label: string; value: string }[];
};

export interface NotificationChannelDriver {
  meta: IntegrationMeta & { category: "notifications" };
  type: string; // "email" | "slack" | "discord" | "teams" | "webhook" | "sms"
  send(conn: ConnectionLike, msg: NotificationMessage): Promise<void>;
}
