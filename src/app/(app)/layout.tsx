import Link from "next/link";
import { cookies } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const open = (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <SidebarProvider defaultOpen={open}>
      <AppSidebar user={{ email: user.email, name: user.name }} workspace={{ name: user.workspace.name, isDemo: user.workspace.isDemo }} />
      <SidebarInset>
        {user.workspace.isDemo ? (
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-t-xl border-b bg-primary/10 px-4 py-2 text-center text-xs text-foreground/80">
            <span>You&apos;re exploring demo data.</span>
            <Link href="/settings?tab=workspace" className="font-medium text-primary underline-offset-4 hover:underline">
              Clear it and connect your real accounts →
            </Link>
          </div>
        ) : null}
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
