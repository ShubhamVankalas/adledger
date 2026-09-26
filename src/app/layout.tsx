import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AdLedger", template: "%s · AdLedger" },
  description: "Open-source ad attribution. See which ad actually made you money.",
  icons: { icon: "/icon.svg", apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" } },
  appleWebApp: { capable: true, title: "AdLedger", statusBarStyle: "default" },
};

// Browser chrome matches the page background (globals.css --background); viewportFit lets the
// mobile tab bar pad itself with env(safe-area-inset-*) on notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#080d11" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
