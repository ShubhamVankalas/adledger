import {
  ActivityIcon,
  BarChart3Icon,
  BellIcon,
  BotIcon,
  Building2Icon,
  CableIcon,
  CodeIcon,
  FileClockIcon,
  FolderIcon,
  ImageIcon,
  LayersIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  MousePointerClickIcon,
  PiggyBankIcon,
  SettingsIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareCheckBigIcon,
  SquareKanbanIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  WaypointsIcon,
  type LucideIcon,
} from "lucide-react";

// Every page, tab and settings section the ⌘K palette can open. The G-then-letter shortcuts are
// registered from this list, so the palette hint, the "?" sheet and the key itself never disagree.

export type PaletteCan = {
  /** workspace.settings */
  settings: boolean;
  /** members.manage */
  members: boolean;
  /** audit.view */
  audit: boolean;
  /** apikeys.manage */
  api: boolean;
};

export type NavEntry = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Where it lives, shown muted after the label ("Settings", "Performance"). */
  section?: string;
  keywords?: string[];
  hotkey?: string;
  /** Shown before anything is typed. */
  top?: boolean;
  show?: (can: PaletteCan) => boolean;
};

export const NAV: NavEntry[] = [
  { id: "nav.overview", label: "Overview", href: "/", icon: LayoutDashboardIcon, hotkey: "g o", top: true, keywords: ["home", "dashboard", "summary", "kpi"] },
  { id: "nav.live", label: "Live", href: "/live", icon: ActivityIcon, hotkey: "g v", top: true, keywords: ["realtime", "real time", "visitors now", "today"] },
  { id: "nav.performance", label: "Performance", href: "/performance", icon: BarChart3Icon, hotkey: "g p", top: true, keywords: ["ads", "roas", "spend", "cpa"] },
  { id: "nav.campaigns", label: "Campaigns", href: "/performance?level=campaign", icon: FolderIcon, section: "Performance", keywords: ["ads", "roas"] },
  { id: "nav.adsets", label: "Ad sets", href: "/performance?level=ad_group", icon: LayersIcon, section: "Performance", keywords: ["ad groups", "adsets"] },
  { id: "nav.ads", label: "Ads", href: "/performance?level=ad", icon: ImageIcon, section: "Performance", keywords: ["creatives", "ad level"] },
  { id: "nav.attribution", label: "Attribution", href: "/attribution", icon: WaypointsIcon, hotkey: "g a", top: true, keywords: ["models", "model comparison", "first touch", "last touch", "linear", "paths", "time to convert"] },
  { id: "nav.customers", label: "Customers", href: "/customers", icon: PiggyBankIcon, hotkey: "g r", top: true, keywords: ["ltv", "lifetime value", "cohorts", "retention", "new vs returning"] },
  { id: "nav.insights", label: "Insights", href: "/insights", icon: SparklesIcon, hotkey: "g i", top: true, keywords: ["ai", "reports", "ask", "alerts", "recommendations"] },
  { id: "nav.contacts", label: "Contacts", href: "/contacts", icon: UsersIcon, hotkey: "g c", top: true, keywords: ["people", "leads", "crm", "customers list"] },
  { id: "nav.pipeline", label: "Pipeline", href: "/pipeline", icon: SquareKanbanIcon, hotkey: "g d", top: true, keywords: ["deals", "kanban", "stages", "board"] },
  { id: "nav.tasks", label: "My tasks", href: "/tasks", icon: SquareCheckBigIcon, hotkey: "g t", top: true, keywords: ["todo", "to do", "follow up", "reminders"] },
  { id: "nav.settings", label: "Settings", href: "/settings", icon: SettingsIcon, hotkey: "g s", top: true, keywords: ["preferences", "configuration"] },
  // Settings sections (mirrors components/settings/settings-nav.tsx and its role checks).
  { id: "nav.settings.account", label: "Profile & security", href: "/settings/account", icon: UserIcon, section: "Settings", keywords: ["account", "password", "two factor", "2fa", "sessions", "avatar", "theme", "appearance"] },
  { id: "nav.settings.workspace", label: "Workspace settings", href: "/settings/workspace", icon: SlidersHorizontalIcon, section: "Settings", keywords: ["general", "currency", "timezone", "demo data", "export", "privacy", "retention"] },
  { id: "nav.settings.tracking", label: "Tracking & forms", href: "/settings/workspace/tracking", icon: MousePointerClickIcon, section: "Settings", keywords: ["pixel", "snippet", "script", "website", "form webhooks", "consent"], show: (c) => c.settings },
  { id: "nav.settings.integrations", label: "Integrations", href: "/settings/workspace/integrations", icon: CableIcon, section: "Settings", keywords: ["connect", "meta", "facebook", "google ads", "stripe", "razorpay", "shopify", "tiktok"], show: (c) => c.settings },
  { id: "nav.settings.notifications", label: "Notifications", href: "/settings/workspace/notifications", icon: BellIcon, section: "Settings", keywords: ["slack", "email", "alerts", "digest", "telegram", "discord", "whatsapp"], show: (c) => c.settings },
  { id: "nav.settings.import", label: "Import data", href: "/settings/workspace/import", icon: UploadIcon, section: "Settings", keywords: ["csv", "upload", "spend", "revenue", "conversions"], show: (c) => c.settings },
  { id: "nav.settings.ai", label: "AI model", href: "/settings/workspace/ai", icon: BotIcon, section: "Settings", keywords: ["openai", "anthropic", "gemini", "ollama", "llm", "api key"], show: (c) => c.settings },
  { id: "nav.settings.api", label: "API & MCP", href: "/settings/workspace/api", icon: CodeIcon, section: "Settings", keywords: ["api keys", "tokens", "mcp", "claude", "developer", "rest"], show: (c) => c.api },
  { id: "nav.settings.organization", label: "Organization & workspaces", href: "/settings/organization", icon: Building2Icon, section: "Settings", keywords: ["company", "branding", "logo", "new workspace", "clients"] },
  { id: "nav.settings.members", label: "Members & roles", href: "/settings/organization/members", icon: UsersIcon, section: "Settings", keywords: ["team", "invite", "teammates", "permissions", "users"], show: (c) => c.members },
  { id: "nav.settings.audit", label: "Audit log", href: "/settings/organization/audit", icon: FileClockIcon, section: "Settings", keywords: ["history", "activity", "security log"], show: (c) => c.audit },
  { id: "nav.setup", label: "Setup checklist", href: "/onboarding", icon: ListChecksIcon, section: "Settings", keywords: ["onboarding", "getting started", "install"], show: (c) => c.settings },
];

