// Serializable shapes passed from the alerts settings page (server) to its client components.

export type ChannelOption = { provider: string; name: string };
export type CampaignOption = { id: string; name: string; platform: string };
export type PlatformOption = { id: string; label: string };

export type RuleView = {
  id: string;
  name: string;
  metric: string;
  comparator: "gt" | "lt";
  /** Threshold as typed in the form: major units for money ("80.00"), a plain number otherwise. */
  threshold: string;
  windowDays: number;
  scope: "workspace" | "platform" | "campaign";
  scopeId: string | null;
  channels: string[];
  cooldownHours: number;
  enabled: boolean;
  state: "ok" | "breached";
  /** "CAC above $80 over the last 2 days" */
  summary: string;
  scopeLabel: string;
  /** Last observed value, formatted ("$64", "1.82×"), or null before the first check. */
  lastValue: string | null;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
};

export type RuleDraft = Partial<Pick<RuleView, "name" | "metric" | "comparator" | "threshold" | "windowDays" | "scope" | "scopeId">>;
