"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

// Below the md breakpoint the app shows a bottom tab bar (components/mobile-nav.tsx), so toasts sit above it.
// Sonner's own mobileOffset only applies under 600px, hence the explicit offset for 600-767px too.
const ABOVE_TAB_BAR = { bottom: "calc(4.5rem + env(safe-area-inset-bottom))" };

export function Providers({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      // The no-flash theme script only needs to run from the server HTML. On client renders React 19
      // warns about <script> in components, so mark it inert there (the tag has suppressHydrationWarning).
      scriptProps={{ type: typeof window === "undefined" ? "text/javascript" : "text/plain" }}
    >
      <TooltipProvider>
        {children}
        <Toaster richColors position="bottom-right" offset={isMobile ? ABOVE_TAB_BAR : undefined} mobileOffset={ABOVE_TAB_BAR} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
