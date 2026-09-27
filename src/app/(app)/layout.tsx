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
      <SidebarInset className="min-w-0 overflow-x-clip pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {/* Keeps scrolled content from showing under a notch / status bar in the installed app. */}
        <div aria-hidden className="fixed inset-x-0 top-0 z-30 h-[env(safe-area-inset-top)] bg-background md:hidden" />
        {user.workspace.isDemo ? (
          <div
            role="note"
            className="flex min-h-9 items-center justify-center gap-x-2 border-b border-primary/15 bg-primary/8 px-4 text-center text-xs text-foreground/80 md:rounded-t-xl dark:bg-primary/10"
          >
            <FlaskConicalIcon aria-hidden className="hidden size-3.5 shrink-0 text-primary sm:block" />
            <span className="truncate">You&apos;re exploring demo data.</span>
            {user.can("workspace.data") ? (
              <Link
                href="/settings/workspace"
                className="inline-flex min-h-10 shrink-0 items-center rounded-sm font-medium text-primary md:min-h-9 underline-offset-4 hover:underline"
              >
                <span className="sm:hidden">Use real data →</span>
                <span className="hidden sm:inline">Clear it and connect your real accounts →</span>
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
