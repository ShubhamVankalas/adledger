# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: open the repository's **Security** tab and click
**Report a vulnerability** (GitHub private vulnerability reporting). Include the version or
commit, how AdLedger is deployed (Docker, `pnpm start`, behind which proxy) and the steps to
reproduce. A proof of concept against your own install is welcome; please don't test against
installs you don't own.

What to expect:

- An acknowledgement within 3 working days, and an assessment within 10.
- A fix on `main` and a patched release as soon as it's ready; critical issues first.
- Credit in the release notes if you'd like it. We don't run a paid bounty.

Supported versions: the latest release and `main`. Self-hosters should update regularly
(`docker compose pull && docker compose up -d`).

## Hardening notes for self-hosters

- **Serve it over HTTPS.** Use the bundled Caddy profile (`docker compose --profile https up -d`)
  or your own reverse proxy that sets `X-Forwarded-Proto`. Session cookies become `Secure` and HSTS
  is sent automatically; force it with `COOKIE_SECURE=true`.
- **Set `APP_SECRET`** (`openssl rand -base64 32`) and keep it out of the database backup it
  protects. It encrypts every stored credential.
- **Put AdLedger behind a proxy that sets the client IP** (`X-Forwarded-For`, `X-Real-IP` or
  `CF-Connecting-IP`). Per-IP rate limits trust these headers; per-account login lockouts do not
  depend on them.
- **Private-network URLs are blocked** for everything configured in the dashboard: notification
  webhooks, Slack/Discord/Teams URLs, SMTP host, store URLs, ad API hosts and AI base URLs cannot point at
  loopback, private (RFC 1918 / ULA), link-local or cloud-metadata addresses, and redirects are
  re-checked. AI base URLs may use `localhost` and `host.docker.internal` so a local Ollama or
  LM Studio works out of the box. To reach services elsewhere on your LAN (an n8n webhook, an
  Ollama box), set `ALLOW_PRIVATE_URLS=true`. That re-opens server-side request forgery for any
  admin of any workspace, so only do it when you trust every admin. Settings in the environment
  (`LLM_API_BASE`, `SMTP_URL`) are trusted and not checked.
- **Keep the database private.** The bundled Postgres is only reachable on the Docker network;
  if you use an external one, restrict it to the app host and change `POSTGRES_PASSWORD`.
- **Give people the smallest role that works.** Owners and admins manage integrations and members;
  analysts can create API keys; viewers and clients are read-only, clients only for the workspaces
  you pick.
- **Treat API keys like passwords.** A key reads the reports of its one workspace, can push
  spend/conversions into it and trigger syncs. Revoke keys you no longer use in Settings → API.

## How AdLedger protects itself

- **Access control.** Every server action starts with a permission check; pages that need a role
  check it on the server. Ids coming from the browser are always scoped to the caller's workspace
  or organization. REST/MCP calls with a dashboard session are held to the member's role; writes
  need the same permission as the matching screen and must come from the same origin (CSRF).
  API keys are scoped to one workspace. The MCP server is read-only.
- **Sessions.** 256-bit random tokens, stored as SHA-256 hashes, in `httpOnly`, `SameSite=Lax`
  cookies. A new token is issued on every sign-in (the old one is revoked), sign-out deletes it,
  and changing the password signs out every device. Removing a member ends their access at once.
- **Passwords.** scrypt (N=2^15). Sign-in and password checks are rate limited per IP and locked
  per account after repeated failures (5 per IP and email, 20 per email, 15 minutes).
- **Invitations.** Single-use (claimed atomically), expire after 7 days, and bound to the invited
  email. Admins can't invite owners, an invitation is void if the inviter can no longer grant the
  role, and it never demotes an existing owner.
- **Webhooks.** Stripe, Shopify, WooCommerce, Paddle, Razorpay and Lemon Squeezy signatures are
  HMACs compared in constant time; Stripe and Paddle reject events older than 5 minutes and
  PayPal verifies through PayPal's API. Ingestion is idempotent on the provider's ids, so a
  replayed delivery can't double-count revenue. Bodies are size-capped and rate limited.
- **Input limits.** Request bodies are capped before parsing (pixel 64 KB, lead webhooks 256 KB,
  revenue webhooks 2 MB, Spend API 20 MB, Conversions API 10 MB); CSV imports are capped at
  10 MB, 100,000 rows and 100 columns.
- **Output.** React escapes everything rendered in the dashboard; the Markdown renderer for AI
  reports never renders HTML; emails escape every value and only link `http(s)` URLs. Server
  actions don't return raw database errors.
- **Headers.** Dashboard pages send a Content-Security-Policy (`default-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`; `script-src` allows inline scripts because the
  Next.js App Router bootstraps with them), `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, and HSTS over HTTPS.
- **Secrets.** Connector credentials are encrypted with AES-256-GCM and never sent back to the
  browser (forms only learn which fields are set). API keys and session tokens are stored hashed.
  Logs never contain tokens, emails or phone numbers.
- **Privacy.** Raw emails live only in `contacts` and the login table; everywhere else emails and
  phones are SHA-256 hashed, IPs are truncated, and stored payloads are redacted.

Known limits: rate limits are in-memory (per app process); the SSRF check resolves DNS before
the request, so a DNS-rebinding attacker with a very short TTL could still race it.
