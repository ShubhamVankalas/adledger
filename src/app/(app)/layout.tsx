import { FlaskConicalIcon } from "lucide-react";
import Link from "next/link";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { MobileNav } from "@/components/mobile-nav";
import { getSetupStatus } from "@/components/onboarding";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { roleLabel } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const open = (await cookies()).get("sidebar_state")?.value !== "false";
  const setup = user.can("workspace.settings") && !user.workspace.isDemo ? await getSetupStatus(await getDb(), user.workspace) : null;
  return (
    // Tablets (md–lg) start with the icon rail so reports get the width; the toggle still expands it.
    <SidebarProvider defaultOpen={open} collapseBelow={1024}>
      <AppSidebar
        user={{ id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl, roleLabel: roleLabel(user.role) }}
        organization={{ id: user.organization.id, name: user.organization.name, logoUrl: user.organization.logoUrl }}
        organizations={user.organizations}
        workspace={{ id: user.workspace.id, name: user.workspace.name, isDemo: user.workspace.isDemo }}
        workspaces={user.workspaces}
        can={{ settings: user.can("workspace.settings"), members: user.can("members.manage"), workspaces: user.can("workspaces.manage") }}
        setupLeft={setup ? setup.steps.length - setup.done : 0}
      />
      <SidebarInset id="main" className="min-w-0 overflow-x-clip pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {/* Keeps scrolled content from showing under a notch / status bar in the installed app. */}
        <div aria-hidden className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-background md:hidden" />
        {user.workspace.isDemo ? (
          <div
            role="note"
            className="flex min-h-10 items-center justify-center gap-x-2.5 border-b border-primary/15 bg-primary/[0.06] px-4 text-center text-[0.8125rem] text-foreground/85 md:rounded-t-xl dark:border-primary/20 dark:bg-primary/[0.09]"
          >
            <span className="hidden shrink-0 items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20 sm:inline-flex dark:bg-primary/15">
              <FlaskConicalIcon aria-hidden className="size-3" />
              Demo
            </span>
            <span className="truncate">
              <span className="sm:hidden">You&rsquo;re viewing demo data.</span>
              <span className="hidden sm:inline">You&rsquo;re exploring sample data.</span>
            </span>
            {user.can("workspace.data") ? (
              <Link
                href="/settings/workspace"
                className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="sm:hidden">Use real data</span>
                <span className="hidden sm:inline">Clear it and connect your real accounts</span>
                <span aria-hidden>→</span>
              </Link>
            ) : null}
          </div>
        ) : null}
        {children}
        <MobileNav />
      </SidebarInset>
    </SidebarProvider>
  );
}
