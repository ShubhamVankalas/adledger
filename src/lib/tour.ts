import { pagePermissionFor, type Permission } from "./permissions";

// The first-run product tour, declared as data. Each step names the element it points at
// (`data-tour="…"` in the markup), the permissions it needs, and the page it lives on. The tour
// component (components/tour) only ever shows the steps `tourStepsFor` returns for the viewer, so
// admins, analysts, viewers and every custom role see exactly the parts of the app they can open.

export type TourCan = (permission: Permission) => boolean;

/** Copy can depend on what the viewer's role allows ("Ask AI" only if they may use it). */
type Text = string | ((can: TourCan) => string);

export type TourPlacement = "auto" | "right" | "left" | "top" | "bottom";

export type TourStep = {
  /** Stable id (also the icon key in the tour component). */
  id: string;
  title: Text;
  /** One to three sentences: what it is, and what you can do there. `{mod}` becomes ⌘K or Ctrl K. */
  body: Text;
  /** `data-tour` names; the first one that is on screen is spotlighted. No target: a centred card. */
  target?: string[];
  /**
   * Phones show a bottom tab bar instead of the sidebar, so most steps are left out there.
   * "same" keeps the step with the same target; a list swaps the target (e.g. a tab).
   */
  phone?: "same" | string[];
  /** Only shown on phones. */
  only?: "phone";
  /**
   * The page the target lives on. The tour navigates there first. A list holds alternatives: the
   * first page the viewer may open is used.
   */
  href?: string | string[];
  /** Permissions the viewer must hold (all of them). */
  needs?: Permission[];
  /** ...or at least one of these. */
  needsAny?: Permission[];
  place?: TourPlacement;
};

const REPORT_PAGES = ["/", "/performance", "/attribution"];

export const TOUR_STEPS: TourStep[] = [
  {
    id: "workspace",
    title: "Your workspace",
    body: (can) =>
      can("workspaces.manage")
        ? "Each brand or client gets its own workspace with separate data and settings. Switch between them here, or create a new one."
        : "Each brand or client has its own workspace with separate data. Switch between the ones you can open here.",
    target: ["workspace"],
    place: "right",
  },
  {
    id: "filters",
    title: "Date range and comparison",
    body: "Every report follows this bar. Pick a period, compare it with the one before, and choose how credit for a sale is split between ads.",
    target: ["filters"],
    phone: "same",
    href: REPORT_PAGES,
    place: "bottom",
  },
  {
    id: "kpis",
    title: "Your headline numbers",
    body: (can) =>
      `Ad spend, revenue, ROAS and more, worked out from your ad accounts and real payments. Click a tile to chart it below.${can("dashboard.edit") ? " Customize lets you rearrange the whole board." : ""}`,
    target: ["kpis", "widgets"],
    phone: "same",
    href: "/",
    needs: ["page.overview"],
    place: "bottom",
  },
  {
    id: "live",
    title: "Live",
    body: "See visitors, leads and payments as they happen, and which ad brought each one. Handy right after you launch a campaign or send an email.",
    target: ["nav-live"],
    phone: ["tab-live"],
    needs: ["page.live"],
    place: "right",
  },
  {
    id: "performance",
    title: "Performance",
    body: "Every campaign, ad set and ad with its spend, revenue and ROAS. Sort by what matters and open any row to see which ads make money and which waste it.",
    target: ["nav-performance"],
    phone: ["tab-performance"],
    needs: ["page.performance"],
    place: "right",
  },
  {
    id: "attribution",
    title: "Attribution",
    body: "Compare first-touch, last-touch and linear credit side by side, and follow the paths people take before they buy.",
    target: ["nav-attribution"],
    needs: ["page.attribution"],
    place: "right",
  },
  {
    id: "money",
    title: "Profit, receipts and the truth gap",
    body: "Profit is what is left after ads and costs. Receipts ties each payment to the ad that earned it. Truth gap sets what Meta and Google claim next to what your payments prove.",
    target: ["nav-group-money"],
    needs: ["page.profit"],
    place: "right",
  },
  {
    id: "crm",
    title: "Your CRM",
    body: (can) =>
      [
        can("page.contacts") ? "Contacts lists every lead with the ad that brought them and everything they did." : null,
        can("page.pipeline") ? "Pipeline is your deal board: drag people between stages to see what each qualified lead costs." : null,
        can("page.tasks") && can("contacts.notes") ? "My tasks collects the follow-ups assigned to you." : null,
      ]
        .filter(Boolean)
        .join(" "),
    target: ["nav-group-crm"],
    phone: ["tab-contacts"],
    needsAny: ["page.contacts", "page.pipeline", "page.tasks"],
    place: "right",
  },
  {
    id: "more",
    only: "phone",
    title: "Everything else is under More",
    body: "Attribution, Profit, Receipts, Pipeline, Reports, your workspace switcher, profile and theme all live here.",
    target: ["tab-more"],
    phone: "same",
  },
  {
    id: "insights",
    title: "Insights and Ask AI",
    body: (can) =>
      `AI-written findings on what to scale and what to cut.${can("insights.ask") ? " Ask AI answers questions about your numbers in plain English." : ""} Alerts tell you when a number crosses a line you care about.`,
    target: ["nav-insights"],
    needs: ["page.insights"],
    place: "right",
  },
  {
    id: "reports",
    title: "Reports and PDFs",
    body: (can) =>
      `Build the report you need${can("reports.pdf") ? ", then download it as a branded PDF with a fingerprint anyone can verify" : ""}${can("reports.schedule") || can("reports.share") ? ". Share a read-only link or email it on a schedule" : ""}.`,
    target: ["nav-reports"],
    needs: ["page.reports"],
    place: "right",
  },
  {
    id: "search",
    title: "Search and commands",
    body: (can) =>
      `Press {mod} anywhere to jump to a page, contact or campaign, or to run an action like syncing your ad accounts.${can("insights.ask") ? " Start with ? to ask AI." : ""}`,
    target: ["search"],
    phone: "same",
    place: "right",
  },
  {
    id: "integrations",
    title: "Connect your data",
    body: "Settings is where you connect Meta, Google Ads and Stripe, and install the tracking pixel from Tracking & forms. Once they are linked, every number fills in.",
    target: ["settings-integrations"],
    phone: "same",
    href: "/settings/workspace",
    needs: ["workspace.settings"],
    place: "right",
  },
  {
    id: "goals",
    title: "Targets, goals and alerts",
    body: (can) =>
      can("alerts.manage")
        ? "Set monthly targets to track pacing, and alert rules that warn you when CAC or ROAS slips."
        : "Monthly targets and pacing live here, so everyone works toward the same numbers.",
    target: ["settings-alerts", "settings-goals"],
    phone: "same",
    href: "/settings/workspace",
    place: "right",
  },
  {
    id: "team",
    title: "Team and roles",
    body: (can) =>
      `Invite teammates and clients, and choose what each role can see.${can("roles.manage") ? " Custom roles can hide whole pages or limit people to certain workspaces." : ""}`,
    target: ["settings-members", "settings-roles"],
    phone: "same",
    href: "/settings/workspace",
    needs: ["members.manage"],
    place: "right",
  },
  {
    id: "profile",
    title: "You and your preferences",
    body: "This menu holds your account settings, the light and dark theme, the documentation, and the option to replay this tour whenever you like.",
    target: ["profile"],
    place: "right",
  },
  {
    id: "finish",
    title: "You are all set",
    body: "Explore at your own pace. To see this tour again, use your profile menu, or press {mod} and search for “tour”.",
    phone: "same",
  },
];

