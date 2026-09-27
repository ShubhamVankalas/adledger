import { AudioWaveformIcon } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Live" };

export default async function LivePage() {
  await requireUser();
  return (
    <ComingSoon
      title="Live"
      icon={AudioWaveformIcon}
      headline="Live view is coming in the next update"
      body="Watch visitors, leads and payments arrive as they happen, without refreshing the page."
    />
  );
}
