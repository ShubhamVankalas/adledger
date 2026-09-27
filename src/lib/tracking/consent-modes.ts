import type { PixelConsentMode } from "../db/schema";

// Pixel consent modes and the copy-paste glue for popular cookie banners. Pure data: shared by the
// Settings page (client) and the server action that validates a choice.

export type { PixelConsentMode };

export const CONSENT_MODES: Record<PixelConsentMode, { label: string; tag: string; summary: string; detail: string }> = {
  optout: {
    label: "Opt-out",
    tag: "Default",
    summary: "Track every visitor with a first-party cookie. Visitors who say no in your banner are forgotten.",
    detail: "Best when most of your visitors are outside the EU and UK.",
  },
  required: {
    label: "Consent required",
    tag: "EU and UK",
    summary: "Nothing is stored or sent until the visitor agrees in your cookie banner.",
    detail: "The landing page is held in memory, so the ad click still counts when they agree. Only people who agreed are sent to Meta and Google.",
  },
  cookieless: {
    label: "Cookieless",
    tag: "No cookies",
    summary: "No cookies or storage. Every page load gets a fresh ID.",
    detail: "Visits can't be joined into journeys, so attribution is weaker. Conversions are only sent to ad platforms for people who agreed.",
  },
};

export const CONSENT_MODE_ORDER: PixelConsentMode[] = ["optout", "required", "cookieless"];

export function isConsentMode(v: unknown): v is PixelConsentMode {
  return typeof v === "string" && (CONSENT_MODE_ORDER as string[]).includes(v);
}

export type BannerSnippet = { id: string; name: string; note: string; language: "HTML" | "JavaScript"; code: string };

/** Glue code that reports the visitor's answer to AdLedger. Every snippet calls adledger.consent(true | false). */
export const BANNER_SNIPPETS: BannerSnippet[] = [
  {
    id: "cookiebot",
    name: "Cookiebot",
    note: "Uses the Marketing category. Paste after the AdLedger snippet.",
    language: "HTML",
    code: `<script>
  function adledgerCookiebot() {
    adledger.consent(!!(window.Cookiebot && Cookiebot.consent.marketing));
  }
  window.addEventListener("CookiebotOnAccept", adledgerCookiebot);
  window.addEventListener("CookiebotOnDecline", adledgerCookiebot);
</script>`,
  },
  {
    id: "cookieyes",
    name: "CookieYes",
    note: "Uses the Advertisement category. Paste after the AdLedger snippet.",
    language: "HTML",
    code: `<script>
  function adledgerCookieYes() {
    var c = window.getCkyConsent && getCkyConsent();
    if (c && c.isUserActionCompleted) adledger.consent(!!c.categories.advertisement);
  }
  document.addEventListener("cookieyes_banner_load", adledgerCookieYes);
  document.addEventListener("cookieyes_consent_update", adledgerCookieYes);
</script>`,
  },
  {
    id: "osano",
    name: "Osano",
    note: "Uses the Marketing category. Paste after the Osano script and the AdLedger snippet.",
    language: "HTML",
    code: `<script>
  function adledgerOsano(consent) {
    if (consent && consent.MARKETING) adledger.consent(consent.MARKETING === "ACCEPT");
  }
  Osano.cm.addEventListener("osano-cm-initialized", adledgerOsano);
  Osano.cm.addEventListener("osano-cm-consent-saved", adledgerOsano);
</script>`,
  },
  {
    id: "klaro",
    name: "Klaro",
    note: "Add AdLedger as a service in your Klaro config. Klaro calls it on every page and when the answer changes.",
    language: "JavaScript",
    code: `// klaroConfig.services
{
  name: "adledger",
  title: "AdLedger",
  purposes: ["marketing"],
  callback: function (consent) {
    adledger.consent(consent);
  },
},`,
  },
  {
    id: "gcm",
    name: "Consent Mode v2",
    note: "For any banner that updates Google Consent Mode v2. AdLedger follows ad_user_data. Paste after the AdLedger snippet and before your Google tag or Tag Manager.",
    language: "HTML",
    code: `<script>
  (function () {
    function read(a) {
      if (a && a[0] === "consent" && a[1] === "update" && a[2] && a[2].ad_user_data) {
        adledger.consent(a[2].ad_user_data === "granted");
      }
    }
    var dl = (window.dataLayer = window.dataLayer || []);
    for (var i = 0; i < dl.length; i++) read(dl[i]);
    var push = dl.push;
    dl.push = function () {
      for (var j = 0; j < arguments.length; j++) read(arguments[j]);
      return push.apply(dl, arguments);
    };
  })();
</script>`,
  },
  {
    id: "other",
    name: "Other",
    note: "Any banner or your own code: call this when the visitor answers. AdLedger remembers a yes for 13 months.",
    language: "JavaScript",
    code: `// The visitor accepted marketing cookies
adledger.consent(true);

// The visitor rejected them
adledger.consent(false);`,
  },
];
