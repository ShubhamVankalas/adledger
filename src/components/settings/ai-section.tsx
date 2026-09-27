"use client";

import { CpuIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { disconnectAction, saveAiAction, testAiAction } from "@/app/actions/settings";
import { ActionButton, useFormAction } from "@/components/action-button";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PROVIDERS = {
  ollama: { label: "Ollama (local, free)", base: "http://host.docker.internal:11434/v1", key: false, model: "llama3.1" },
  lmstudio: { label: "LM Studio (local, free)", base: "http://host.docker.internal:1234/v1", key: false, model: "qwen2.5-7b-instruct" },
  openai: { label: "OpenAI", base: "", key: true, model: "gpt-5-mini" },
  anthropic: { label: "Anthropic", base: "", key: true, model: "claude-sonnet-5" },
  google: { label: "Google Gemini", base: "", key: true, model: "gemini-2.5-flash" },
  openrouter: { label: "OpenRouter (any model)", base: "https://openrouter.ai/api/v1", key: true, model: "meta-llama/llama-3.3-70b-instruct" },
  deepseek: { label: "DeepSeek", base: "https://api.deepseek.com/v1", key: true, model: "deepseek-chat" },
  custom: { label: "Other OpenAI-compatible API", base: "", key: false, model: "" },
} as const;
type P = keyof typeof PROVIDERS;

export function AiSection({ current }: { current: { provider: string; model: string; baseUrl: string; hasKey: boolean; fromEnv: boolean } | null }) {
  const [provider, setProvider] = useState<P>((current?.provider as P) ?? "ollama");
  const p = PROVIDERS[provider] ?? PROVIDERS.custom;
  const save = useFormAction(saveAiAction);
  const needsBase = provider === "ollama" || provider === "lmstudio" || provider === "custom" || provider === "openrouter" || provider === "deepseek";

  return (
    <div className="grid grid-cols-1 items-start gap-5 md:gap-6 @4xl/settings:grid-cols-5">
      <Card className="@4xl/settings:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CpuIcon className="size-4 text-muted-foreground" /> Bring your own model
          </CardTitle>
          <CardDescription>
            {current ? (
              <>
                Currently using <strong translate="no">{current.provider}</strong> · <strong translate="no">{current.model}</strong>
                {current.fromEnv ? " (from environment variables)" : ""}.
              </>
            ) : (
              "Optional. Without a model, AdLedger writes rule-based weekly reports."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={save.submit} className="grid gap-4" key={provider}>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-provider">Provider</Label>
              <NativeSelect id="ai-provider" name="provider" value={provider} onChange={(e) => setProvider(e.target.value as P)}>
                {Object.entries(PROVIDERS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-model">Model</Label>
              <Input
                id="ai-model"
                name="model"
                autoComplete="off"
                spellCheck={false}
                defaultValue={current?.provider === provider ? current.model : p.model}
                placeholder={`${p.model || "model-name"}…`}
                required
              />
            </div>
            {needsBase ? (
              <div className="grid gap-1.5">
                <Label htmlFor="ai-base">Base URL</Label>
                <Input
                  id="ai-base"
                  name="baseUrl"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  translate="no"
                  defaultValue={current?.provider === provider && current.baseUrl ? current.baseUrl : p.base}
                  placeholder="https://api.example.com/v1…"
                />
                {provider === "ollama" || provider === "lmstudio" ? (
                  <p className="text-xs text-muted-foreground">
                    Running AdLedger in Docker? Use <code translate="no">host.docker.internal</code> to reach a model on your computer. Running with <code translate="no">pnpm dev</code>? Use <code translate="no">localhost</code>.
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="ai-key">API key {p.key ? "" : "(optional)"}</Label>
              <Input
                id="ai-key"
                name="apiKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={current?.hasKey && current.provider === provider ? "•••••••• saved — leave blank to keep…" : p.key ? "sk-…" : "Not needed for local models…"}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={save.pending}>
                {save.pending ? <Loader2Icon className="animate-spin" /> : null}
                {save.pending ? "Saving…" : "Save model"}
              </Button>
              {current ? (
                <>
                  <ActionButton action={testAiAction} variant="outline">
                    Test connection
                  </ActionButton>
                  {!current.fromEnv ? (
                    <ActionButton action={() => disconnectAction("llm")} variant="ghost" confirm="Remove the AI model? Reports will fall back to rule-based.">
                      Remove
                    </ActionButton>
                  ) : null}
                </>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="@4xl/settings:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheckIcon className="size-4 text-success" /> Your numbers stay honest
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>The model never calculates anything. AdLedger computes every figure in SQL, sends a compact “facts pack”, and asks the model only to explain it.</p>
          <p>After each report, every number in the text is checked against the facts. Anything the model made up is flagged on the report.</p>
          <p>With a local model (Ollama / LM Studio) no data leaves your machine at all.</p>
        </CardContent>
      </Card>
    </div>
  );
}
