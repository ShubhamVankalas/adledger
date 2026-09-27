// Names of the read-only MCP tools, in one dependency-free module so the Settings → API page
// (a client component) lists exactly what src/lib/mcp.ts registers.
export const MCP_TOOL_NAMES = [
  "get_overview",
  "get_performance",
  "find_wasted_spend",
  "compare_periods",
  "list_contacts",
  "get_contact_journey",
  "get_latest_insights",
  "get_sync_status",
  "get_platform_breakdown",
  "list_integrations",
  "get_timeseries",
  "search_campaigns",
  "contact_stage_funnel",
  "get_ad_receipt",
] as const;
