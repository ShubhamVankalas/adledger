import { withAuth } from "@/lib/http";
import { buildMcpHandler } from "@/lib/mcp";

// Remote MCP endpoint (Streamable HTTP). Connect with:
//   claude mcp add --transport http adledger https://<your-host>/api/mcp --header "Authorization: Bearer al_..."
// Read-only, scoped to the API key's workspace (or the signed-in member's current workspace).

const handle = withAuth((req, ws) => buildMcpHandler(ws)(req), { permission: "reports.view", scope: "mcp", perMinute: 240 });

export { handle as GET, handle as POST, handle as DELETE };
