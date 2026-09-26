import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Lets phones/tablets on the same Wi-Fi open the dev server (pnpm dev) by LAN IP.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*"],
  serverExternalPackages: ["@electric-sql/pglite", "pg", "nodemailer"],
  // CSV uploads in Settings → Import data.
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    return [
      {
        // The pixel is loaded cross-origin from customers' sites.
        source: "/p/:file*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      {
        source: "/((?!p/|api/v1/collect|api/v1/webhooks).*)",
        headers: SECURITY_HEADERS,
      },
      {
        // HSTS only when the request reached us over HTTPS (the reverse proxy sets X-Forwarded-Proto),
        // so plain-HTTP installs on localhost or a LAN keep working.
        source: "/:path*",
        has: [{ type: "header", key: "x-forwarded-proto", value: "https" }],
        headers: [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }],
      },
    ];
  },
};

export default nextConfig;
