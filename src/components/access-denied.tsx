import { ArrowRightIcon, LockKeyholeIcon } from "lucide-react";
import Link from "next/link";
import { cache } from "react";
import { Button } from "@/components/ui/button";
import { requireUser, type SessionUser } from "@/lib/auth";
import { firstAllowedPage, type PagePermission } from "@/lib/permissions";

// Page-level access: a role without a page's permission sees this state instead of the page (never a
// redirect, so there's no loop even when Overview itself is blocked).

const viewer = cache(() => requireUser());

export function AccessDenied({ user }: { user: Pick<SessionUser, "can" | "organization"> }) {
  const home = firstAllowedPage(user.can);
  return (
    <div className="flex min-h-[70svh] items-center justify-center p-4 md:p-6">
      <div className="surface-card flex w-full max-w-md flex-col items-center gap-5 rounded-xl p-6 text-center sm:p-8">
        <span className="flex size-11 items-center justify-center rounded-xl bg-fill text-muted-foreground">
          <LockKeyholeIcon className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-title text-balance">You don&rsquo;t have access to this page</h1>
          <p className="text-body text-balance text-muted-foreground">
            Your role can&rsquo;t open it. Ask an admin of <span className="font-medium break-words text-foreground">{user.organization.name}</span> to give your role access.
          </p>
        </div>
        <Button variant="outline" className="h-10 w-full sm:h-8 sm:w-auto" render={<Link href={home.href} />}>
          Go to {home.label.toLowerCase() === "your profile" ? "your profile" : home.label}
          <ArrowRightIcon aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/**
 * Gate a dashboard page: `const denied = await gatePage("page.performance"); if (denied) return denied;`
 * Signed-out visitors are redirected to sign in as usual.
 */
export async function gatePage(permission: PagePermission): Promise<React.ReactElement | null> {
  const user = await viewer();
  return user.can(permission) ? null : <AccessDenied user={user} />;
}
