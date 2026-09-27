import { BracesIcon, CodeXmlIcon, FileSpreadsheetIcon, MailIcon, TextCursorInputIcon, WebhookIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIMPLE_ICONS } from "./brand-icons.data";

// Marks that Simple Icons doesn't ship, drawn as simple SVG (multi-colour where the brand is).
const CUSTOM: Record<string, { title: string; hex: string; svg: React.ReactNode }> = {
  // Woo's own mark is a wide wordmark that reads as a dash at icon size, so it sits in its speech bubble.
  woo: {
    title: "WooCommerce",
    hex: "#7F54B3",
    svg: (
      <>
        <path d="M4.5 4.5h15a3.5 3.5 0 0 1 3.5 3.5v8a3.5 3.5 0 0 1-3.5 3.5h-5.2l-4.1 2.6.9-2.6H4.5A3.5 3.5 0 0 1 1 16V8a3.5 3.5 0 0 1 3.5-3.5z" fill="#7F54B3" />
        <path transform="translate(3.6 2.6) scale(0.7)" fill="#fff" d="M10.118 8.895c-.562 0-.928.183-1.255.797l-1.49 2.811v-2.496c0-.745-.353-1.111-1.007-1.111s-.928.222-1.255.85l-1.412 2.757v-2.47c0-.797-.327-1.137-1.124-1.137H.954C.34 8.895 0 9.183 0 9.706s.327.837.928.837h.667v3.15c0 .889.601 1.412 1.464 1.412s1.255-.34 1.686-1.137l.941-1.765v1.49c0 .876.575 1.412 1.451 1.412s1.203-.301 1.699-1.137l2.17-3.66c.471-.798.144-1.413-.901-1.413zm4.078 0c-1.778 0-3.124 1.321-3.124 3.112s1.359 3.098 3.124 3.098 3.111-1.32 3.124-3.098c0-1.791-1.359-3.112-3.124-3.112m0 4.301c-.667 0-1.124-.497-1.124-1.19s.458-1.203 1.124-1.203 1.124.51 1.124 1.203-.444 1.19-1.124 1.19m6.68-4.301c-1.765 0-3.124 1.32-3.124 3.111s1.359 3.098 3.124 3.098S24 13.784 24 12.006s-1.359-3.111-3.124-3.111m0 4.301c-.68 0-1.111-.497-1.111-1.19s.444-1.203 1.111-1.203S22 11.313 22 12.006s-.444 1.19-1.124 1.19" />
      </>
    ),
  },
  chargebee: {
    title: "Chargebee",
    hex: "#FF3300",
    svg: (
      <>
        <rect x="1" y="1" width="22" height="22" rx="5.5" fill="#FF3300" />
        <path d="M16.4 8.3a5.4 5.4 0 1 0 0 7.4" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      </>
    ),
  },
  recurly: {
    title: "Recurly",
    hex: "#6C3BE4",
    svg: (
      <>
        <circle cx="12" cy="12" r="11" fill="#6C3BE4" />
        <g transform="translate(5.6 5.6) scale(0.533)" fill="none" stroke="#fff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
        </g>
      </>
    ),
  },
  cashfree: {
    title: "Cashfree Payments",
    hex: "#6933D3",
    svg: (
      <>
        <rect x="1" y="1" width="22" height="22" rx="5.5" fill="#6933D3" />
        <path d="M5.8 10c2.07-3 4.13-3 6.2 0s4.13 3 6.2 0M5.8 15c2.07-3 4.13-3 6.2 0s4.13 3 6.2 0" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" />
      </>
    ),
  },
  instamojo: {
    title: "Instamojo",
    hex: "#3D4FE0",
    svg: (
      <>
        <rect x="1" y="1" width="22" height="22" rx="11" fill="#3D4FE0" />
        <rect x="10.6" y="10" width="2.8" height="8" rx="1.4" fill="#fff" />
        <circle cx="12" cy="6.9" r="1.7" fill="#FFC53D" />
      </>
    ),
  },
  pipedrive: {
    title: "Pipedrive",
    hex: "#017737",
    svg: (
      <>
        <circle cx="12" cy="12" r="11" fill="#017737" />
        <rect x="7.6" y="6.9" width="2.8" height="12" rx="1.4" fill="#fff" />
        <circle cx="12.6" cy="10.9" r="3.5" fill="none" stroke="#fff" strokeWidth="2.6" />
      </>
    ),
  },
  microsoft: {
    title: "Microsoft",
    hex: "#00A4EF",
    svg: (
      <>
        <rect x="1" y="1" width="10.5" height="10.5" fill="#F25022" />
        <rect x="12.5" y="1" width="10.5" height="10.5" fill="#7FBA00" />
        <rect x="1" y="12.5" width="10.5" height="10.5" fill="#00A4EF" />
        <rect x="12.5" y="12.5" width="10.5" height="10.5" fill="#FFB900" />
      </>
    ),
  },
  linkedin: {
    title: "LinkedIn",
    hex: "#0A66C2",
    svg: (
      <>
        <rect x="1" y="1" width="22" height="22" rx="3.5" fill="#0A66C2" />
        <rect x="5" y="9.5" width="3.1" height="9.5" fill="#fff" />
        <circle cx="6.55" cy="6.25" r="1.85" fill="#fff" />
        <path d="M10.4 9.5h3v1.35c.47-.86 1.6-1.65 3.2-1.65 3.1 0 3.6 2 3.6 4.6V19h-3.1v-4.6c0-1.1-.03-2.5-1.55-2.5-1.55 0-1.8 1.2-1.8 2.4V19h-3.35z" fill="#fff" />
      </>
    ),
  },
  slack: {
    title: "Slack",
    hex: "#4A154B",
    svg: (
      <>
        <rect x="7.8" y="2" width="3.2" height="9" rx="1.6" fill="#36C5F0" />
        <rect x="2" y="7.8" width="4.6" height="3.2" rx="1.6" fill="#36C5F0" />
        <rect x="13" y="7.8" width="9" height="3.2" rx="1.6" fill="#2EB67D" />
        <rect x="13" y="2" width="3.2" height="4.6" rx="1.6" fill="#2EB67D" />
        <rect x="13" y="13" width="3.2" height="9" rx="1.6" fill="#ECB22E" />
        <rect x="17.4" y="13" width="4.6" height="3.2" rx="1.6" fill="#ECB22E" />
        <rect x="2" y="13" width="9" height="3.2" rx="1.6" fill="#E01E5A" />
        <rect x="7.8" y="17.4" width="3.2" height="4.6" rx="1.6" fill="#E01E5A" />
      </>
    ),
  },
  teams: {
    title: "Microsoft Teams",
    hex: "#5059C9",
    svg: (
      <>
        <circle cx="19" cy="6.6" r="2.3" fill="#7B83EB" />
        <rect x="15.6" y="10" width="7" height="8.6" rx="2.8" fill="#7B83EB" />
        <circle cx="13" cy="5.2" r="3" fill="#5059C9" />
        <rect x="1.5" y="6.5" width="13.5" height="13.5" rx="2" fill="#4B53BC" />
        <rect x="4.6" y="9.6" width="7.3" height="2.1" fill="#fff" />
        <rect x="7.2" y="9.6" width="2.1" height="7.7" fill="#fff" />
      </>
    ),
  },
  twilio: {
    title: "Twilio",
    hex: "#F22F46",
    svg: (
      <>
        <circle cx="12" cy="12" r="11" fill="#F22F46" />
        <circle cx="12" cy="12" r="8" fill="#fff" />
        <circle cx="9.2" cy="9.2" r="2" fill="#F22F46" />
        <circle cx="14.8" cy="9.2" r="2" fill="#F22F46" />
        <circle cx="9.2" cy="14.8" r="2" fill="#F22F46" />
        <circle cx="14.8" cy="14.8" r="2" fill="#F22F46" />
      </>
    ),
  },
};

