# MCP server — ask AI agents about your ads

AdLedger has a built-in, **read-only** [Model Context Protocol](https://modelcontextprotocol.io)
server at `https://your-adledger/api/mcp` (Streamable HTTP). Create an API key in
**Settings → API & MCP**.

## Claude Code

```bash
claude mcp add --transport http adledger https://your-adledger/api/mcp \
  --header "Authorization: Bearer al_..."
```

## Claude Desktop

Settings → Developer → Edit config:

```json
{
  "mcpServers": {
    "adledger": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://your-adledger/api/mcp", "--header", "Authorization: Bearer al_..."]
    }
  }
}
```

## Cursor

`~/.cursor/mcp.json`:

```json
{ "mcpServers": { "adledger": { "url": "https://your-adledger/api/mcp", "headers": { "Authorization": "Bearer al_..." } } } }
```

## Tools

| Tool | What it returns |
|---|---|
| `get_overview` | Spend, revenue, ROAS, leads, customers, CPL, CAC, unattributed share |
| `get_performance` | Per campaign / ad group / ad: spend, leads, customers, revenue, ROAS, CPL, CAC |
| `find_wasted_spend` | Campaigns or ads with real spend and ROAS < 0.5 |
| `compare_periods` | KPIs vs the previous period + biggest movers |
| `get_platform_breakdown` | Spend, ad-attributed revenue, ROAS, leads and customers per ad platform, with totals |
| `get_timeseries` | Daily spend vs total and ad-attributed revenue and leads (max 400 days) |
| `search_campaigns` | Fuzzy campaign-name search (`query`, tolerates partial words and typos) → ids + spend, revenue, ROAS, leads, customers |
| `contact_stage_funnel` | Pipeline stages with contacts reached, step conversion, share of all contacts and ad cost per contact reaching each stage; optional `start` / `end` limit it to contacts first seen in that range. Counts only. |
| `list_contacts` | Leads/customers (emails masked) |
| `get_contact_journey` | Touchpoints, leads and payments for one contact + credit per model |
| `get_latest_insights` | The latest weekly insights report |
| `get_sync_status` | Connection health, recent syncs, pixel activity |
| `list_integrations` | Every connected integration with mode, health (`ok`, `stale` > 48 h, `never_synced`, `error`, `disabled`, `active` for push-only channels), last sync run and last error, plus pixel activity. Credentials are never read. |

Period tools accept `start`, `end` (YYYY-MM-DD, inclusive, workspace timezone), `model`
(`first_touch` | `last_touch` | `linear`) and, where it applies, `platform` (`meta`, `google`,
`microsoft`, `tiktok`, `linkedin`, `pinterest`, `snapchat`, `reddit`, `x`, `other`). Defaults: the
last 30 days with data, linear model. Every answer states the date range, currency and model.
Outputs are compact markdown (tables or one line per row) so they fit in an agent's context.

Try: *“Which campaigns made money last month and which wasted spend?”*, *“Compare this week with
last week”*, *“Is Meta or Google giving us the better ROAS?”*, *“Plot daily spend vs revenue for
September”*, *“How is the retargeting campaign doing?”*, *“Are all our integrations syncing?”*,
*“Show me the journey of our biggest customer this month”*.

## Safety

- All tools are read-only (annotated `readOnlyHint`, and a test verifies no tool changes data).
- Emails are masked in tool output.
- Future write tools (v0.2+) will create things paused/draft and require explicit confirmation.

## REST API

The same data is available at `/api/v1/reports/{overview|performance|timeseries|channels|wasted-spend|compare|model-comparison|ltv}`,
`/api/v1/contacts` and `/api/v1/contacts/{id}/journey` with the same bearer key. The full REST
API is described in [API.md](API.md) and as OpenAPI 3.1 at `/api/v1/openapi.json`.
