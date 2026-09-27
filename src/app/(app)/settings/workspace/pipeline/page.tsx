import Link from "next/link";
import { StagesEditor } from "@/components/pipeline/stages-editor";
import { SettingsHeader } from "@/components/settings/section";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listStages, stageCounts } from "@/lib/pipeline";

export const metadata = { title: "Pipeline stages" };

export default async function PipelineStagesPage() {
  const user = await requireUser("workspace.settings");
  const db = await getDb();
  const stages = await listStages(db, user.workspace.id);
  const counts = Object.fromEntries(await stageCounts(db, user.workspace.id, stages));
  // Remount the editor whenever the saved stages change, so a save or delete starts a clean draft.
  const version = stages.map((s) => `${s.id}:${s.position}:${s.name}:${s.kind}:${s.color}:${s.rotDays}:${s.probability}`).join("|");
  return (
    <>
      <SettingsHeader
        title="Pipeline stages"
        description="The columns of your pipeline. Open stages hold leads, a payment moves the contact to Won on its own, and an open contact starts rotting when it sits in a stage longer than its limit."
      >
        <Button variant="outline" size="sm" render={<Link href="/pipeline" />}>
          Open pipeline
        </Button>
      </SettingsHeader>
      <StagesEditor key={version} stages={stages} counts={counts} />
      <p className="max-w-3xl text-caption text-pretty text-muted-foreground">
        Win chance weights each open contact&apos;s value on the board: a lead with no payment yet counts as your average customer value times the chance. Renaming a stage keeps its contacts and history.
      </p>
    </>
  );
}
