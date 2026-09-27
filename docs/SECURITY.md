# Trust & security

This page explains how AdLedger handles your data, what it protects against, and what is still
your job as the person running it. It names mechanisms, not slogans. To report a vulnerability,
see [SECURITY.md](../SECURITY.md).

## 1. Your data stays in your database

AdLedger is open source (AGPL-3.0) and self-hosted. There is no AdLedger server in the loop: no
telemetry, no licence check, no phone-home. The only outbound calls are the ones you configure:
ad platforms, revenue sources, your AI model and your notification channels. Each one is listed in
Settings → Workspace → Integrations and can be switched off there.

## 2. Who is responsible for what

When you self-host AdLedger, **you are the data controller** (and the processor) for everything in
it. AdLedger is built to help you meet GDPR, UK GDPR, CCPA/CPRA and India's DPDP. It does not make
you compliant by itself.

We don't hold SOC 2 or ISO 27001 certification. Those audit organisations that run a service, not
a codebase, and we don't run your install. AdLedger ships controls that map to common SOC 2
criteria (access control, audit logging, encryption, change management), but the project itself is
not audited. You will never see a certification badge from us unless a service we operate has
actually been audited.

## 3. Security built in

| Area | Mechanism |
|---|---|
| Passwords | scrypt (N=2^15). Policy follows NIST SP 800-63B-4: at least 15 characters, or 8 when two-factor sign-in is on; no composition rules, no forced rotation; a shipped list of common passwords, repeated or sequential characters and your own email or name are refused. |
| Two-factor sign-in | TOTP (RFC 6238: SHA-1, 6 digits, 30 s, one step of clock drift) implemented on `node:crypto`. A code can't be used twice. Ten single-use recovery codes, stored as scrypt hashes. Owners can require 2FA for the whole organization; members without it can only enrol until they set it up. |
| Sessions | 256-bit random tokens, stored as SHA-256 hashes, in `httpOnly`, `SameSite=Lax` cookies (`Secure` over HTTPS). A new token on every sign-in. Idle timeout (default 7 days) and maximum lifetime (default 30 days), set by the owner. Each session records a truncated IP, a short browser description and when it was last seen; you can sign out one device or every other device. A password change signs out everywhere. |
| New devices | A sign-in from a browser we haven't seen for your account sends you an email (when email is configured) and a `security_alert` to your team's channels. |
| Roles | Five roles: owner, admin, analyst, viewer, client. Viewers and clients see masked contact emails (`p•••@gmail.com`); owners, admins and analysts can reveal an email, and every reveal is written to the audit log. Clients only see the workspaces you pick. |
| Exports | Separate permissions for aggregate CSVs (`export.csv`), contact CSVs with raw emails (`export.contacts`, owners and admins) and PDF reports (`reports.pdf`). Everyone else who may export contacts gets masked emails. A contact export over 1,000 rows raises a security alert. |
| API keys | Workspace-scoped, stored hashed, optional expiry. Each key carries scopes: `reports:read` (the default for new keys), `mcp`, `contacts:read` (masked emails), `contacts:pii` (raw emails, only owners and admins can create it) and `ingest:write`. Keys created before scopes existed kept everything except `contacts:pii`. |
| Credentials at rest | Connector tokens and 2FA secrets are encrypted with AES-256-GCM and never sent back to the browser. See [Encryption key](#encryption-key). |
| Webhooks | Provider signatures (HMAC, compared in constant time), replay windows where the provider supports them, idempotent ingestion. |
| Outbound requests | URLs typed into the dashboard can't reach private, loopback, link-local or cloud-metadata addresses (SSRF guard), and redirects are re-checked. |
| Browser | Content-Security-Policy, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS over HTTPS. Mutating API calls made with a session must be same-origin. |
| Audit log | Every sign-in, 2FA change, role change, key creation, export, reveal and settings change, with a truncated IP and browser. Entries form a hash chain per organization; **Verify** recomputes it and names the first entry that was edited, removed or reordered. The log can be filtered and exported as CSV (owners and admins). |
| Security alerts | Notification event `security_alert`: new API key, role change, 2FA turned off or reset, bulk contact export, workspace export, contact erasure, sign-in from a new device. Messages carry names and counts, never a contact's email or a token. |

The hash chain makes tampering **evident**, not impossible: someone with write access to the
database could rewrite the whole chain. Note the head hash shown on the audit page somewhere else
(a ticket, a printout) if you want to be able to prove later that nothing changed.

## 4. Privacy by design

- Raw emails live only in `contacts` (and the login table). Everywhere else, emails and phone
  numbers are SHA-256 hashes of the lowercased, trimmed value.
- IP addresses are truncated before storage (the last IPv4 octet, IPv6 beyond /48).
- Stored form payloads and event properties are redacted.
- The pixel has consent modes (opt-out by default, opt-in required, cookieless) and honours Global
  Privacy Control. Conversions sent back to ad platforms carry consent signals, and people who said
  no are never uploaded.
- Erasure and subject-access export per contact, a full workspace export, and a retention period
  for raw website events.
- The AI works with your own model (including a local one such as Ollama) and only sees numbers
  computed by SQL. The MCP server is read-only and masks emails.

## 5. Data that can't walk off unnoticed

Leaks are deterred and traceable, not impossible. The tools are permissions (who can export what),
masking by default, audited reveals, alerts on bulk exports and a tamper-evident audit trail.

We don't block right-click, text selection or screenshots, and we don't add DevTools traps.
View-source, browser extensions and a phone camera get around all of it, and it breaks
accessibility. We would rather tell you that plainly.

## 6. Supply chain

- Every pull request runs lint, type checks, the full test suite (embedded and real PostgreSQL),
  browser tests with axe accessibility checks and a Docker smoke test.
- GitHub dependency review blocks new dependencies with known high-severity advisories;
  `pnpm audit` checks the production dependency tree; CodeQL scans the code and the workflows;
  Trivy scans the Docker image for fixable high and critical vulnerabilities.
- Dependabot opens weekly update pull requests for npm packages, GitHub Actions and the base image.
- Release images carry an SBOM and SLSA provenance attestation in the registry.

## 7. Operator hardening checklist

Settings → Organization → Security policy shows this checklist with your install's current state.

1. **Set `APP_SECRET`** and keep it out of your database backups ([how](#encryption-key)).
2. **Use HTTPS.** `docker compose --profile https up -d` with `DOMAIN` set starts Caddy with
   automatic certificates; or put your own TLS proxy in front and have it set `X-Forwarded-Proto`.
3. **Require two-factor sign-in** for the organization, and turn it on for every owner first.
4. **Keep sessions short.** Seven days idle or less.
5. **Back up.** AdLedger doesn't make backups. Snapshot your PostgreSQL volume or run a scheduled
   `pg_dump` (or copy `DATA_DIR` on the embedded database), and test a restore.
6. **Review API keys.** Revoke keys you don't use; give `contacts:pii` only to integrations that
   truly need raw emails.
7. **Verify the audit log** now and then.
8. **Stay up to date.** `docker compose pull && docker compose up -d`.

### Encryption key

`APP_SECRET` is the key that encrypts connector credentials and 2FA secrets. If it isn't set,
AdLedger generates one on first boot and stores it in the database (`app_meta`). That keeps the
install zero-config, but it puts the key next to the data it protects: anyone with a copy of the
database can decrypt the credentials.

To move the key out of the database **without losing saved credentials**, reuse the generated
value (a new random value would make everything already encrypted unreadable):

1. Read the current key:
   - Docker (bundled Postgres):
     `docker compose exec postgres psql -U adledger -d adledger -tAc "select value from app_meta where key = 'app_secret'"`
   - External PostgreSQL: run the same `select` with `psql` against your database.
2. Put that value in `.env` as `APP_SECRET=...` (or your platform's secret settings) and restart.
   Check that Settings → Workspace → Integrations still shows your connections as working.
3. Delete the stored copy:
   `delete from app_meta where key = 'app_secret';`
4. Keep `APP_SECRET` in a password manager or secret store, **not** in the same backup as the
   database.

On a fresh install, simply set `APP_SECRET` (`openssl rand -base64 32`) before the first start.
Rotating to a new key (re-encrypting stored credentials) is not supported yet.

### Locked out of two-factor sign-in (break-glass)

If an owner has lost both their authenticator and their recovery codes:

1. Set `ADLEDGER_BREAK_GLASS=owner@yourcompany.com` in the server environment (`.env` with
   Docker) and restart AdLedger.
2. On start, two-factor sign-in is turned off for that account, only if it owns an organization.
   The reset is written to the audit log and raises a security alert.
3. Sign in with the password, set up two-factor sign-in again, then **remove the variable** and
   restart.

Anyone who can change the server's environment already controls the install, so this doesn't open
a new way in. Other members can be reset by an owner from Settings → Organization → Security policy.

## 8. Reporting a vulnerability

Use GitHub private vulnerability reporting (the repository's **Security** tab →
**Report a vulnerability**). We acknowledge within 3 working days and assess within 10.
Good-faith research on your own install is welcome and we won't pursue it legally. Every install
serves [`/.well-known/security.txt`](https://www.rfc-editor.org/rfc/rfc9116) (RFC 9116); set
`SECURITY_CONTACT` to list your own contact for problems with your install first.

## 9. What AdLedger is not for

Health records, payment card data (Stripe and the other payment providers hold it, AdLedger only
sees amounts) and data about children. It isn't designed or tested for those.

## 10. Licence and name

AdLedger is licensed under the GNU AGPL-3.0: if you run a modified version as a network service,
you must offer its source to its users. The name and logo are covered by
[TRADEMARKS.md](../TRADEMARKS.md): use them freely for your own install; forks need their own name.
