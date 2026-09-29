import { Showcase, ShowcaseHeader } from "./showcase";

// Split layout: the form on the left, a brand showcase on the right from lg. Below lg the showcase
// collapses into a compact header above the form.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
      <div className="flex min-w-0 flex-col">
        <ShowcaseHeader />
        <main
          id="main"
          className="relative isolate flex flex-1 flex-col items-center overflow-hidden px-4 pt-7 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8 sm:pt-10 sm:pb-12 lg:justify-center lg:px-12 lg:py-14"
        >
          <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_0%,transparent_65%)] lg:opacity-60" />
          <div aria-hidden className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-72 w-[40rem] max-w-[200vw] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
          {/* Setup is a longer form with two-column rows, so it opts into a wider column via data-wide. */}
          <div className="w-full max-w-md animate-in duration-500 fade-in-0 slide-in-from-bottom-2 has-data-wide:max-w-lg lg:max-w-[26rem] lg:has-data-wide:max-w-xl">
            {children}
            <p className="mt-6 text-center text-xs text-balance text-muted-foreground sm:mt-8 lg:hidden">Self-hosted ad attribution · your data stays on your server</p>
          </div>
        </main>
      </div>
      <Showcase />
    </div>
  );
}
