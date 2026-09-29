import type { MetadataRoute } from "next";

// Web app manifest (served at /manifest.webmanifest) so AdLedger can be installed to a phone's home screen.
// PNG icons are generated from public/icon.svg by scripts/generate-app-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "AdLedger",
    short_name: "AdLedger",
    description: "Self-hosted ad attribution. See which ad actually made you money.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfcfb",
    // Matches the light theme-color meta in app/layout.tsx so an installed app does not flash brand green on launch.
    theme_color: "#fbfcfb",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
