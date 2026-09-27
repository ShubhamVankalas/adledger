import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { ShellProvider } from "@/components/app-shell";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandPalette } from "@/components/command-palette";
import { MobileNav } from "@/components/mobile-nav";
import { DEMO_PILL_COOKIE } from "@/components/shell-constants";
import { getSetupStatus } from "@/components/onboarding";
import { ShortcutsSheet } from "@/components/shortcuts-sheet";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth";
import { getDb, schema } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";
import { overdueTaskCount } from "@/lib/reports-crm";
import { livePulse } from "@/lib/reports-live";
import { listPinnedViews } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const jar = await cookies();
  const open = jar.get("sidebar_state")?.value !== "false";
  const db = await getDb();
  const ws = user.workspace;
  // Sidebar data, loaded together: setup progress, the live pulse, pinned views and the two badges.
  const [status, pulse, pinnedViews, overdueTasks, alertsTriggered] = await Promise.all([
    user.can("workspace.settings") && !ws.isDemo ? getSetupStatus(db, ws) : null,
    user.can("reports.view") ? livePulse(db, ws) : null,
    listPinnedViews(db, ws.id, user.id),
    user.can("contacts.notes") ? overdueTaskCount(db, ws, user.id) : 0,
    user.can("reports.view")
      ? db.$count(
          schema.alertRules,
          and(eq(schema.alertRules.workspaceId, ws.id), eq(schema.alertRules.kind, "threshold"), eq(schema.alertRules.enabled, true), eq(schema.alertRules.state, "breached")),
        )
      : 0,
  ]);
  // The sidebar ring counts the required steps and disappears once they are done.
  const required = status?.steps.filter((s) => !s.optional) ?? [];
  const setup =
    status && !status.complete
      ? { done: required.filter((s) => s.done).length, total: required.length, next: required.find((s) => !s.done)?.label ?? null }
      : null;

  return (
    // Tablets (md–lg) start with the icon rail so reports get the width; "[" or the toggle expands it.
    <SidebarProvider defaultOpen={open} collapseBelow={1024}>
      <ShellProvider
        value={{
          workspaceId: user.workspace.id,
          isDemo: user.workspace.isDemo,
          canUseRealData: user.can("workspace.data"),
          demoPillHidden: jar.get(DEMO_PILL_COOKIE)?.value === user.workspace.id,
        }}
      >
        <AppSidebar
          user={{ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, roleLabel: roleLabel(user.role) }}
          organization={{ id: user.organization.id, name: user.organization.name, logoUrl: user.organization.logoUrl }}
          organizations={user.organizations}
          workspace={{ id: user.workspace.id, name: user.workspace.name, isDemo: user.workspace.isDemo }}
          workspaces={user.workspaces}
          can={{ settings: user.can("workspace.settings"), members: user.can("members.manage"), workspaces: user.can("workspaces.manage"), tasks: user.can("contacts.notes") }}
          setup={setup}
          pulse={pulse}
          pinnedViews={pinnedViews}
          overdueTasks={overdueTasks}
          alertsTriggered={alertsTriggered}
        />
        <SidebarInset id="main" className="min-w-0 overflow-x-clip pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
          {/* Keeps scrolled content from showing under a notch / status bar in the installed app. */}
          <div aria-hidden className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-background md:hidden" />
          {children}
          <CommandPalette
            workspaceId={user.workspace.id}
            can={{
              settings: user.can("workspace.settings"),
              members: user.can("members.manage"),
              audit: user.can("audit.view"),
              api: user.can("apikeys.manage"),
              alerts: user.can("alerts.manage"),
              share: user.can("reports.share"),
              data: user.can("workspace.data"),
              notes: user.can("contacts.notes"),
              editContacts: user.can("contacts.edit"),
            }}
          />
          <ShortcutsSheet />
          <MobileNav />
        </SidebarInset>
      </ShellProvider>
    </SidebarProvider>
  );
}
