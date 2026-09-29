import { hrefAllowed } from "@/lib/permissions";
import {
  ActivityIcon,
  BadgeCheckIcon,
  BarChart3Icon,
  BellIcon,
  BellRingIcon,
  BotIcon,
  Building2Icon,
  CableIcon,
  CodeIcon,
  CopyCheckIcon,
  FileClockIcon,
  FileTextIcon,
  FolderIcon,
  FootprintsIcon,
  Grid3x3Icon,
  HourglassIcon,
  ImageIcon,
  LayersIcon,
  LayoutDashboardIcon,
  Link2Icon,
  ListChecksIcon,
  LockKeyholeIcon,
  MousePointerClickIcon,
  PiggyBankIcon,
  ReceiptTextIcon,
  ScaleIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  SquareCheckBigIcon,
  SquareKanbanIcon,
  TargetIcon,
  TimerIcon,
  TrendingUpIcon,
  UploadIcon,
  UserIcon,
  UsersIcon,
  WalletIcon,
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
  /** alerts.manage */
  alerts: boolean;
  /** reports.share */
  share: boolean;
  /** workspace.data (merge duplicates, delete data) */
  data: boolean;
  /** contacts.notes (see notes and tasks) */
  notes: boolean;
  /** contacts.edit (create notes and tasks, edit contacts) */
  editContacts: boolean;
  /** roles.manage */
  roles?: boolean;
  /** developers.access (outbound webhooks) */
  webhooks?: boolean;
  /** Page permissions the viewer holds (page.performance…); entries for other pages are hidden. */
  pages: readonly string[];
};

