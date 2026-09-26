import { NOTIFICATION_DRIVERS } from "../notify/channels";
import { googleConnector, metaConnector } from "./ads";
import { EXTRA_ADS_CONNECTORS } from "./ads/index";
import { getCrmConnector } from "./crm/index";
import { LEAD_CONNECTORS, getLeadConnector } from "./leads/index";
import { WHATSAPP_PROVIDER, whatsappIntegration } from "./leads-whatsapp";
import { REVENUE_CONNECTORS } from "./revenue/index";
import { stripeIntegration } from "./stripe";
import type { AdsConnector, IntegrationMeta, NotificationChannelDriver, RevenueConnector } from "./types";

// Single source of truth for every integration: the Settings catalog, the connect forms,
// scheduled syncs and webhook routing all read from here.

export const ADS_CONNECTORS: AdsConnector[] = [metaConnector, googleConnector, ...EXTRA_ADS_CONNECTORS];

export function getAdsConnector(provider: string): AdsConnector | undefined {
  return ADS_CONNECTORS.find((c) => c.meta.provider === provider);
}

export function getRevenueConnector(provider: string): RevenueConnector | undefined {
  return REVENUE_CONNECTORS.find((c) => c.meta.provider === provider);
}

/**
 * Where a provider's webhooks arrive (path after the public origin), or null when it has none.
 * Gumroad and Recurly read a query parameter (`token` / `currency`), so it is part of the URL shown.
 */
export function webhookPathFor(provider: string, workspaceId: string, opts: { currency?: string } = {}): string | null {
  if (provider === "stripe") return `/api/v1/webhooks/stripe/${workspaceId}`;
  if (provider === WHATSAPP_PROVIDER) return `/api/v1/webhooks/whatsapp/${workspaceId}`;
  if (getLeadConnector(provider)) return `/api/v1/webhooks/leads-native/${provider}/${workspaceId}`;
  if (getCrmConnector(provider)) return `/api/v1/webhooks/crm/${provider}/${workspaceId}`;
  if (!getRevenueConnector(provider)) return null;
  const path = `/api/v1/webhooks/${provider}/${workspaceId}`;
  if (provider === "gumroad") return `${path}?token=YOUR_PING_TOKEN`;
  if (provider === "recurly") return `${path}?currency=${(opts.currency || "USD").toUpperCase()}`;
  return path;
}

export function getNotificationDriver(type: string): NotificationChannelDriver | undefined {
  return NOTIFICATION_DRIVERS.find((d) => d.type === type);
}

/** Built-in capabilities that aren't connectors but appear in the catalog. */
const BUILT_IN: IntegrationMeta[] = [
  {
    provider: "pixel",
    name: "Website pixel",
    category: "website",
    description: "One script tag for any website: page views, UTMs, click IDs and form leads.",
    status: "stable",
    color: "#0f9d74",
    docsUrl: "/settings/workspace/tracking",
    fields: [],
    steps: [],
  },
  {
    provider: "lead_webhook",
    name: "Form webhooks",
    category: "leads",
    description: "Typeform, Tally, Webflow, Jotform, Zapier, Make or any form that can POST.",
    status: "stable",
    color: "#7c3aed",
    docsUrl: "/settings/workspace/tracking",
    fields: [],
    steps: [],
  },
  {
    provider: "csv_import",
    name: "CSV import",
    category: "import",
    description: "Upload spend or revenue from any platform we don't connect to directly.",
    status: "stable",
    color: "#475569",
    docsUrl: "/settings/workspace/import",
    fields: [],
    steps: [],
  },
  {
    provider: "api_import",
    name: "Spend & Conversions API",
    category: "import",
    description: "Push data from Zapier, Make, n8n or your own code — covers 100+ other platforms.",
    status: "stable",
    color: "#0ea5e9",
    docsUrl: "/settings/workspace/import",
    fields: [],
    steps: [],
  },
];

export function allIntegrations(): IntegrationMeta[] {
  return [
    ...ADS_CONNECTORS.map((c) => c.meta),
    stripeIntegration,
    ...REVENUE_CONNECTORS.map((c) => c.meta),
    whatsappIntegration,
    ...NOTIFICATION_DRIVERS.map((d) => d.meta),
    ...BUILT_IN,
    ...LEAD_CONNECTORS.map((c) => c.meta),
  ];
}

export function getIntegration(provider: string): IntegrationMeta | undefined {
  return allIntegrations().find((i) => i.provider === provider);
}
