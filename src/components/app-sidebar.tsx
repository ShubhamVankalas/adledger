"use client";

import {
  BarChart3Icon,
  BookOpenIcon,
  Building2Icon,
  CableIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  LayoutDashboardIcon,
  ListChecksIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
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
import { LogoMark } from "@/components/logo";
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
  { href: "/contacts", label: "Contacts", icon: UsersIcon },
  { href: "/insights", label: "AI insights", icon: SparklesIcon },
];

type Props = {
  user: { email: string; name: string | null; roleLabel: string };
  organization: { id: string; name: string };
  organizations: { id: string; name: string }[];
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
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const initials = (user.name || user.email).slice(0, 2).toUpperCase();

  const switchTo = (fn: () => Promise<{ ok: boolean; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.message ?? "Couldn't switch");
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
                <LogoMark className="size-8" />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">{workspace.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {organization.name}
                    {workspace.isDemo ? " · demo" : ""}
                  </span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-64">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Workspaces in {organization.name}</DropdownMenuLabel>
                  {workspaces.map((w) => (
                    <DropdownMenuItem key={w.id} onClick={() => w.id !== workspace.id && switchTo(() => switchWorkspaceAction(w.id))}>
                      <span className="flex size-6 items-center justify-center rounded-md bg-primary/15 text-[11px] font-semibold text-primary">{w.name.slice(0, 1).toUpperCase()}</span>
                      <span className="truncate">{w.name}</span>
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
                          <Building2Icon />
                          <span className="truncate">{o.name}</span>
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
                    {setupLeft > 0 ? <SidebarMenuBadge className="bg-primary/15 text-primary">{setupLeft}</SidebarMenuBadge> : null}
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
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-xs font-semibold text-primary">{initials}</span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name || user.email}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.roleLabel}</span>
                </div>
                <ChevronsUpDownIcon className="ml-auto size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate">{user.email}</DropdownMenuLabel>
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
