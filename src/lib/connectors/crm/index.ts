import { hubspotConnector } from "./hubspot";
import { pipedriveConnector } from "./pipedrive";
import type { CrmConnector } from "./shared";

export type { CrmConnector } from "./shared";

/** CRM deal sources (offline / sales-led revenue). Also listed in REVENUE_CONNECTORS for sync + catalog. */
export const CRM_CONNECTORS: CrmConnector[] = [hubspotConnector, pipedriveConnector];

export function getCrmConnector(provider: string): CrmConnector | undefined {
  return CRM_CONNECTORS.find((c) => c.meta.provider === provider);
}
