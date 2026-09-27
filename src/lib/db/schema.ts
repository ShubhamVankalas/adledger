import type { Platform } from "../connectors/types";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Conventions:
// - every table except `workspaces` and `app_meta` carries workspace_id
// - money = *_minor bigint (integer minor units) + currency char(3)
// - timestamps are timestamptz in UTC

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const tstz = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => bigint(name, { mode: "number" });
/** Raw bytes (small images only: avatars and logos, validated and capped at upload). */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });
const workspaceId = () =>
  uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" });

/** Instance-level key/value (e.g. generated app secret). Not tenant data. */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- tenancy
//
// organization (a business or an agency)
//   ├── memberships: users + role (+ optional workspace restriction for clients)
//   └── workspaces: one per business/brand/client — all tracked data hangs off these

export type Role = "owner" | "admin" | "analyst" | "viewer" | "client";

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /** Logo shown in the sidebar and switcher: square 256px PNG/JPEG/WebP (<= 300 KB), see lib/media.ts. */
  logo: bytea("logo"),
  logoType: text("logo_type"),
  logoUpdatedAt: tstz("logo_updated_at"),
  createdAt: createdAt(),
});

export const workspaces = pgTable("workspaces", {
  id: id(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  reportingCurrency: text("reporting_currency").notNull().default("USD"),
  timezone: text("timezone").notNull().default("UTC"),
  attributionWindowDays: integer("attribution_window_days").notNull().default(30),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Onboarding progress: which platforms the user picked, dismissed checklist, etc. */
  onboarding: jsonb("onboarding").$type<{ platforms?: string[]; dismissed?: boolean; completedAt?: string }>().notNull().default({}),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    // Login identity of a team member (not a tracked contact). Access comes from memberships.
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash").notNull(),
    lastLoginAt: tstz("last_login_at"),
    /** Profile picture: square 256px PNG/JPEG/WebP (<= 300 KB), see lib/media.ts. */
    avatar: bytea("avatar"),
    avatarType: text("avatar_type"),
    avatarUpdatedAt: tstz("avatar_updated_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    /** null = every workspace in the organization; otherwise only these (used for clients). */
    workspaceIds: jsonb("workspace_ids").$type<string[] | null>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId), index().on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Role>().notNull(),
    workspaceIds: jsonb("workspace_ids").$type<string[] | null>(),
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: tstz("expires_at").notNull(),
    acceptedAt: tstz("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invitations_token_uq").on(t.tokenHash), index().on(t.organizationId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    target: text("target"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    workspaceId: workspaceId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: tstz("expires_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index().on(t.userId)],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    lastUsedAt: tstz("last_used_at"),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_uq").on(t.keyHash), index().on(t.workspaceId)],
);

export const pixelSites = pgTable(
  "pixel_sites",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    // Allowed hostnames, comma separated. Empty = accept any origin.
    domains: text("domains").notNull().default(""),
    publicKey: text("public_key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pixel_sites_key_uq").on(t.publicKey), index().on(t.workspaceId)],
);

export const leadWebhooks = pgTable(
  "lead_webhooks",
  {
    id: id(),
    workspaceId: workspaceId(),
    name: text("name").notNull(),
    // Low-privilege token (can only create leads); kept so the URL can be re-copied.
    token: text("token").notNull(),
    fieldMapping: jsonb("field_mapping").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lead_webhooks_token_uq").on(t.token), index().on(t.workspaceId)],
);

/** Credentials + status for Meta / Google Ads / Stripe / LLM. Secrets are AES-GCM encrypted. */
export const connections = pgTable(
  "connections",
  {
    id: id(),
    workspaceId: workspaceId(),
    provider: text("provider").$type<Provider>().notNull(),
    mode: text("mode").$type<"mock" | "live">().notNull().default("live"),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
    secretsEnc: text("secrets_enc"),
    lastSyncedAt: tstz("last_synced_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("connections_provider_uq").on(t.workspaceId, t.provider)],
);
/** Integration id from src/lib/connectors/registry.ts (e.g. "meta", "tiktok_ads", "shopify", "slack") or "llm". */
export type Provider = string;

// ---------------------------------------------------------------- ads

export const adAccounts = pgTable(
  "ad_accounts",
  {
    id: id(),
    workspaceId: workspaceId(),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    timezone: text("timezone"),
    status: text("status"),
    lastSyncedAt: tstz("last_synced_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ad_accounts_ext_uq").on(t.workspaceId, t.platform, t.externalId)],
);
export type { Platform };

/** Which events go to which notification channel (channels live in `connections` as notify_*). */
export const notificationRules = pgTable(
  "notification_rules",
  {
    id: id(),
    workspaceId: workspaceId(),
    channel: text("channel").notNull(), // connections.provider, e.g. "notify_slack"
    event: text("event").$type<NotificationEvent>().notNull(),
    settings: jsonb("settings").$type<Record<string, string | number>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    lastSentAt: tstz("last_sent_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("notification_rules_uq").on(t.workspaceId, t.channel, t.event)],
);
export type NotificationEvent = "weekly_report" | "daily_digest" | "wasted_spend" | "sync_failed" | "new_customer" | "big_payment";

export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    workspaceId: workspaceId(),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    objective: text("objective"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("campaigns_ext_uq").on(t.workspaceId, t.platform, t.externalId),
    index().on(t.adAccountId),
  ],
);

export const adGroups = pgTable(
  "ad_groups",
  {
    id: id(),
    workspaceId: workspaceId(),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ad_groups_ext_uq").on(t.workspaceId, t.platform, t.externalId),
    index().on(t.campaignId),
  ],
);

export const ads = pgTable(
  "ads",
  {
    id: id(),
    workspaceId: workspaceId(),
    adGroupId: uuid("ad_group_id")
      .notNull()
      .references(() => adGroups.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    status: text("status"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ads_ext_uq").on(t.workspaceId, t.platform, t.externalId),
    index().on(t.adGroupId),
    index().on(t.campaignId),
  ],
);

export const adInsightsDaily = pgTable(
  "ad_insights_daily",
  {
    id: id(),
    workspaceId: workspaceId(),
    platform: text("platform").$type<Platform>().notNull(),
    date: date("date", { mode: "string" }).notNull(),
    adAccountId: uuid("ad_account_id")
      .notNull()
      .references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    adGroupId: uuid("ad_group_id")
      .notNull()
      .references(() => adGroups.id, { onDelete: "cascade" }),
    adId: uuid("ad_id")
      .notNull()
      .references(() => ads.id, { onDelete: "cascade" }),
    spendMinor: money("spend_minor").notNull(),
    currency: text("currency").notNull(),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    platformConversions: numeric("platform_conversions", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ad_insights_daily_uq").on(t.workspaceId, t.platform, t.adId, t.date),
    index().on(t.workspaceId, t.date),
    index().on(t.campaignId),
    index().on(t.adGroupId),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: id(),
    workspaceId: workspaceId(),
    provider: text("provider").$type<Provider>().notNull(),
    startedAt: tstz("started_at").notNull().defaultNow(),
    finishedAt: tstz("finished_at"),
    status: text("status").$type<"running" | "success" | "error">().notNull(),
    rowsUpserted: integer("rows_upserted").notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.startedAt)],
);

// ---------------------------------------------------------------- first-party tracking

export const visitors = pgTable(
  "visitors",
  {
    id: id(),
    workspaceId: workspaceId(),
    anonymousId: text("anonymous_id").notNull(),
    firstSeenAt: tstz("first_seen_at").notNull(),
    lastSeenAt: tstz("last_seen_at").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("visitors_anon_uq").on(t.workspaceId, t.anonymousId),
    index().on(t.contactId),
  ],
);

export const events = pgTable(
  "events",
  {
    id: id(),
    workspaceId: workspaceId(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    type: text("type").$type<"page_view" | "identify" | "lead" | "custom">().notNull(),
    name: text("name"),
    occurredAt: tstz("occurred_at").notNull(),
    url: text("url"),
    referrer: text("referrer"),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    ipTrunc: text("ip_trunc"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.occurredAt), index().on(t.visitorId)],
);

export const touchpoints = pgTable(
  "touchpoints",
  {
    id: id(),
    workspaceId: workspaceId(),
    visitorId: uuid("visitor_id")
      .notNull()
      .references(() => visitors.id, { onDelete: "cascade" }),
    occurredAt: tstz("occurred_at").notNull(),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmContent: text("utm_content"),
    utmTerm: text("utm_term"),
    clickIdType: text("click_id_type"),
    clickId: text("click_id"),
    fbp: text("fbp"),
    fbc: text("fbc"),
    landingUrl: text("landing_url"),
    referrer: text("referrer"),
    channel: text("channel").$type<Channel>().notNull(),
    platform: text("platform").$type<Platform>(),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    adGroupId: uuid("ad_group_id").references(() => adGroups.id, { onDelete: "set null" }),
    adId: uuid("ad_id").references(() => ads.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.occurredAt),
    index().on(t.visitorId),
    index().on(t.campaignId),
  ],
);
export type Channel =
  | "paid_social"
  | "paid_search"
  | "organic"
  | "referral"
  | "direct"
  | "email";

// ---------------------------------------------------------------- people & money

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    workspaceId: workspaceId(),
    // The ONLY place a raw email is stored.
    email: text("email"),
    emailHash: text("email_hash"),
    phoneHash: text("phone_hash"),
    name: text("name"),
    firstSeenAt: tstz("first_seen_at").notNull(),
    lifecycle: text("lifecycle").$type<"lead" | "customer">().notNull().default("lead"),
    externalIds: jsonb("external_ids").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("contacts_email_hash_uq").on(t.workspaceId, t.emailHash),
    index().on(t.workspaceId, t.phoneHash),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    workspaceId: workspaceId(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    source: text("source").$type<"pixel" | "webhook" | "api" | "csv">().notNull(),
    formName: text("form_name"),
    occurredAt: tstz("occurred_at").notNull(),
    // PII-redacted copy of the submitted payload.
    raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.occurredAt), index().on(t.contactId)],
);

export const revenueEvents = pgTable(
  "revenue_events",
  {
    id: id(),
    workspaceId: workspaceId(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    // "stripe", "shopify", "woocommerce", "paddle", "lemonsqueezy", "razorpay", "paypal", "api", "csv"…
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    // For refunds: the external_id of the payment being refunded.
    relatedExternalId: text("related_external_id"),
    type: text("type").$type<"payment" | "refund">().notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    occurredAt: tstz("occurred_at").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("revenue_events_ext_uq").on(t.workspaceId, t.source, t.externalId),
    index().on(t.workspaceId, t.occurredAt),
    index().on(t.contactId),
  ],
);

// ---------------------------------------------------------------- derived

export const attributionCredits = pgTable(
  "attribution_credits",
  {
    id: id(),
    workspaceId: workspaceId(),
    model: text("model").$type<AttributionModel>().notNull(),
    conversionType: text("conversion_type").$type<ConversionType>().notNull(),
    conversionId: uuid("conversion_id").notNull(),
    conversionAt: tstz("conversion_at").notNull(),
    contactId: uuid("contact_id"),
    // null touchpoint = the "unattributed" bucket
    touchpointId: uuid("touchpoint_id"),
    channel: text("channel").$type<Channel>(),
    platform: text("platform").$type<Platform>(),
    campaignId: uuid("campaign_id"),
    adGroupId: uuid("ad_group_id"),
    adId: uuid("ad_id"),
    credit: numeric("credit", { precision: 9, scale: 6 }).notNull(),
    revenueMinor: money("revenue_minor").notNull().default(0),
    currency: text("currency"),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.workspaceId, t.model, t.conversionType, t.conversionAt),
    index().on(t.campaignId),
    index().on(t.conversionId),
  ],
);
export type AttributionModel = "first_touch" | "last_touch" | "linear";
export type ConversionType = "lead" | "customer" | "revenue";

export const aiReports = pgTable(
  "ai_reports",
  {
    id: id(),
    workspaceId: workspaceId(),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    modelName: text("model_name").notNull(),
    facts: jsonb("facts").$type<Record<string, unknown>>().notNull(),
    contentMd: text("content_md").notNull(),
    unverifiedNumbers: jsonb("unverified_numbers").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------- conversion uploads (CAPI)

/**
 * Server-side conversions sent back to ad platforms (Meta Conversions API, Google Ads
 * click conversions). One row per platform × conversion, so uploads are idempotent;
 * pending rows are retried with backoff by the scheduled job.
 */
export const conversionUploads = pgTable(
  "conversion_uploads",
  {
    id: id(),
    workspaceId: workspaceId(),
    platform: text("platform").$type<UploadPlatform>().notNull(),
    conversionType: text("conversion_type").$type<UploadConversionType>().notNull(),
    // leads.id or revenue_events.id, depending on conversion_type
    conversionId: uuid("conversion_id").notNull(),
    conversionAt: tstz("conversion_at").notNull(),
    status: text("status").$type<UploadStatus>().notNull().default("pending"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: tstz("next_attempt_at").notNull().defaultNow(),
    // true when mock mode recorded the upload as sent without a network call
    mock: boolean("mock").notNull().default(false),
    sentAt: tstz("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversion_uploads_uq").on(t.workspaceId, t.platform, t.conversionType, t.conversionId),
    index().on(t.workspaceId, t.status, t.nextAttemptAt),
  ],
);
export type UploadPlatform = "meta" | "google";
export type UploadConversionType = "lead" | "purchase";
export type UploadStatus = "pending" | "sent" | "failed" | "skipped";

// ---------------------------------------------------------------- alerts (Insights → Alerts)

export type AlertMetric = "cac" | "cpl" | "roas" | "spend" | "revenue" | "leads";
export type AlertComparator = "gt" | "lt";
export type AlertScope = "workspace" | "platform" | "campaign";

/**
 * Threshold rules ("CAC above $80 over the last 2 days on Meta") and the built-in anomaly rule
 * (kind = "anomaly": z-score on daily revenue, spend and leads). Evaluated hourly by the
 * notifications job; a rule notifies once per breach and never more often than `cooldown_hours`.
 * Money thresholds are integer minor units in `threshold_minor`; ratios, counts and the anomaly
 * z-score use `threshold_value`.
 */
export const alertRules = pgTable(
  "alert_rules",
  {
    id: id(),
    workspaceId: workspaceId(),
    kind: text("kind").$type<"threshold" | "anomaly">().notNull().default("threshold"),
    name: text("name").notNull(),
    metric: text("metric").$type<AlertMetric | "anomaly">().notNull(),
    comparator: text("comparator").$type<AlertComparator>().notNull().default("gt"),
    thresholdMinor: bigint("threshold_minor", { mode: "number" }),
    thresholdValue: numeric("threshold_value", { precision: 14, scale: 4 }),
    windowDays: integer("window_days").notNull().default(1),
    scope: text("scope").$type<AlertScope>().notNull().default("workspace"),
    /** Platform id (scope = platform) or campaigns.id (scope = campaign). */
    scopeId: text("scope_id"),
    /** notify_* connection providers that receive this alert. */
    channels: jsonb("channels").$type<string[]>().notNull().default([]),
    cooldownHours: integer("cooldown_hours").notNull().default(24),
    enabled: boolean("enabled").notNull().default(true),
    state: text("state").$type<"ok" | "breached">().notNull().default("ok"),
    /** Last observed value: minor units for money metrics, otherwise the ratio / count. */
    lastValue: numeric("last_value", { precision: 20, scale: 4 }),
    lastEvaluatedAt: tstz("last_evaluated_at"),
    lastTriggeredAt: tstz("last_triggered_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.kind)],
);

/** Alert history: every trigger and resolution, and each anomaly. */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: id(),
    workspaceId: workspaceId(),
    ruleId: uuid("rule_id").references(() => alertRules.id, { onDelete: "set null" }),
    kind: text("kind").$type<"threshold" | "anomaly">().notNull(),
    status: text("status").$type<"triggered" | "resolved">().notNull(),
    metric: text("metric").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    /** Observed value: minor units for money metrics, otherwise the ratio / count. */
    value: numeric("value", { precision: 20, scale: 4 }),
    periodStart: date("period_start", { mode: "string" }).notNull(),
    periodEnd: date("period_end", { mode: "string" }).notNull(),
    /** Channels the message reached (failed deliveries are left out). */
    delivered: jsonb("delivered").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.createdAt), index().on(t.ruleId)],
);

// ---------------------------------------------------------------- share links (/share/[token])

export type ShareRange = "7d" | "14d" | "30d" | "90d";
export type ShareFilters = {
  /** Rolling window ending on the latest day with data, or a fixed `start`–`end`. */
  range?: ShareRange;
  start?: string;
  end?: string;
  model: AttributionModel;
  platform?: Platform;
};

/** Read-only, aggregate-only links for clients. The token is shown once; only its SHA-256 is stored. */
export const shareLinks = pgTable(
  "share_links",
  {
    id: id(),
    workspaceId: workspaceId(),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    page: text("page").$type<"overview">().notNull().default("overview"),
    filters: jsonb("filters").$type<ShareFilters>().notNull(),
    expiresAt: tstz("expires_at").notNull(),
    revokedAt: tstz("revoked_at"),
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: tstz("last_viewed_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("share_links_token_uq").on(t.tokenHash), index().on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------- Ask (Insights → Ask)

export type AskColumnKind = "text" | "platform" | "money" | "ratio" | "count" | "credit" | "pct" | "date";
export type AskTableColumn = { key: string; label: string; kind: AskColumnKind };
export type AskTable = {
  title: string;
  /** Period, model and scope in words, e.g. "Aug 3 – Sep 1, 2026 · Linear attribution". */
  caption: string;
  currency: string;
  columns: AskTableColumn[];
  /** Raw values from reports.ts: money in minor units, ratios as numbers. */
  rows: Record<string, string | number | null>[];
  /** Dashboard page with the same filters, where the numbers can be checked. */
  source: string;
};

/** Per-user Ask history. Answers carry the SQL result tables they cite. */
export const askMessages = pgTable(
  "ask_messages",
  {
    id: id(),
    workspaceId: workspaceId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    content: text("content").notNull(),
    tables: jsonb("tables").$type<AskTable[]>().notNull().default([]),
    /** Numbers in the answer that no tool result contains (shown as a warning). */
    unverifiedNumbers: jsonb("unverified_numbers").$type<string[]>().notNull().default([]),
    modelName: text("model_name"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.workspaceId, t.userId, t.createdAt)],
);

