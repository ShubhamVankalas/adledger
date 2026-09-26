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
    <SidebarProvider defaultOpen={open}>
      <AppSidebar
        user={{ email: user.email, name: user.name, roleLabel: roleLabel(user.role) }}
        organization={{ id: user.organization.id, name: user.organization.name }}
        organizations={user.organizations}
        workspace={{ id: user.workspace.id, name: user.workspace.name, isDemo: user.workspace.isDemo }}
        workspaces={user.workspaces}
        can={{ settings: user.can("workspace.settings"), members: user.can("members.manage"), workspaces: user.can("workspaces.manage") }}
        setupLeft={setup ? setup.steps.length - setup.done : 0}
      />
      <SidebarInset className="min-w-0 overflow-x-clip pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
        {user.workspace.isDemo ? (
          <div className="flex flex-wrap items-center justify-center gap-x-2 rounded-t-xl border-b bg-primary/10 px-4 py-1 text-center md:py-2 text-xs text-foreground/80">
            <span>You&apos;re exploring demo data.</span>
            {user.can("workspace.data") ? (
              <Link href="/settings/workspace" className="inline-flex min-h-9 items-center font-medium text-primary underline-offset-4 hover:underline md:min-h-0">
                Clear it and connect your real accounts →
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
