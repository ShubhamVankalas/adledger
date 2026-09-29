# AdLedger — instructions for Claude Code

AdLedger is a free-to-self-host, source-available (FSL-1.1-ALv2) **ad attribution + revenue ledger**. It joins ad spend
(Meta Ads, Google Ads), first-party website events (our pixel), leads, and revenue (Stripe) so a
founder can answer: **"Which ad actually made me money?"** Free and self-hosted, with BYO-model AI and a built-in MCP server.

Read before starting any task:
- `docs/PRODUCT.md` — what we are building and for whom
- `docs/ARCHITECTURE.md` — stack, data model, flows, decisions
- `docs/ROADMAP.md` — what's done and what's next

## Top priority: dead-simple install
The target user may be non-technical. Every change must keep these true:
- `docker compose up -d` (app + Postgres) or the one-line `install.sh` just works.
- No new services/containers without a very good reason. Background work runs in-process (`src/lib/jobs.ts`).
- Configuration happens in the dashboard where possible (encrypted in the DB), not in env files.
  Every env var is optional and documented in `.env.example`.
- Migrations apply automatically at startup.

## How to work in this repo
- Keep changes small and focused; prefer the standard library and existing dependencies.
- Before a large change, post a short plan (files, schema changes, tests), then implement.
- Every change ends with: `pnpm lint`, `pnpm typecheck`, `pnpm test` passing, docs updated.
- If the docs are ambiguous or contradict the code, stop and ask.
- **Commits:** plain conventional messages (`feat: …`, `fix: …`). **Never** add AI/Claude
  mentions, "Generated with" lines or `Co-Authored-By` trailers to commits, PRs, tags or release notes.

## Stack (don't change without asking)
- **App:** Next.js 16 (App Router, React 19) + TypeScript (strict), one Node process
- **DB:** PostgreSQL 16 via Drizzle ORM (`drizzle-orm/node-postgres`); embedded PGlite when
  `DATABASE_URL` is unset (dev, tests, single-container trials)
- **UI:** Tailwind v4 + shadcn/ui (Base UI flavour — use `render={<Link/>}`, not `asChild`) + Recharts
- **Pixel:** `pixel/al.ts` → esbuild → `public/p/al.js` (< 5 KB gzipped, enforced)
- **AI:** Vercel AI SDK (`ai`, `@ai-sdk/*`) — OpenAI, Anthropic, Gemini, any OpenAI-compatible (Ollama, LM Studio, OpenRouter, DeepSeek)
- **MCP:** `mcp-handler` + `@modelcontextprotocol/server` at `/api/mcp`
- **Tests:** vitest · **Package manager:** pnpm · **Deploy:** Docker (standalone output)
- This Next.js version has breaking changes vs older docs — read `node_modules/next/dist/docs/`
  (e.g. `middleware` is now `proxy`, `params`/`searchParams` are Promises).

## Conventions
- Integrations live in `src/lib/connectors/` (ads/, revenue/) and `src/lib/notify/channels/`; register
  them in the folder's `index.ts`. The registry drives the Settings catalog, sync and webhooks.
- Server actions start with `guard(permission)` (see `src/lib/permissions.ts`) and log changes with
  `audit()`. Pages that need a role use `requireUser(permission)`.
- Money: integer minor units (`*_minor bigint`) + ISO currency. Never floats. Use `src/lib/money.ts`.
- Timestamps: UTC `timestamptz`; convert only in the UI / via workspace timezone in SQL.
- Every tenant table has `workspace_id` (except `workspaces`, `app_meta`) — a test enforces it.
- PII: raw email only in `contacts` (and the admin login in `users`); elsewhere SHA-256 of the
  lowercased, trimmed value. Run stored payloads through `redactPii`. Never log tokens, emails or phones.
- All reporting numbers come from `src/lib/reports.ts` (SQL). The LLM never computes numbers.
- Every connector has a mock mode (`CONNECTOR_MODE=mock` or connection `mode: "mock"`) serving
  realistic data in the platform's real API format. Tests use mock mode.
- REST routes are versioned `/api/v1/...`. MCP tools are **read-only**; future write tools must
  default to paused/draft and require explicit confirmation.
- Dev machine is Windows: keep LF line endings (`.gitattributes`).

## Commands
- Dev server (embedded DB, no Docker): `pnpm dev` → http://localhost:3000
- Tests: `pnpm test` (embedded Postgres) · against real Postgres: `TEST_DATABASE_URL=postgres://… pnpm test`
- Lint / types: `pnpm lint` · `pnpm typecheck`
- Production build: `pnpm build`
- New migration after editing `src/lib/db/schema.ts`: `pnpm db:generate`
- Build pixel only: `pnpm pixel`
- Full stack: `docker compose up -d --build` → http://localhost:3000
- Headless demo: `ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=adledger-demo-123 DEMO_DATA=true docker compose up -d`
