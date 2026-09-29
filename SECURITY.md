# Security policy

Thank you for helping keep AdLedger and the people who run it safe.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.** Public
reports put every self-hoster at risk before a fix exists.

Report privately through GitHub:
**[Report a vulnerability](https://github.com/ShubhamVankalas/adledger/security/advisories/new)**
(or open the repository's **Security** tab, then **Report a vulnerability**). This is GitHub private
vulnerability reporting: only you and the maintainer see the report, and we can collaborate on a fix
and a CVE in the same private space.

Please include:

- the version or commit, and how AdLedger is deployed (Docker, `pnpm start`, behind which proxy);
- what you found, its impact, and the steps to reproduce (a proof of concept against your own install is ideal);
- whether you'd like credit, and how.

Don't include real customer data, real credentials or anyone else's personal information in a report.

### What to expect

| Step | Target |
|---|---|
| Acknowledgement that we received your report | within **3 working days** |
| Triage: severity, whether it is in scope, and a plan | within **10 working days** |
| Fix for a critical or high severity issue | as fast as we can, aiming for **30 days** |
| Fix for medium or low severity | in a regular release, aiming for **90 days** |
| Public advisory (and CVE where it applies) | when the patched release is out, coordinated with you |

AdLedger has a single maintainer, so these are targets, not guarantees. If you hear nothing within
the acknowledgement window, ping the advisory thread once. We'll keep you updated on progress and
agree a disclosure date with you (90 days at most from the report, sooner once a fix ships). We're
happy to credit you in the advisory and release notes. We don't run a paid bounty.

## Supported versions

| Version | Supported |
|---|---|
| Latest release (currently 0.1.x) | Yes: security fixes and patched releases |
| `main` | Yes: fixes land here first |
| Older releases | No. Please update to the latest release |

Self-hosters should update regularly (`docker compose pull && docker compose up -d`). Container images
are published to `ghcr.io/shubhamvankalas/adledger` (`:latest` for releases, `:edge` for `main`).

## Scope

**In scope:** the AdLedger code in this repository and the official image and install paths built
from it, for example:

- authentication, sessions, two-factor sign-in, permissions and role checks, API key scopes;
- access to another workspace's or organization's data (tenant isolation);
- injection (SQL, XSS, SSRF, CSRF, path traversal), and bypasses of the SSRF guard or CSP;
- exposure of secrets, raw emails or phone numbers where the docs promise they are protected;
- webhook signature verification and replay handling;
- the tracking pixel (`public/p/al.js`) and its collection endpoints;
- the MCP server and the REST API;
- flaws in `Dockerfile`, `docker-compose.yml`, `install.sh` or the GitHub workflows that put users or the release pipeline at risk.

**Out of scope:**

- an install you don't own or run, and any testing that degrades the service for others;
- denial of service through volume alone, spam, or social engineering of the maintainer or users;
- findings that need a compromised admin account, a compromised server or physical access, or that only
  affect a deployment that ignores the [hardening notes](#hardening-notes-for-self-hosters) (for example
  no HTTPS, or `ALLOW_PRIVATE_URLS=true` on purpose);
- vulnerabilities in third-party services AdLedger connects to (Meta, Google, Stripe, ...): report those
  to the vendor;
- missing best-practice headers with no demonstrated impact, self-XSS, and results from automated
  scanners without a working proof of concept;
- known limits already documented below (in-memory rate limits, the DNS-rebinding race in the SSRF check).

If you're unsure whether something is in scope, report it anyway.

## Safe harbour

We consider security research done in good faith under this policy to be authorized. If you follow
it, we won't pursue or support legal action against you, and we'll work with you to understand and
fix the issue. Good faith means you:

- test only against **your own install** (never other people's deployments or data);
- make a reasonable effort to avoid privacy violations, data destruction and service disruption;
- stop and report as soon as you can show the issue, and don't access more data than needed to prove it;
- give us a reasonable time to fix the issue before you disclose it publicly;
- don't extort, sell or share the finding.

This safe harbour covers the AdLedger project and its code. It can't bind third parties (your hosting
provider, or any service AdLedger talks to).

## Other security resources

Every install also serves `/.well-known/security.txt` (RFC 9116). Set `SECURITY_CONTACT` to list
your own contact there for problems with your install. For how AdLedger handles data and what it
does and doesn't claim, read [docs/SECURITY.md](docs/SECURITY.md) (Trust & security). For
GDPR, CCPA, SOC 2, ISO 27001 and OWASP mappings, see [docs/COMPLIANCE.md](docs/COMPLIANCE.md).
Contributors: the security expectations for pull requests are in [CONTRIBUTING.md](CONTRIBUTING.md#security-expectations).

## Hardening notes for self-hosters

- **Serve it over HTTPS.** Use the bundled Caddy profile (`docker compose --profile https up -d`)
  or your own reverse proxy that sets `X-Forwarded-Proto`. Session cookies become `Secure` and HSTS
  is sent automatically; force it with `COOKIE_SECURE=true`.
- **Set `APP_SECRET`** (`openssl rand -base64 32`) and keep it out of the database backup it
  protects. It encrypts every stored credential and 2FA secret. On an install that already runs
  without it, copy the generated key instead of making a new one
  ([docs/SECURITY.md → Encryption key](docs/SECURITY.md#encryption-key)).
- **Require two-factor sign-in** (Settings → Organization → Security policy) once every owner has
  it on. A locked-out owner can be reset with `ADLEDGER_BREAK_GLASS` (see docs/SECURITY.md).
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
- **Treat API keys like passwords.** A key works on its one workspace and only within its scopes
  (`reports:read` by default; `mcp`, `contacts:read`, `contacts:pii` and `ingest:write` on request).
  Give out `contacts:pii` sparingly, set an expiry, and revoke keys you no longer use in
  Settings → API & MCP.

## How AdLedger protects itself

- **Access control.** Every server action starts with a permission check; pages that need a role
  check it on the server. Ids coming from the browser are always scoped to the caller's workspace
  or organization. REST/MCP calls with a dashboard session are held to the member's role; writes
  need the same permission as the matching screen and must come from the same origin (CSRF).
  API keys are scoped to one workspace and carry explicit scopes. The MCP server is read-only.
  Viewers and clients see masked contact emails; revealing one is audited.
- **Sessions.** 256-bit random tokens, stored as SHA-256 hashes, in `httpOnly`, `SameSite=Lax`
  cookies. A new token is issued on every sign-in (the old one is revoked), sign-out deletes it,
  and changing the password signs out every device. Removing a member ends their access at once.
  Sessions expire when idle (default 7 days) and after a maximum lifetime (default 30 days); each
  one records a truncated IP and browser and can be revoked from Settings → Account → Security.
- **Two-factor sign-in.** TOTP (RFC 6238) with ten single-use recovery codes; codes can't be
  replayed. The secret is encrypted like other credentials. Organizations can require it.
- **Passwords.** scrypt (N=2^15), NIST SP 800-63B-4 rules (15 characters, or 8 with 2FA; common
  passwords refused). Sign-in and password checks are rate limited per IP and locked
  per account after repeated failures (5 per IP and email, 20 per email, 15 minutes).
- **Audit log.** Security-relevant actions are logged with a truncated IP and browser, chained by
  SHA-256 hashes per organization (Verify finds edited or removed entries), and raise
  `security_alert` notifications where it matters (new API key, role change, 2FA off, bulk export,
  erasure, new-device sign-in).
- **Invitations.** Single-use (claimed atomically), expire after 7 days, and bound to the invited
  email. Admins can't invite owners, an invitation is void if the inviter can no longer grant the
  role, and it never demotes an existing owner.
- **Webhooks.** Stripe, Shopify, WooCommerce, Paddle, Razorpay and Lemon Squeezy signatures are
  HMACs compared in constant time; Stripe and Paddle reject events older than 5 minutes and
  PayPal verifies through PayPal's API. Cashfree, Instamojo, HubSpot, Meta (lead forms,
  WhatsApp) and TikTok signatures are verified the same way; Chargebee, Recurly and Pipedrive use
  HTTP Basic auth, PhonePe its hashed username:password header, Gumroad a secret URL token and
  Google Ads lead forms a shared key, all compared in constant time. Ingestion is idempotent on the provider's ids, so a replayed delivery can't
  double-count revenue or leads, or re-send alerts. Bodies are size-capped and rate limited.
- **Input limits.** Request bodies are capped before parsing (pixel 64 KB, lead webhooks 256 KB,
  ad lead-form webhooks 1 MB, revenue, CRM and WhatsApp webhooks 2 MB, Spend API 20 MB,
  Conversions API 10 MB); CSV imports are capped at
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
