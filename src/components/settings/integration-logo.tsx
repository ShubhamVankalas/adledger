import { BrandTile } from "@/components/brand-icon";

/** Brand logo tile for an integration. */
export function IntegrationLogo({ provider, className }: { provider: string; name?: string; color?: string; className?: string }) {
  return <BrandTile id={provider} className={className} />;
}
