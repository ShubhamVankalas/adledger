"use client";

import {
  BarChart3Icon,
  BookOpenIcon,
  CableIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  GitCompareArrowsIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PiggyBankIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useTransition } from "react";
import { toast } from "sonner";
import { switchOrganizationAction, switchWorkspaceAction } from "@/app/actions/account";
import { logoutAction } from "@/app/actions/auth";
import { OrgLogo, UserAvatar } from "@/components/avatars";
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
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboardIcon },
  { href: "/performance", label: "Performance", icon: BarChart3Icon },
  { href: "/reports/models", label: "Model comparison", icon: GitCompareArrowsIcon },
  { href: "/reports/ltv", label: "Customer LTV", icon: PiggyBankIcon },
  { href: "/contacts", label: "Contacts", icon: UsersIcon },
  { href: "/insights", label: "AI insights", icon: SparklesIcon },
];

type Props = {
  user: { id: string; email: string; name: string | null; avatarUrl: string | null; roleLabel: string };
  organization: { id: string; name: string; logoUrl: string | null };
  organizations: { id: string; name: string; logoUrl: string | null }[];
  workspace: { id: string; name: string; isDemo: boolean };
  workspaces: { id: string; name: string; isDemo: boolean }[];
  can: { settings: boolean; members: boolean; workspaces: boolean };
  setupLeft: number;
};

export function AppSidebar({ user, organization, organizations, workspace, workspaces, can, setupLeft }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  // Don't repeat the name when the workspace is named after the organization (the default).
  const sameName = organization.name.trim().toLowerCase() === workspace.name.trim().toLowerCase();
  const subtitle = [sameName ? null : organization.name, workspace.isDemo ? "Demo data" : null].filter(Boolean).join(" · ");
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const switchTo = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.message ?? "Couldn’t switch. Refresh the page and try again.");
      router.push("/");
      router.refresh();
    });

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />} disabled={pending}>
                <OrgLogo id={organization.id} name={organization.name} src={organization.logoUrl} size="md" />
                <div className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">{workspace.name}</span>
                  {subtitle ? <span className="truncate text-xs text-muted-foreground">{subtitle}</span> : null}
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Workspaces in {organization.name}</DropdownMenuLabel>
                  {workspaces.map((w) => (
                    <DropdownMenuItem key={w.id} onClick={() => w.id !== workspace.id && switchTo(() => switchWorkspaceAction(w.id))}>
                      <OrgLogo id={w.id} name={w.name} size="sm" />
                      <span className="min-w-0 truncate">{w.name}</span>
                      {w.id === workspace.id ? <CheckIcon className="ml-auto" /> : null}
                    </DropdownMenuItem>
                  ))}
                  {can.workspaces ? (
                    <DropdownMenuItem render={<Link href="/settings/organization" />}>
                      <PlusIcon /> New workspace
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
                          <span className="min-w-0 truncate">{o.name}</span>
                          {o.id === organization.id ? <CheckIcon className="ml-auto" /> : null}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Reports</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton isActive={active(item.href)} tooltip={item.label} render={<Link href={item.href} />}>
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {can.settings ? (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={active("/onboarding")} tooltip="Setup checklist" render={<Link href="/onboarding" />}>
                      <ListChecksIcon />
                      <span>Setup checklist</span>
                    </SidebarMenuButton>
                    {setupLeft > 0 ? <SidebarMenuBadge className="bg-primary/15 text-primary tabular-nums">{setupLeft}</SidebarMenuBadge> : null}
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive={active("/settings/workspace/integrations")} tooltip="Integrations" render={<Link href="/settings/workspace/integrations" />}>
                      <CableIcon />
                      <span>Integrations</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              ) : null}
              {can.members ? (
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={active("/settings/organization/members")} tooltip="Team" render={<Link href="/settings/organization/members" />}>
                    <UsersIcon />
                    <span>Team</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={active("/settings") && !active("/settings/workspace/integrations") && !active("/settings/organization/members")}
                  tooltip="Settings"
                  render={<Link href="/settings/workspace" />}
                >
                  <SettingsIcon />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Docs" render={<a href="https://github.com/ShubhamVankalas/adledger/tree/main/docs" target="_blank" rel="noreferrer" />}>
                  <BookOpenIcon />
                  <span>Docs</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <UserAvatar id={user.id} name={user.name} email={user.email} src={user.avatarUrl} size="md" />
                <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name || user.email}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.roleLabel}</span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuGroup>
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <UserAvatar id={user.id} name={user.name} email={user.email} src={user.avatarUrl} size="md" />
                    <div className="grid min-w-0 leading-tight">
                      <span className="truncate text-sm font-medium">{user.name || user.email}</span>
                      {user.name ? <span className="truncate text-xs text-muted-foreground">{user.email}</span> : null}
                    </div>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem render={<Link href="/settings/account" />}>
                    <UserIcon /> Account settings
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
