"use client";

import {
  AudioWaveformIcon,
  BarChart3Icon,
  BookOpenIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  CircleHelpIcon,
  FileTextIcon,
  GitForkIcon,
  KanbanIcon,
  LayoutGridIcon,
  ListTodoIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PiggyBankIcon,
  PlusIcon,
  ReceiptTextIcon,
  ScaleIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  UserIcon,
  UserRoundIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Suspense, useSyncExternalStore, useTransition } from "react";
import { toast } from "sonner";
import { switchOrganizationAction, switchWorkspaceAction } from "@/app/actions/account";
import { logoutAction } from "@/app/actions/auth";
import { openPalette, openShortcuts } from "@/components/app-shell";
import { OrgLogo, UserAvatar } from "@/components/avatars";
import { LiveNavBadge, LivePulse, type PulseData } from "@/components/live/live-pulse";
import { PinnedViews } from "@/components/performance/pinned-views";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { hrefAllowed } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { SavedView } from "@/lib/view-params";

/** `badge` shows a live count after the label: visitors on the site now, overdue tasks, breached alerts. */
type NavItem = { href: string; label: string; icon: LucideIcon; keys?: string; badge?: "live" | "tasks" | "alerts" };

// Brief §3.1. `keys` are the G-then-letter shortcuts from the hotkey registry, shown on hover.
const NAV: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: LayoutGridIcon, keys: "G O" },
      { href: "/live", label: "Live", icon: AudioWaveformIcon, keys: "G V", badge: "live" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { href: "/performance", label: "Performance", icon: BarChart3Icon, keys: "G P" },
      { href: "/attribution", label: "Attribution", icon: GitForkIcon, keys: "G A" },
      { href: "/customers", label: "Customers", icon: UserRoundIcon, keys: "G R" },
      { href: "/insights", label: "Insights", icon: SparklesIcon, keys: "G I", badge: "alerts" },
      { href: "/reports", label: "Reports", icon: FileTextIcon },
    ],
  },
  {
    // What the ads really earned: profit after ads, per-payment receipts, and platform over-claims.
    label: "Money",
    items: [
      { href: "/profit", label: "Profit", icon: PiggyBankIcon },
      { href: "/receipts", label: "Receipts", icon: ReceiptTextIcon },
      { href: "/truth", label: "Truth gap", icon: ScaleIcon },
    ],
  },
  {
    label: "CRM",
    items: [
      { href: "/contacts", label: "Contacts", icon: UsersIcon, keys: "G C" },
      { href: "/pipeline", label: "Pipeline", icon: KanbanIcon, keys: "G D" },
      { href: "/tasks", label: "My tasks", icon: ListTodoIcon, keys: "G T", badge: "tasks" },
    ],
  },
];

export type SetupProgress = { done: number; total: number; next: string | null };

type Props = {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; roleLabel: string };
  organization: { id: string; name: string; logoUrl: string | null };
  organizations: { id: string; name: string; logoUrl: string | null }[];
  workspace: { id: string; name: string; isDemo: boolean };
  workspaces: { id: string; name: string; isDemo: boolean }[];
  /** `pages`: page permissions the viewer holds (links to other pages are hidden). */
  can: { settings: boolean; members: boolean; workspaces: boolean; tasks: boolean; pages: readonly string[] };
  /** Required setup steps; null hides the ring (setup complete, demo workspace or no permission). */
  setup: SetupProgress | null;
  /** Today's revenue and visitors now (null without reports.view). */
  pulse: PulseData | null;
  /** Saved views pinned to the sidebar (at most eight). */
  pinnedViews: SavedView[];
  /** Open tasks assigned to the viewer that are past due. */
  overdueTasks: number;
  /** Threshold alert rules currently breached. */
  alertsTriggered: number;
};

const isActive = (pathname: string, href: string) =>
  href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

/** ⌘K on Apple devices, Ctrl K elsewhere. The server (and first paint) says Ctrl K. */
function usePaletteHint() {
  return useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );
}

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd translate="no" className={cn("kbd", className)}>
      {children}
    </kbd>
  );
}