const GENERIC: Record<string, LucideIcon> = {
  email: MailIcon,
  webhook: WebhookIcon,
  pixel: CodeXmlIcon,
  form: TextCursorInputIcon,
  csv: FileSpreadsheetIcon,
  api: BracesIcon,
};

/** Which icon to show for an integration provider id or ad platform id. */
export const ICON_FOR: Record<string, string> = {
  meta: "meta",
  google_ads: "googleads",
  google: "googleads",
  microsoft_ads: "microsoft",
  microsoft: "microsoft",
  tiktok_ads: "tiktok",
  tiktok: "tiktok",
  linkedin_ads: "linkedin",
  linkedin: "linkedin",
  pinterest_ads: "pinterest",
  pinterest: "pinterest",
  snapchat_ads: "snapchat",
  snapchat: "snapchat",
  reddit_ads: "reddit",
  reddit: "reddit",
  x_ads: "x",
  x: "x",
  stripe: "stripe",
  shopify: "shopify",
  woocommerce: "woo",
  paddle: "paddle",
  lemonsqueezy: "lemonsqueezy",
  razorpay: "razorpay",
  paypal: "paypal",
  gumroad: "gumroad",
  notify_email: "email",
  notify_slack: "slack",
  notify_discord: "discord",
  notify_teams: "teams",
  notify_webhook: "webhook",
  notify_sms: "twilio",
  pixel: "pixel",
  lead_webhook: "form",
  csv_import: "csv",
  api_import: "api",
  other: "csv",
  // website builders / AI providers (onboarding, AI settings)
  "site:wordpress": "wordpress",
  "site:shopify": "shopify",
  "site:webflow": "webflow",
  "site:wix": "wix",
  "site:squarespace": "squarespace",
  "site:framer": "framer",
  "site:gtm": "googletagmanager",
  "site:code": "nextdotjs",
  anthropic: "anthropic",
  ollama: "ollama",
  google_gemini: "googlegemini",
  openrouter: "openrouter",
  deepseek: "deepseek",
  phonepe: "phonepe",
  meta_leads: "meta",
  google_ads_leads: "googleads",
  tiktok_leads: "tiktok",
  whatsapp: "whatsapp",
  hubspot: "hubspot",
};

