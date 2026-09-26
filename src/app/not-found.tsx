import { CompassIcon } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-8 overflow-hidden px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <Link href="/" aria-label="AdLedger home" className="relative rounded-lg">
        <Logo />
      </Link>
      <div className="relative flex w-full max-w-sm flex-col items-center gap-5 rounded-2xl border bg-card/80 p-6 shadow-sm backdrop-blur sm:p-8">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CompassIcon className="size-5" aria-hidden />
        </span>
        <div className="space-y-1.5">
          <p className="tabular text-sm font-medium text-primary">404</p>
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">This page doesn&apos;t exist.</p>
          <p className="text-sm text-muted-foreground">The link may be broken, or the page may have moved.</p>
        </div>
        <Button className="w-full sm:w-auto" render={<Link href="/" />}>
          Back to dashboard
        </Button>
      </div>
    </main>
  );
}
