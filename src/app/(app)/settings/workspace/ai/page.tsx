import { AiSection } from "@/components/settings/ai-section";
import { SettingsHeader } from "@/components/settings/section";
import { getLlmConfig } from "@/lib/ai/report";
import { requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getConnection } from "@/lib/settings";

export const metadata = { title: "AI model" };

export default async function AiPage() {
  const user = await requireUser("workspace.settings");
  const db = await getDb();
  const [llm, conn] = await Promise.all([getLlmConfig(user.workspace, db), getConnection(user.workspace.id, "llm", db)]);
  return (
    <>
      <SettingsHeader title="AI model" description="Pick the model that writes your weekly insights. Local models keep everything on your machine." />
      <AiSection current={llm ? { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl ?? "", hasKey: Boolean(llm.apiKey), fromEnv: !conn } : null} />
    </>
  );
}