/** Pages whose URL takes ?range=&model=&compare= (report filters apply in place there). */
export const REPORT_PATHS = ["/", "/performance", "/attribution", "/customers", "/reports", "/live"];

export const isReportPath = (pathname: string) => REPORT_PATHS.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));

/** URL values the filter bar reads. Kept here so the palette and the filter bar agree. */
export const DATE_PRESETS = [
  { range: "7d", label: "Last 7 days" },
  { range: "14d", label: "Last 14 days" },
  { range: "30d", label: "Last 30 days" },
  { range: "90d", label: "Last 90 days" },
  { range: "180d", label: "Last 180 days" },
] as const;

export const COMPARE_OPTIONS = [
  { value: "previous", label: "Compare to previous period", keywords: ["vs prev", "comparison", "delta"] },
  { value: "year", label: "Compare to previous year", keywords: ["yoy", "year over year", "last year", "comparison"] },
  { value: "none", label: "Turn off comparison", keywords: ["no compare", "compare off", "hide comparison"] },
] as const;

export const MODELS = [
  { value: "linear", label: "Linear" },
  { value: "first_touch", label: "First touch" },
  { value: "last_touch", label: "Last touch" },
] as const;

/** sessionStorage key the Insights page reads to prefill "Ask" (kept out of the URL: questions can hold names or emails). */
export const ASK_DRAFT_KEY = "adledger:ask-draft";
