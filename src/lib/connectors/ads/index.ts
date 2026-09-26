import type { AdsConnector } from "../types";
import { linkedinConnector } from "./linkedin";
import { microsoftConnector } from "./microsoft";
import { pinterestConnector } from "./pinterest";
import { redditConnector } from "./reddit";
import { snapchatConnector } from "./snapchat";
import { tiktokConnector } from "./tiktok";
import { xConnector } from "./x";

/** Ad-platform connectors beyond Meta and Google (one file per platform in this folder). */
export const EXTRA_ADS_CONNECTORS: AdsConnector[] = [
  microsoftConnector,
  tiktokConnector,
  linkedinConnector,
  pinterestConnector,
  snapchatConnector,
  redditConnector,
  xConnector,
];
