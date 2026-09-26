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
| `list_contacts` | Leads/customers (emails masked) |
| `get_contact_journey` | Touchpoints, leads and payments for one contact + credit per model |
| `get_latest_insights` | The latest weekly insights report |
| `get_sync_status` | Connection health, recent syncs, pixel activity |

Period tools accept `start`, `end` (YYYY-MM-DD, inclusive, workspace timezone), `model`
(`first_touch` | `last_touch` | `linear`) and `platform` (`meta` | `google`). Defaults: the last
30 days with data, linear model. Every answer states the date range, currency and model.

Try: *“Which campaigns made money last month and which wasted spend?”*, *“Compare this week with
last week”*, *“Show me the journey of our biggest customer this month”*.

## Safety

- All tools are read-only (annotated `readOnlyHint`, and a test verifies no tool changes data).
- Emails are masked in tool output.
- Future write tools (v0.2+) will create things paused/draft and require explicit confirmation.

## REST API

The same data is available at `/api/v1/reports/{overview|performance|timeseries|channels|wasted-spend|compare|model-comparison|ltv}`,
`/api/v1/contacts` and `/api/v1/contacts/{id}/journey` with the same bearer key.