export function AppSidebar({ user, organization, organizations, workspace, workspaces, can, setup, pulse, pinnedViews, overdueTasks, alertsTriggered }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  const paletteHint = usePaletteHint();
  // Don't repeat the name when the workspace is named after the organization (the default).
  const sameName = organization.name.trim().toLowerCase() === workspace.name.trim().toLowerCase();
  const subtitle = [sameName ? null : organization.name, workspace.isDemo ? "Sample data" : null].filter(Boolean).join(" · ");

  const switchTo = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.message ?? "Couldn’t switch. Refresh the page and try again.");
      router.push("/");
      router.refresh();
    });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-1.5 pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton size="lg" className="h-11 gap-2.5 px-2 data-popup-open:bg-fill-hover group-data-[collapsible=icon]:p-1!" aria-label={`Workspace: ${workspace.name}`} />}
                disabled={pending}
              >
                <OrgLogo id={organization.id} name={organization.name} src={organization.logoUrl} size="sm" />
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-ui font-medium text-foreground">{workspace.name}</span>
                  {subtitle ? <span className="truncate text-caption text-muted-foreground">{subtitle}</span> : null}
                </span>
                <ChevronsUpDownIcon aria-hidden className="ml-auto size-3.5! text-fg-faint" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-60">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Workspaces in {organization.name}</DropdownMenuLabel>
                  {workspaces.map((w) => (
                    <DropdownMenuItem key={w.id} onClick={() => w.id !== workspace.id && switchTo(() => switchWorkspaceAction(w.id))}>
                      <OrgLogo id={w.id} name={w.name} size="sm" />
                      <span className="min-w-0 flex-1 truncate">{w.name}</span>
                      {w.isDemo ? <span className="text-caption text-muted-foreground">Sample</span> : null}
                      {w.id === workspace.id ? <CheckIcon aria-label="Current" className="text-foreground" /> : null}
                    </DropdownMenuItem>
                  ))}
                  {can.workspaces ? (
                    <DropdownMenuItem render={<Link href="/settings/organization" />}>
                      <PlusIcon /> Create workspace…
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
                {organizations.length > 1 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Organizations</DropdownMenuLabel>
                      {organizations.map((o) => (
                        <DropdownMenuItem key={o.id} onClick={() => o.id !== organization.id && switchTo(() => switchOrganizationAction(o.id))}>
                          <OrgLogo id={o.id} name={o.name} src={o.logoUrl} size="sm" />
                          <span className="min-w-0 flex-1 truncate">{o.name}</span>
                          {o.id === organization.id ? <CheckIcon aria-label="Current" className="text-foreground" /> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={openPalette}
              tooltip={`Search (${paletteHint})`}
              className="mt-1 h-8 border border-sidebar-border bg-surface text-muted-foreground shadow-none hover:border-border-strong hover:bg-surface hover:text-foreground group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent"
            >
              <SearchIcon />
              <span className="flex-1">Search…</span>
              <Kbd className="bg-fill group-data-[collapsible=icon]:hidden in-data-[mobile=true]:hidden">{paletteHint}</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {NAV.map((group) => ({ ...group, items: group.items.filter((item) => (item.badge !== "tasks" || can.tasks) && hrefAllowed(item.href, can.pages)) }))
          .filter((group) => group.items.length > 0)
          .map((group, i) => (
          <SidebarGroup key={group.label ?? i} className={i === 0 ? "pt-1.5" : undefined}>
            {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton isActive={isActive(pathname, item.href)} tooltip={item.label} render={<Link href={item.href} />}>
                      <item.icon strokeWidth={1.75} />
                      <span className="flex-1">{item.label}</span>
                      {item.badge === "live" ? <LiveNavBadge initial={pulse} className="group-data-[collapsible=icon]:hidden" /> : null}
                      {item.badge === "tasks" && overdueTasks > 0 ? (
                        <CountBadge tone="negative" label={`${overdueTasks} overdue`}>
                          {overdueTasks}
                        </CountBadge>
                      ) : null}
                      {item.badge === "alerts" && alertsTriggered > 0 ? (
                        <CountBadge tone="warning" label={`${alertsTriggered} ${alertsTriggered === 1 ? "alert" : "alerts"} triggered`}>
                          {alertsTriggered}
                        </CountBadge>
                      ) : null}
                      {item.keys ? (
                        <span
                          aria-hidden
                          translate="no"
                          className="hidden text-micro tracking-wide text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/menu-button:opacity-100 lg:inline"
                        >
                          {item.keys}
                        </span>
                      ) : null}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        {/* Reads the URL to mark the open view, so it needs its own Suspense boundary. */}
        <Suspense fallback={null}>
          <PinnedViews views={pinnedViews} />
        </Suspense>
      </SidebarContent>

      <SidebarFooter className="gap-0.5 pt-1">
        <SidebarMenu>
          {setup ? (
            <SidebarMenuItem className="mb-1.5">
              <SidebarMenuButton
                render={<Link href="/onboarding" />}
                isActive={pathname === "/onboarding"}
                tooltip={`Setup ${setup.done} of ${setup.total}`}
                className="h-auto gap-2.5 rounded-lg border border-sidebar-border bg-surface px-2 py-2 hover:bg-surface hover:shadow-sm data-active:bg-surface group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent"
              >
                <SetupRing done={setup.done} total={setup.total} />
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate font-medium text-foreground">
                    Setup {setup.done} of {setup.total}
                  </span>
                  {setup.next ? <span className="truncate text-caption text-muted-foreground">Next: {setup.next}</span> : null}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ) : null}
          {pulse ? (
            <SidebarMenuItem className="group-data-[collapsible=icon]:hidden">
              <LivePulse initial={pulse} />
            </SidebarMenuItem>
          ) : null}
          <SidebarMenuItem>
            <SidebarMenuButton isActive={isActive(pathname, "/settings")} tooltip="Settings" render={<Link href="/settings/workspace" />}>
              <SettingsIcon strokeWidth={1.75} />
              <span className="flex-1">Settings</span>
              <span aria-hidden translate="no" className="hidden text-micro tracking-wide text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/menu-button:opacity-100 lg:inline">
                G S
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={openShortcuts} tooltip="Help & shortcuts (?)">
              <CircleHelpIcon strokeWidth={1.75} />
              <span className="flex-1">Help &amp; shortcuts</span>
              <Kbd className="group-data-[collapsible=icon]:hidden in-data-[mobile=true]:hidden">?</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem className="mt-1">
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="h-10 gap-2.5 px-2 data-popup-open:bg-fill-hover group-data-[collapsible=icon]:p-1!" aria-label={`Account: ${user.name || user.email}`} />}>
                <UserAvatar id={user.id} name={user.name} email={user.email} src={user.avatarUrl} size="sm" />
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-ui font-medium text-foreground">{user.name || user.email}</span>
                  <span className="truncate text-caption text-muted-foreground">{user.roleLabel}</span>
                </span>
                <ChevronsUpDownIcon aria-hidden className="ml-auto size-3.5! text-fg-faint" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-(--anchor-width) min-w-56">
                <DropdownMenuGroup>
                  <div className="flex items-center gap-2.5 px-2 py-2">
                    <UserAvatar id={user.id} name={user.name} email={user.email} src={user.avatarUrl} size="md" />
                    <div className="grid min-w-0 leading-tight">
                      <span className="truncate text-ui font-medium">{user.name || user.email}</span>
                      {user.name ? <span className="truncate text-caption text-muted-foreground">{user.email}</span> : null}
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link href="/settings/account" />}>
                    <UserIcon /> Account settings
                  </DropdownMenuItem>
                  {can.members ? (
                    <DropdownMenuItem render={<Link href="/settings/organization/members" />}>
                      <UsersIcon /> Team
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem render={<a href="https://github.com/ShubhamVankalas/adledger/tree/main/docs" target="_blank" rel="noreferrer" />}>
                    <BookOpenIcon /> Documentation
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Theme</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={(v) => setTheme(String(v))}>
                    <DropdownMenuRadioItem value="light">
                      <SunIcon /> Light
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="dark">
                      <MoonIcon /> Dark
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="system">
                      <MonitorIcon /> System
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logoutAction()}>
                  <LogOutIcon /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

/** Small count pill after a nav label (overdue tasks, triggered alerts). Hidden on the icon rail. */
function CountBadge({ tone, label, children }: { tone: "negative" | "warning"; label: string; children: React.ReactNode }) {
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "num rounded-full px-1.5 text-micro font-medium tabular-nums group-data-[collapsible=icon]:hidden",
        tone === "negative" ? "bg-negative-soft text-negative" : "bg-warning-soft text-warning",
      )}
    >
      {children}
    </span>
  );
}

/** 20px progress ring for the setup checklist. */
function SetupRing({ done, total }: { done: number; total: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="size-5! shrink-0 -rotate-90">
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" className="stroke-fill-active" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
        className="stroke-brand transition-[stroke-dashoffset] duration-(--dur-slow) ease-out"
      />
    </svg>
  );
}
