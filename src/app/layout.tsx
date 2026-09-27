import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Providers } from "@/components/providers";
import "./globals.css";
import "./print.css";

export const metadata: Metadata = {
  title: { default: "AdLedger", template: "%s · AdLedger" },
  description: "Open-source ad attribution. See which ad actually made you money.",
  icons: { icon: "/icon.svg", apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" } },
  appleWebApp: { capable: true, title: "AdLedger", statusBarStyle: "default" },
};

// Browser chrome matches the page canvas (globals.css --bg); viewportFit lets the mobile tab bar
// pad itself with env(safe-area-inset-*) on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f0e" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full">
        {/* First tab stop: jumps keyboard and screen-reader users past the sidebar to the page's <main id="main">. */}
        <a
          href="#main"
          className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-[max(0.75rem,env(safe-area-inset-left))] z-[100] -translate-y-[calc(100%+env(safe-area-inset-top)+1rem)] rounded-md bg-primary px-3 py-2 text-ui font-medium text-primary-foreground transition-transform duration-150 ease-out focus-visible:translate-y-0 focus-visible:shadow-lg"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
