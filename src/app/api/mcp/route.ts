import { authenticateRequest } from "@/lib/auth";
import { json } from "@/lib/http";
import { buildMcpHandler } from "@/lib/mcp";

// Remote MCP endpoint (Streamable HTTP). Connect with:
//   claude mcp add --transport http adledger https://<your-host>/api/mcp --header "Authorization: Bearer al_..."

async function handle(req: Request) {
  const ws = await authenticateRequest(req);
  if (!ws) {
    return json(
      { error: "unauthorized", hint: "Create an API key in AdLedger → Settings → API keys and send it as `Authorization: Bearer al_...`." },
      401,
    );
  }
  return buildMcpHandler(ws)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
