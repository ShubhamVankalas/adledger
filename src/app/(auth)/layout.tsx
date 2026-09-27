import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="relative flex min-h-svh flex-col items-center overflow-hidden bg-background px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:justify-center sm:py-12">
      <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[48rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
      {/* Setup is a longer form with two-column rows, so it opts into a wider card via data-wide. */}
      <div className="relative w-full max-w-md has-data-wide:max-w-lg">
        <Logo className="mb-6 justify-center sm:mb-8" />
        {children}
        <p className="mt-6 text-center text-xs text-balance text-muted-foreground sm:mt-8">Open-source ad attribution · your data stays on your server</p>
      </div>
    </main>
  );
}
