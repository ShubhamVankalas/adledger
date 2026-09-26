# Contributing to AdLedger

Thanks for helping! AdLedger's #1 goal is that anyone can install it with one command, so please
keep changes simple and avoid new services or heavy dependencies.

## Setup

```bash
pnpm install
pnpm dev        # http://localhost:3000 — embedded database in ./.data, no Docker needed
```

On first open you'll see the setup screen; tick "Start with demo data" to get a realistic workspace.

## Before opening a PR

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- Schema change? Edit `src/lib/db/schema.ts`, then `pnpm db:generate` and commit the new file in `drizzle/`.
- Money is always integer minor units; never floats.
- New connector? It needs a mock mode that serves realistic data in the platform's real API format, plus a fixture in `fixtures/` and a parser test.
- Keep MCP tools read-only.

## Project layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
