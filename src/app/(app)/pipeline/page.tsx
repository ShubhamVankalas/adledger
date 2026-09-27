import { KanbanIcon } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  await requireUser();
  return (
    <ComingSoon
      title="Pipeline"
      icon={KanbanIcon}
      headline="Pipeline is coming in the next update"
      body="Move leads from new lead to won, and see what each stage costs for every ad."
    />
  );
}