/** Is a palette entry available to this viewer (role checks and page access)? */
export const navVisible = (n: NavEntry, can: PaletteCan) => (!n.show || n.show(can)) && hrefAllowed(n.href, can.pages);

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
  { id: "nav.live", label: "Live", href: "/live", icon: ActivityIcon, hotkey: "g v", top: true, keywords: ["realtime", "real time", "visitors now", "today", "feed"] },
  { id: "nav.performance", label: "Performance", href: "/performance", icon: BarChart3Icon, hotkey: "g p", top: true, keywords: ["ads", "roas", "spend", "cpa"] },
  { id: "nav.campaigns", label: "Campaigns", href: "/performance?level=campaign", icon: FolderIcon, section: "Performance", keywords: ["ads", "roas"] },
  { id: "nav.adsets", label: "Ad sets", href: "/performance?level=ad_group", icon: LayersIcon, section: "Performance", keywords: ["ad groups", "adsets"] },
  { id: "nav.ads", label: "Ads", href: "/performance?level=ad", icon: ImageIcon, section: "Performance", keywords: ["creatives", "ad level"] },
  { id: "nav.attribution", label: "Attribution", href: "/attribution", icon: WaypointsIcon, hotkey: "g a", top: true, keywords: ["models", "model comparison", "first touch", "last touch", "linear", "disagreement"] },
  { id: "nav.attribution.paths", label: "Journey paths", href: "/attribution/paths", icon: FootprintsIcon, section: "Attribution", keywords: ["paths", "journeys", "funnel", "touchpoints", "conversion path"] },
  { id: "nav.attribution.ttc", label: "Time to convert", href: "/attribution/time-to-convert", icon: TimerIcon, section: "Attribution", keywords: ["lag", "days to convert", "attribution window", "heatmap", "weekday", "hour"] },
  { id: "nav.customers", label: "Customers", href: "/customers", icon: WalletIcon, hotkey: "g r", top: true, keywords: ["ltv", "lifetime value", "new vs returning"] },
  { id: "nav.customers.cohorts", label: "Cohorts", href: "/customers/cohorts", icon: Grid3x3Icon, section: "Customers", keywords: ["retention", "cohort heatmap", "ltv by month"] },
  { id: "nav.customers.payback", label: "Payback", href: "/customers/payback", icon: TrendingUpIcon, section: "Customers", keywords: ["cac payback", "ltv curves", "ltv:cac", "break even"] },
  { id: "nav.insights", label: "Insights", href: "/insights", icon: SparklesIcon, hotkey: "g i", top: true, keywords: ["ai", "weekly report", "recommendations", "action cards"] },
  { id: "nav.insights.ask", label: "Ask AI", href: "/insights?tab=ask", icon: SparklesIcon, section: "Insights", keywords: ["question", "chat", "ai", "ask"] },
  { id: "nav.insights.alerts", label: "Alert history", href: "/insights?tab=alerts", icon: BellRingIcon, section: "Insights", keywords: ["alerts", "anomaly", "triggered", "watching"] },
  { id: "nav.reports", label: "Reports", href: "/reports", icon: FileTextIcon, top: true, keywords: ["pdf", "export", "print", "schedule", "email report", "executive summary", "weekly report"] },
  { id: "nav.verify", label: "Verify a report", href: "/verify", icon: BadgeCheckIcon, section: "Reports", keywords: ["fingerprint", "pdf", "authentic", "check report"] },
  { id: "nav.profit", label: "Profit", href: "/profit", icon: PiggyBankIcon, top: true, keywords: ["poas", "profit after ads", "contribution", "margin", "break even roas", "p&l", "waterfall"] },
  { id: "nav.profit.ttm", label: "Time to money", href: "/profit/time-to-money", icon: HourglassIcon, section: "Profit", keywords: ["too early", "payback lag", "pause draft", "days to first payment"] },
  { id: "nav.receipts", label: "Receipts", href: "/receipts", icon: ReceiptTextIcon, keywords: ["ad receipts", "payments", "which ad earned", "customer cost", "payback"] },
  { id: "nav.truth", label: "Truth gap", href: "/truth", icon: ScaleIcon, keywords: ["platform claims", "over-claim", "overclaim", "verified revenue", "meta says", "reconcile"] },
  { id: "nav.contacts", label: "Contacts", href: "/contacts", icon: UsersIcon, hotkey: "g c", top: true, keywords: ["people", "leads", "crm", "customers list"] },
  { id: "nav.pipeline", label: "Pipeline", href: "/pipeline", icon: SquareKanbanIcon, hotkey: "g d", top: true, keywords: ["deals", "kanban", "stages", "board"] },
  { id: "nav.pipeline.funnel", label: "Stage funnel & cost", href: "/pipeline?view=funnel", icon: SquareKanbanIcon, section: "Pipeline", keywords: ["cost per stage", "cost per qualified", "stage conversion"] },
  { id: "nav.tasks", label: "My tasks", href: "/tasks", icon: SquareCheckBigIcon, hotkey: "g t", top: true, keywords: ["todo", "to do", "follow up", "reminders", "overdue"], show: (c) => c.notes },
  { id: "nav.settings", label: "Settings", href: "/settings", icon: SettingsIcon, hotkey: "g s", top: true, keywords: ["preferences", "configuration"] },
  // Settings sections (mirrors components/settings/settings-nav.tsx and its role checks).
  { id: "nav.settings.account", label: "Profile", href: "/settings/account", icon: UserIcon, section: "Settings", keywords: ["account", "name", "avatar", "theme", "appearance"] },
  { id: "nav.settings.security", label: "Account security", href: "/settings/account/security", icon: LockKeyholeIcon, section: "Settings", keywords: ["two factor", "2fa", "authenticator", "sessions", "devices", "sign out everywhere", "password"] },
  { id: "nav.settings.workspace", label: "Workspace settings", href: "/settings/workspace", icon: SlidersHorizontalIcon, section: "Settings", keywords: ["general", "currency", "timezone", "attribution window", "demo data", "export", "privacy", "retention"] },
  { id: "nav.settings.tracking", label: "Tracking & forms", href: "/settings/workspace/tracking", icon: MousePointerClickIcon, section: "Settings", keywords: ["pixel", "snippet", "script", "website", "form webhooks", "consent", "cookie banner"], show: (c) => c.settings },
  { id: "nav.settings.pipeline", label: "Pipeline stages", href: "/settings/workspace/pipeline", icon: SquareKanbanIcon, section: "Settings", keywords: ["stages", "kanban", "deals", "rotting", "win probability"], show: (c) => c.settings },
  { id: "nav.settings.integrations", label: "Integrations", href: "/settings/workspace/integrations", icon: CableIcon, section: "Settings", keywords: ["connect", "meta", "facebook", "google ads", "stripe", "razorpay", "shopify", "tiktok"], show: (c) => c.settings },
  { id: "nav.settings.goals", label: "Targets & goals", href: "/settings/workspace/goals", icon: TargetIcon, section: "Settings", keywords: ["goals", "targets", "pacing", "budget", "monthly target"] },
  { id: "nav.settings.profit", label: "Profit settings", href: "/settings/workspace/profit", icon: PiggyBankIcon, section: "Settings", keywords: ["unit economics", "cogs", "cost of goods", "payment fees", "shipping", "margin"] },
  { id: "nav.settings.notifications", label: "Notifications", href: "/settings/workspace/notifications", icon: BellIcon, section: "Settings", keywords: ["slack", "email", "digest", "telegram", "discord", "whatsapp"], show: (c) => c.settings },
  { id: "nav.settings.alerts", label: "Alerts", href: "/settings/workspace/alerts", icon: BellRingIcon, section: "Settings", keywords: ["alert rules", "cac", "roas", "threshold", "anomaly"], show: (c) => c.alerts },
  { id: "nav.settings.sharing", label: "Sharing", href: "/settings/workspace/sharing", icon: Link2Icon, section: "Settings", keywords: ["share link", "client", "read-only", "public link"], show: (c) => c.share },
  { id: "nav.settings.import", label: "Import data", href: "/settings/workspace/import", icon: UploadIcon, section: "Settings", keywords: ["csv", "upload", "import contacts", "crm import", "spend", "revenue", "conversions"], show: (c) => c.settings },
  { id: "nav.settings.duplicates", label: "Duplicates", href: "/settings/workspace/duplicates", icon: CopyCheckIcon, section: "Settings", keywords: ["merge", "dedupe", "duplicate contacts", "same person"], show: (c) => c.settings },
  { id: "nav.settings.ai", label: "AI model", href: "/settings/workspace/ai", icon: BotIcon, section: "Settings", keywords: ["openai", "anthropic", "gemini", "ollama", "llm", "api key"], show: (c) => c.settings },
  { id: "nav.settings.api", label: "API & MCP", href: "/settings/workspace/api", icon: CodeIcon, section: "Settings", keywords: ["api keys", "tokens", "mcp", "claude", "developer", "rest"], show: (c) => c.api && !c.pages.includes("page.developers") },
  // Developers (page.developers; hrefAllowed hides these for roles without it).
  { id: "nav.developers", label: "Developers", href: "/developers", icon: CodeIcon, keywords: ["api", "developer", "integrations", "quickstart", "zapier", "make", "n8n"] },
  { id: "nav.developers.keys", label: "API keys", href: "/developers/keys", icon: CodeIcon, section: "Developers", keywords: ["api keys", "tokens", "mcp", "claude", "rest"], show: (c) => c.api },
  { id: "nav.developers.webhooks", label: "Webhooks", href: "/developers/webhooks", icon: CodeIcon, section: "Developers", keywords: ["webhook", "events", "zapier", "make", "n8n", "real time", "lead created", "payment"], show: (c) => Boolean(c.webhooks) },
  { id: "nav.developers.reference", label: "API reference", href: "/developers/reference", icon: CodeIcon, section: "Developers", keywords: ["rest", "openapi", "endpoints", "curl", "python", "javascript"] },
  { id: "nav.developers.recipes", label: "Developer recipes", href: "/developers/recipes", icon: CodeIcon, section: "Developers", keywords: ["twilio", "sms", "cal.com", "slack", "google sheets", "automation"] },
  { id: "nav.settings.organization", label: "Organization & workspaces", href: "/settings/organization", icon: Building2Icon, section: "Settings", keywords: ["company", "branding", "logo", "new workspace", "clients"] },
  { id: "nav.settings.members", label: "Members & roles", href: "/settings/organization/members", icon: UsersIcon, section: "Settings", keywords: ["team", "invite", "teammates", "permissions", "users"], show: (c) => c.members },
  { id: "nav.settings.roles", label: "Roles & permissions", href: "/settings/organization/roles", icon: UsersIcon, section: "Settings", keywords: ["custom roles", "permissions", "access", "hide pages", "lock"], show: (c) => Boolean(c.roles) },
  { id: "nav.settings.policy", label: "Security policy", href: "/settings/organization/security", icon: ShieldCheckIcon, section: "Settings", keywords: ["require 2fa", "session timeout", "posture", "checklist", "encryption key", "permissions"], show: (c) => c.audit },
  { id: "nav.settings.audit", label: "Audit log", href: "/settings/organization/audit", icon: FileClockIcon, section: "Settings", keywords: ["history", "activity", "security log", "verify chain"], show: (c) => c.audit },
  { id: "nav.setup", label: "Setup checklist", href: "/onboarding", icon: ListChecksIcon, section: "Settings", keywords: ["onboarding", "getting started", "install"], show: (c) => c.settings },
];

/** Pages whose URL takes ?range=&model=&compare= (report filters apply in place there). */
export const REPORT_PATHS = ["/", "/performance", "/attribution", "/customers", "/reports", "/live", "/profit", "/receipts", "/truth"];

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
  { value: "prev", label: "Compare to previous period", keywords: ["vs prev", "comparison", "delta"] },
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