export type ResolvedTourStep = {
  id: string;
  title: string;
  body: string;
  /** `data-tour` names to look for (undefined: centred card). */
  target?: string[];
  /** Page to open first, when the step lives on a specific one. */
  href?: string;
  place: TourPlacement;
};

const text = (t: Text, can: TourCan) => (typeof t === "function" ? t(can) : t);

/** The first alternative page (or the only one) that the viewer's role may open. */
export function stepHref(step: Pick<TourStep, "href">, can: TourCan): string | undefined | null {
  if (!step.href) return undefined;
  const options = Array.isArray(step.href) ? step.href : [step.href];
  const ok = options.find((h) => {
    const page = pagePermissionFor(h);
    return !page || can(page);
  });
  return ok ?? null;
}

/**
 * The steps this viewer sees, in order. Steps that need a permission the role lacks (or a page it
 * can't open) are dropped, as are steps that don't belong to the screen size. Copy is resolved
 * against the same permissions.
 */
export function tourStepsFor(can: TourCan, opts: { phone?: boolean } = {}): ResolvedTourStep[] {
  const phone = Boolean(opts.phone);
  const out: ResolvedTourStep[] = [];
  for (const s of TOUR_STEPS) {
    if (s.only === "phone" && !phone) continue;
    if (phone && !s.phone) continue;
    if (s.needs && !s.needs.every((p) => can(p))) continue;
    if (s.needsAny && !s.needsAny.some((p) => can(p))) continue;
    const href = stepHref(s, can);
    if (href === null) continue;
    const target = phone && Array.isArray(s.phone) ? s.phone : s.target;
    const body = text(s.body, can).trim();
    if (!body) continue;
    out.push({ id: s.id, title: text(s.title, can), body, target, href, place: s.place ?? "auto" });
  }
  return out;
}

/** Where the tour is allowed to start by itself (never over onboarding, which has its own guidance). */
export function tourMayAutoStart(pathname: string): boolean {
  return !(pathname === "/onboarding" || pathname.startsWith("/onboarding/"));
}
