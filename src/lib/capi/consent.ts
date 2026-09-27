import type { ConsentState, UploadConsentBasis, UploadSkipReason } from "../db/schema";

// Consent rules for server-side conversion uploads. One decision per conversion, applied the
// same way to every platform:
//
//   denied   the person said no (CMP refusal, adledger.consent(false), or contacts.ads_consent)
//            -> not uploaded, skip_reason "consent_denied"
//   none     the workspace runs a strict pixel mode (required / cookieless, i.e. EU/UK visitors)
//            and nobody said yes -> not uploaded, skip_reason "no_ads_consent"
//   limited  the browser sent Global Privacy Control -> Meta gets data_processing_options ["LDU"],
//            Google gets both consent fields DENIED and no user identifiers (click ID only)
//   granted  explicit yes -> Google consent GRANTED / GRANTED
//   implied  opt-out mode, nobody objected -> uploaded; Google consent UNSPECIFIED so Google
//            applies its own regional rules (we never claim a consent we didn't collect)
//
// GPC wins over a "yes" given in a banner: it is a legal opt-out signal in several US states.

export type ConsentBasis = UploadConsentBasis;
export type SkipReason = UploadSkipReason;

export type ConsentInput = {
  /** contacts.ads_consent: the latest explicit answer, null when never asked. */
  adsConsent: ConsentState | null;
  /** Any of the contact's browsers sent Global Privacy Control. */
  gpc: boolean;
  /** The workspace has a pixel in `required` or `cookieless` mode. */
  strict: boolean;
};

export type ConsentDecision = { basis: "granted" | "implied" | "limited" } | { basis: "denied" | "none"; skip: SkipReason; message: string };

export function uploadConsent(c: ConsentInput): ConsentDecision {
  if (c.adsConsent === "denied") return { basis: "denied", skip: "consent_denied", message: "Ads consent denied" };
  if (c.adsConsent !== "granted" && c.strict) {
    return { basis: "none", skip: "no_ads_consent", message: "No ads consent (strict consent mode)" };
  }
  if (c.gpc) return { basis: "limited" };
  return { basis: c.adsConsent === "granted" ? "granted" : "implied" };
}

/** Google Data Manager API ConsentStatus values. */
export type GoogleConsentStatus = "CONSENT_GRANTED" | "CONSENT_DENIED" | "CONSENT_STATUS_UNSPECIFIED";
export type GoogleConsent = { adUserData: GoogleConsentStatus; adPersonalization: GoogleConsentStatus };

export function googleConsent(basis: "granted" | "implied" | "limited"): GoogleConsent {
  if (basis === "granted") return { adUserData: "CONSENT_GRANTED", adPersonalization: "CONSENT_GRANTED" };
  if (basis === "limited") return { adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" };
  return { adUserData: "CONSENT_STATUS_UNSPECIFIED", adPersonalization: "CONSENT_STATUS_UNSPECIFIED" };
}

/** Meta Limited Data Use. Country/state 0 = Meta geolocates the event. `[]` explicitly opts out of LDU. */
export function metaDataProcessing(basis: "granted" | "implied" | "limited") {
  return basis === "limited"
    ? { data_processing_options: ["LDU"] as "LDU"[], data_processing_options_country: 0 as const, data_processing_options_state: 0 as const }
    : { data_processing_options: [] as "LDU"[] };
}

/** Plain-language labels for skip reasons (Settings, upload lists). */
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  consent_denied: "Consent denied",
  no_ads_consent: "No ads consent",
  limited_no_click_id: "Privacy signal and no click ID",
  no_match_keys: "Nothing to match on",
  too_old: "Too old for the platform",
  no_value: "No payment amount",
  no_action: "No conversion action set",
  missing: "Conversion was deleted",
};

export const CONSENT_SKIPS: SkipReason[] = ["consent_denied", "no_ads_consent", "limited_no_click_id"];
