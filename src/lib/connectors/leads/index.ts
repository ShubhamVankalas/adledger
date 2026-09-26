import { googleLeadsConnector } from "./google";
import { metaLeadsConnector } from "./meta";
import { tiktokLeadsConnector } from "./tiktok";
import type { LeadConnector } from "./types";

/** Native ad-platform lead forms (one file per platform in this folder). */
export const LEAD_CONNECTORS: LeadConnector[] = [metaLeadsConnector, googleLeadsConnector, tiktokLeadsConnector];

export function getLeadConnector(provider: string): LeadConnector | undefined {
  return LEAD_CONNECTORS.find((c) => c.meta.provider === provider);
}
