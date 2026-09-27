# Self-hosting AdLedger

AdLedger is one container plus PostgreSQL. It needs about 1 GB of RAM and almost no CPU.

## Option 1 — one-line install on a server (recommended)

On any Linux VPS (Hetzner, DigitalOcean, Lightsail, a Raspberry Pi…) with Docker installed:

```bash
curl -fsSL https://raw.githubusercontent.com/ShubhamVankalas/adledger/main/install.sh | DOMAIN=ads.yourcompany.com sh
```

1. Point a DNS **A record** for `ads.yourcompany.com` at the server first.
2. The script creates `./adledger` with `docker-compose.yml` and a `.env` containing random
   secrets, starts PostgreSQL + AdLedger + Caddy, and gets a Let's Encrypt certificate.
3. Open `https://ads.yourcompany.com` and create your account.

Leave out `DOMAIN=` to run on `http://SERVER-IP:3000` without HTTPS (fine for a trial, not for
production — the pixel should be served over HTTPS).

No Docker yet? `curl -fsSL https://get.docker.com | sh`

## Option 2 — docker compose (laptop or server)

```bash
git clone https://github.com/ShubhamVankalas/adledger.git && cd adledger
cp .env.example .env        # optional — every setting has a default
docker compose up -d
```

Open http://localhost:3000. For HTTPS on a server set `DOMAIN=` (and `PUBLIC_URL=https://…`) in
`.env`, then `docker compose --profile https up -d`.

**Demo in one command** (no setup screen, 90 days of sample data):

```bash
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=adledger-demo-123 DEMO_DATA=true docker compose up -d
```

Passwords need at least 15 characters (8 once two-factor sign-in is on).

## Option 3 — platforms

- **Render:** [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/ShubhamVankalas/adledger)
  or create a Blueprint from your fork; `render.yaml` provisions the web service, a PostgreSQL 16
  database and a generated `APP_SECRET`.
- **Railway:** new project → deploy from your fork (uses `Dockerfile` / `railway.json`) → add a
  PostgreSQL plugin → set `DATABASE_URL=${{Postgres.DATABASE_URL}}` on the service.
- **Coolify / Dokploy / CapRover / Portainer:** deploy the Docker Compose file as-is.
- **Any container host:** image `ghcr.io/shubhamvankalas/adledger`, port 3000, set `DATABASE_URL`.

## Option 4 — single container, no Postgres

```bash
docker run -d -p 3000:3000 -v adledger:/data ghcr.io/shubhamvankalas/adledger
```

Uses the embedded database stored in the `/data` volume. Great for evaluation and very small
sites; use PostgreSQL for anything important.

## First-party cookies (recommended)

Safari and ad blockers are harsher on third-party trackers. Serve AdLedger from a **subdomain of
your website** (e.g. `t.yourshop.com` → your AdLedger server) so the pixel's cookie is
first-party. With the install script: `DOMAIN=t.yourshop.com`.

## Upgrading

```bash
cd adledger
docker compose pull && docker compose up -d
```

Database migrations run automatically at startup. Pin a version with `ADLEDGER_VERSION=0.1.0`
in `.env`.

## Backups

Everything lives in PostgreSQL:

```bash
docker compose exec postgres pg_dump -U adledger adledger | gzip > adledger-$(date +%F).sql.gz
```

Restore: `gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U adledger adledger`.
You also need `APP_SECRET` to restore: it decrypts the stored credentials and 2FA secrets. Keep it in
a password manager or secret store, **not** in the same place as the database backup (see
[SECURITY.md → Encryption key](SECURITY.md#encryption-key)). On the embedded database, back up the
data folder (`DATA_DIR`, `/data` in the single container) instead.

## Configuration reference

See [`.env.example`](../.env.example). Highlights:

| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | Public URL used in snippets/webhook URLs (auto-detected) |
| `APP_SECRET` | Encrypts stored credentials (auto-generated if empty) |
| `DATABASE_URL` | External PostgreSQL (Neon, Supabase, RDS…) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Create the admin on first boot (headless installs) |
| `RESET_PASSWORD=true` | With the two above: reset that user's password on next start |
| `DEMO_DATA=true` | Load demo data on first boot |
| `LLM_MODEL`, `LLM_API_BASE`, `LLM_API_KEY` | Default AI model (can also be set in the UI) |
| `SYNC_INTERVAL_HOURS` | Ad sync frequency (default 6) |
| `SMTP_URL`, `SMTP_FROM` | Email for invitations, alerts and scheduled PDF reports when no Email channel is set up in the dashboard |
| `DOMAIN` | Hostname for the bundled Caddy HTTPS profile |
| `SECURITY_CONTACT` | Your contact for vulnerability reports, listed first in `/.well-known/security.txt` |
| `ADLEDGER_BREAK_GLASS` | One-time two-factor reset for a locked-out owner ([how](SECURITY.md#locked-out-of-two-factor-sign-in-break-glass)); remove it after signing in |
| `COOKIE_SECURE`, `ALLOW_PRIVATE_URLS`, `DISABLE_SCHEDULER` | Advanced: force secure cookies, allow private outbound URLs, run without background jobs |

## Hardening

Before you put real customer data in it, go through the operator checklist in
[SECURITY.md](SECURITY.md#7-operator-hardening-checklist): set `APP_SECRET`, serve over HTTPS,
require two-factor sign-in, keep sessions short, back up, review API keys, verify the audit log and
stay up to date. **Settings → Organization → Security policy** shows the same checklist with your
install's current state.

## Troubleshooting

- **Health:** `curl http://localhost:3000/api/v1/health` → `{"status":"ok","db":"ok"}`
- **Logs:** `docker compose logs -f app`
- **Forgot password:** set `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `RESET_PASSWORD=true` in `.env`,
  `docker compose up -d`, sign in, then remove `RESET_PASSWORD`.
- **Ollama in Docker:** use `http://host.docker.internal:11434/v1` as the base URL.
- **Windows (Docker Desktop):** works as-is. If Docker Desktop crashes at start with
  “initializing Inference manager… dockerInference”, quit Docker, rename
  `%LOCALAPPDATA%\Docker\run` to anything else and start it again.
