import { BracesIcon, CodeXmlIcon, FileSpreadsheetIcon, MailIcon, TextCursorInputIcon, WebhookIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { SIMPLE_ICONS } from "./brand-icons.data";

// Marks that Simple Icons doesn't ship, drawn as simple SVG (multi-colour where the brand is).
const CUSTOM: Record<string, { title: string; hex: string; svg: React.ReactNode }> = {
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
  woocommerce: "woocommerce",
  paddle: "paddle",
  lemonsqueezy: "lemonsqueezy",
  razorpay: "razorpay",
  paypal: "paypal",
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
  meta_leads: "meta",
  google_ads_leads: "googleads",
  tiktok_leads: "tiktok",
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
export function BrandGlyph({ id, className, onWhite }: { id: string; className?: string; onWhite?: boolean }) {
  const key = ICON_FOR[id] ?? id;
  const si = SIMPLE_ICONS[key];
  if (si) {
    const light = luminance(si.hex) > 0.6;
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={si.title} className={cn("size-4 shrink-0", className)}>
        <path d={si.path} fill={light ? "#1a1a1a" : `#${si.hex}`} className={!onWhite && (si.hex === "000000" || si.hex === "191919") ? "dark:fill-white" : undefined} />
      </svg>
    );
  }
  const custom = CUSTOM[key];
  if (custom) {
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={custom.title} className={cn("size-4 shrink-0", className)}>
        {custom.svg}
      </svg>
    );
  }
  const Generic = GENERIC[key];
  return Generic ? <Generic className={cn("size-4 shrink-0 text-primary", className)} /> : null;
}

/** App-icon style tile with the brand mark, used in the integrations catalog. */
export function BrandTile({ id, className }: { id: string; className?: string }) {
  const key = ICON_FOR[id] ?? id;
  const si = SIMPLE_ICONS[key];
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