function luminance(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function hasBrandIcon(id: string) {
  const key = ICON_FOR[id] ?? id;
  return Boolean(SIMPLE_ICONS[key] || CUSTOM[key] || GENERIC[key]);
}

/** Just the glyph (brand-coloured), for inline use in badges and chips. */
export function BrandGlyph({ id, name, className, onWhite }: { id: string; name?: string; className?: string; onWhite?: boolean }) {
  const key = ICON_FOR[id] ?? id;
  const custom = CUSTOM[key];
  if (custom) {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={custom.title} className={cn("size-4 shrink-0", className)}>
        {custom.svg}
      </svg>
    );
  }
  const si = SIMPLE_ICONS[key];
  if (si) {
    const light = luminance(si.hex) > 0.6;
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={si.title} className={cn("size-4 shrink-0", className)}>
        <path d={si.path} fill={light ? "#1a1a1a" : `#${si.hex}`} className={!onWhite && (si.hex === "000000" || si.hex === "191919") ? "dark:fill-white" : undefined} />
      </svg>
    );
  }
  const Generic = GENERIC[key];
  if (Generic) return <Generic className={cn("size-4 shrink-0 text-primary", className)} />;
  // No mark for this brand: its initial, so a logo slot is never left empty.
  return (
    <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center text-[10px] leading-none font-bold text-primary", className)}>
      {(name ?? id).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** App-icon style tile with the brand mark, used in the integrations catalog. */
export function BrandTile({ id, className }: { id: string; className?: string }) {
  const key = ICON_FOR[id] ?? id;
  const si = CUSTOM[key] ? undefined : SIMPLE_ICONS[key];
  const light = si ? luminance(si.hex) > 0.6 : false;
  const generic = !si && !CUSTOM[key];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-xl border shadow-xs",
        generic ? "border-primary/20 bg-primary/10" : "border-black/5 bg-white",
        className,
      )}
      style={light && si ? { background: `#${si.hex}` } : undefined}
    >
      <BrandGlyph id={key} onWhite className="size-[55%]" />
    </span>
  );
}
