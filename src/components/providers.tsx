"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <Toaster richColors position="bottom-right" mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
