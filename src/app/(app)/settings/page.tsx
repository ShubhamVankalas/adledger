import { redirect } from "next/navigation";

// Old links used ?tab=…; map them to the new settings pages.
const LEGACY: Record<string, string> = {
  tracking: "/settings/workspace/tracking",
  connections: "/settings/workspace/integrations",
  ai: "/settings/workspace/ai",
  api: "/settings/workspace/api",
  workspace: "/settings/workspace",
};

export default async function SettingsIndex({ searchParams }: PageProps<"/settings">) {
  const { tab } = await searchParams;
  redirect(LEGACY[typeof tab === "string" ? tab : ""] ?? "/settings/workspace");
}
