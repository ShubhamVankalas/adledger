# Compliance guide

How AdLedger's controls line up with privacy laws and security frameworks, what stays your job as the
operator, and which compliance statements are safe to make. Every row names a mechanism that exists
in the code today. Where AdLedger only helps, or does nothing, the table says so.

This is a map of tools, not legal advice and not an audit report. For the mechanisms themselves,
read [Trust & security](SECURITY.md). To report a vulnerability, see [SECURITY.md](../SECURITY.md).

**Contents:**
[1. What this is, and isn't](#1-what-this-is-and-isnt) ·
[2. GDPR and UK GDPR](#2-gdpr-and-uk-gdpr) ·
[3. CCPA / CPRA](#3-ccpa--cpra) ·
[4. ePrivacy and PECR (cookies)](#4-eprivacy-and-pecr-cookies) ·
[5. SOC 2](#5-soc-2-trust-services-criteria) ·
[6. ISO/IEC 27001:2022](#6-isoiec-270012022-annex-a) ·
[7. OWASP Top 10 and ASVS](#7-owasp-top-10-2021-and-asvs-level-2) ·
[8. CIS Docker Benchmark](#8-cis-docker-benchmark) ·
[9. Not covered](#9-what-is-not-covered) ·
[10. Go-live checklist](#10-operator-checklist-for-going-live) ·
[11. Safe-to-claim statements](#11-safe-to-claim-statements)

## 1. What this is, and isn't

**AdLedger is self-hosted software. It is not a service, and it is not certified.**

- SOC 2 and ISO/IEC 27001 assess an **organisation** and the service or management system it runs.
  When you self-host AdLedger, that organisation is you. The AdLedger project runs no service that
  handles your data, so there is nothing for it to certify, and it holds no SOC 2 report, ISO 27001
  certificate or other third-party attestation.
- What AdLedger does provide is **controls and evidence** that make your own audit easier: access
  control with custom roles, two-factor sign-in, an encrypted credential store, a hash-chained audit
  log with export, retention and erasure tools, a documented hardening checklist, and a CI pipeline
  with dependency and image scanning. Sections 5 and 6 show which criteria each one supports.
- **Who is the controller?** When you self-host, you are the data controller (and your hosting
  provider, if any, is your processor). No personal data is sent to the AdLedger project: there is no
  telemetry, licence check or phone-home. The only outbound calls are the integrations you switch on.
- **Pseudonymised is still personal data.** Emails and phone numbers are stored as unsalted SHA-256
  hashes outside the contacts table. That reduces exposure, but a hash of a known email can be
  matched, so treat hashed identifiers as personal data under GDPR.

Where the tables below say **Operator**, the control needs a decision, a contract, a setting or a
process on your side that software cannot supply.

## 2. GDPR and UK GDPR

| Article | Requirement | AdLedger feature | Where | Operator responsibility |
|---|---|---|---|---|
| Art. 5(1)(a), (b) | Lawfulness, fairness, transparency; purpose limitation | Every outbound flow is an integration you switch on, listed in one place. No data goes to the AdLedger project. | Settings → Workspace → Integrations | Privacy notice that names your purposes, recipients (ad platforms, AI model, email) and retention. |
| Art. 5(1)(c) | Data minimisation | Hashed emails and phones outside `contacts`; IPs truncated (IPv4 last octet, IPv6 beyond /48); payloads and event properties run through `redactPii`; the AI model only sees numbers computed by SQL, and the MCP server is read-only and masks emails. | `src/lib/crypto.ts` (`redactPii`), `src/lib/security/device.ts` (`truncateIp`), `src/lib/mcp.ts` | Send only the fields you need through the pixel, forms and imports. |
| Art. 5(1)(e) | Storage limitation | Retention period (7 to 3,650 days) for **raw website events**, applied daily. Erasure per contact. | Settings → Workspace → Privacy; `src/lib/privacy.ts` (`setRetention`, `applyRetentionAll`) | Choose a period. Retention deletes raw events only; contacts, visitors, touchpoints, leads and revenue are kept until you erase them, and the audit log has no automatic expiry. Define your own schedule for those. |
| Art. 5(1)(f) | Integrity and confidentiality | See Art. 32 below. | | |
| Art. 5(2) | Accountability | Audit log with hash chain, Verify and CSV export; security-posture checklist with the install's current state; this document. | Settings → Organization → Audit log and Security policy | Keep the evidence you rely on (exports of the log, review records). |
| Art. 6 | Lawful basis | Consent modes let you tie tracking to consent (below). The product does not pick a basis for you. | Pixel `data-consent`; [PIXEL.md](PIXEL.md#consent) | Decide and document a basis for each purpose (consent, legitimate interests, contract). |
| Art. 7 | Conditions for consent | Pixel modes `optout`, `required` (nothing stored or sent before consent; the landing page is held in memory) and `cookieless`. Snippets that report the visitor's answer from Cookiebot, CookieYes, Osano, Klaro and Google Consent Mode v2 (`ad_user_data`). Withdrawal: `adledger.consent(false)` stops tracking and forgets the visitor. Conversion uploads to Meta and Google are skipped for people who said no, and in `required` and `cookieless` mode for people who never said yes. A yes is remembered for up to 13 months. | `pixel/al.ts`; `src/lib/tracking/consent-modes.ts`; `src/lib/capi/consent.ts` | Run a compliant banner, pick `required` or `cookieless` for EU and UK visitors, keep proof of consent in your banner tool (AdLedger stores the current answer per contact, not a consent receipt). |
| Art. 13, 14 | Information to data subjects | Documents which data the pixel collects and which cookies it sets. | [PIXEL.md](PIXEL.md) | Your privacy notice and cookie policy. |
| Art. 15 | Right of access | Per-contact export (JSON: contact, devices, events, touchpoints, leads, payments and attribution credits; internal CRM notes and tags are not included). | Contacts → Export data; `GET /api/v1/contacts/{id}/export` (needs `contacts:pii`); `exportContact()` | Verify the requester, add any internal notes you hold, reply within one month. Requests from people who were only ever anonymous visitors (no email or form) can't be matched to a contact by AdLedger. |
| Art. 16 | Rectification | Contact name, tags, owner, lifecycle and notes are editable. | Contacts | Process the request. Hashed identifiers and past events are not rewritten. |
| Art. 17 | Erasure | `eraseContact`: deletes the contact and its leads, unlinks visitors, clears event properties and any emails or email hashes in event and touchpoint URLs, keeps revenue rows anonymously so totals stay right, and moves the person's revenue credits to "unattributed". UI and `DELETE /api/v1/contacts/{id}` (needs `ingest:write`). Audited (`contact.erased`) and raises a security alert. | Contacts → Delete; `src/lib/privacy.ts` | Also erase data you sent onward (Meta, Google, your CRM, email tool) and in backups (it ages out when the backup is rotated). Decide when an exemption applies. |
| Art. 18, 21 | Restriction, objection | Consent withdrawal and opt-out stop collection; Global Privacy Control is honoured. No per-contact "restrict" flag. | Pixel; contact `ads_consent` | Handle by erasure, or by excluding the contact in your process. |
| Art. 20 | Portability | Per-contact JSON export; full workspace export (every workspace table as one JSON document, credentials omitted). | Settings → Workspace → Privacy; `workspaceExportJson()` | Deliver in a usable format. Private notes are not part of the workspace export. |
| Art. 24, 25 | Data protection by design and default | Masked emails by default with audited reveal; new API keys default to read-only `reports:read`; hashed and truncated identifiers; consent modes; least-privilege roles. | `src/lib/contact-display.ts`, `src/lib/security/scopes.ts` | Configure to your purposes; don't widen roles or scopes without need. |
| Art. 28 | Processors | The list of connected integrations is your list of recipients. | Settings → Workspace → Integrations | Sign a DPA with each processor: hosting, email/SMTP, AI provider (if not local), Meta, Google, Slack, and so on. Use a local model such as Ollama to keep AI on your server. |
| Art. 30 | Records of processing | Audit log of who did what (exports, reveals, role changes, settings); integration list. It is evidence for a record, not the record itself. | Settings → Organization → Audit log | Keep the Art. 30 record. |
| Art. 32 | Security of processing | Two-factor sign-in, scrypt passwords under NIST 800-63B-4 rules, hashed session tokens, RBAC, AES-256-GCM for stored credentials and 2FA secrets, CSP and security headers, SSRF guard, signed webhooks, rate limits and lockouts, tamper-evident audit log. Full list: [Trust & security](SECURITY.md#3-security-built-in). | See rows in sections 5 and 7 | HTTPS, disk or database encryption, backups, patching, network exposure, host hardening. AdLedger does not encrypt the database itself, only stored credentials. |
| Art. 33, 34 | Breach notification | Detection aids only: a `security_alert` notification for new API keys, role changes, 2FA off or reset, bulk contact or workspace exports, erasures and new-device sign-ins; an audit log you can verify and export for the investigation. AdLedger does not detect intrusions on your host or database. | `src/lib/security/alerts.ts` | Monitoring, an incident process, the 72-hour notification to the authority and notifying affected people. |
| Art. 35 | DPIA | Nothing automated. | | Assess whether profiling and cross-site tracking need a DPIA. |
| Art. 44 to 49 | International transfers | Nothing leaves your server unless you connect it. You choose where to host. | | Pick a hosting region; check transfer mechanisms for the platforms and AI provider you connect. |

## 3. CCPA / CPRA

| Requirement | AdLedger feature | Where | Operator responsibility |
|---|---|---|---|
| Right to know and access | Per-contact export (JSON) | Contacts → Export data; `GET /api/v1/contacts/{id}/export` | Verify identity; respond within 45 days. |
| Right to delete | `eraseContact` (see GDPR Art. 17) | Contacts → Delete; `DELETE /api/v1/contacts/{id}` | Notify service providers and third parties you passed the data to. |
| Right to correct | Editable contact fields | Contacts | Process the request. |
| Right to opt out of sale or sharing | **Global Privacy Control** is read by the pixel and sent with every event. Conversions for GPC visitors go to Meta with Limited Data Use (`LDU`) and to Google with consent denied and no user identifiers. People who denied consent are never uploaded. | `src/lib/capi/consent.ts` | A "Do not sell or share my personal information" link and notice on your site, and honouring opt-outs that arrive by other routes. Sending hashed identifiers to ad platforms can count as "sharing": decide how you treat it. |
| Right to limit use of sensitive personal information | AdLedger doesn't collect sensitive categories by design. | | Don't send them through forms, event properties or imports. |
| Notice at collection, retention disclosure | Retention setting for raw events (see GDPR Art. 5(1)(e)). | Settings → Workspace → Privacy | Disclose retention periods in your notice. |
| Service-provider contract terms | Nothing is sent to the AdLedger project. | | Contracts with the platforms you connect. |
| Reasonable security | See GDPR Art. 32 and section 5. | | Same. |

The same tools are a reasonable base for other state privacy laws and for India's DPDP Act, subject to
the same limits: AdLedger provides the mechanisms, you provide the notices, bases and processes.

## 4. ePrivacy and PECR (cookies)

| Requirement | AdLedger feature | Where | Operator responsibility |
|---|---|---|---|
| Consent before storing or reading non-essential cookies or storage | In `required` mode the pixel sets no cookie, uses no local storage and sends nothing until `adledger.consent(true)`. In `cookieless` mode it uses no cookies or storage at all (a fresh ID per page load). `optout` mode (the default) sets a cookie unless the visitor said no, so it is **not** suitable for EU and UK visitors. | `pixel/al.ts`; Settings → Workspace → Tracking | Choose `required` or `cookieless` for EU and UK traffic, and run a banner with an equal "reject" option. |
| Honour refusal and withdrawal | `adledger.consent(false)` clears the visitor cookie and ID and stops sending. | `pixel/al.ts` | Make withdrawal reachable after the first visit. |
| Cookie information | First-party cookie `_al_vid` (visitor ID, lifetime 390 days, set once and not extended, shared across subdomains) and `_al_consent` (the answer), with a localStorage fallback. When persisting is allowed the pixel also reads Meta's `_fbp` and `_fbc` cookies. | `pixel/al.ts` | List them in your cookie policy. |
| Dashboard cookies | The `al_session` cookie is `httpOnly`, `SameSite=Lax`, `Secure` over HTTPS. It is strictly necessary for signing in and is not used for tracking. | `src/lib/auth.ts` | Mention it if your policy lists strictly necessary cookies. |

## 5. SOC 2 Trust Services Criteria

SOC 2 reports on **your** organisation. The table shows which AdLedger controls can serve as
evidence or as part of your control set. "Operator" marks what your auditor will still expect from
you.

| Criteria | Topic | AdLedger feature | Where | Operator responsibility |
|---|---|---|---|---|
| CC6.1 | Logical access, authentication | scrypt passwords (N=2^15) with a NIST SP 800-63B-4 policy; TOTP two-factor sign-in with ten single-use recovery codes, requirable org-wide; per-IP and per-account lockouts; hashed API keys with scopes and expiry. | `src/lib/auth.ts`, `src/lib/security/{password-policy,totp,two-factor,recovery,scopes}.ts` | Turn on "require 2FA"; run access reviews; manage the server and database credentials. |
| CC6.1 | Encryption of stored secrets | Connector credentials and 2FA secrets in AES-256-GCM with a per-value random IV. Key from `APP_SECRET` (or generated and stored in `app_meta` if unset). Key rotation is not supported yet. | `src/lib/crypto.ts`; [Encryption key](SECURITY.md#encryption-key) | Set `APP_SECRET`, keep it out of the database backup, restrict database access. |
| CC6.2, CC6.3 | Provisioning and removal of access; least privilege | Five built-in roles and **custom roles** with per-page and per-action permissions; workspace-scoped roles for clients; no privilege escalation through a custom role (`canAssign`, `canEditRole`); single-use, 7-day, email-bound invitations; removing a member ends access at once; every server action starts with `guard(permission)` and pages with `gatePage`. | `src/lib/permissions.ts`, `src/lib/roles.ts`, `src/lib/actions.ts`, Settings → Organization → Members and Roles | Joiner, mover and leaver process; periodic access review. |
| CC6.1, CC6.6 | Session management | 256-bit random tokens stored as SHA-256; new token on each sign-in; idle timeout (default 7 days) and maximum lifetime (default 30 days) set by the owner; device list with sign out one or all; password change signs out everywhere. | `src/lib/auth.ts`, `src/lib/security/policy.ts` | Set timeouts to your policy. |
| CC6.6 | Network and boundary protection | CSP, `frame-ancestors 'none'`, HSTS over HTTPS, same-origin check on cookie-authenticated writes (CSRF), SSRF guard on every URL entered in the dashboard, request-size caps, webhook signature verification. | `src/lib/security-headers.ts`, `next.config.ts`, `src/lib/http.ts`, `src/lib/net.ts` | TLS termination, firewall, keep Postgres off the public network, bind the app port to localhost behind a proxy. |
| CC6.7 | Restricting data transmission and export | Separate permissions for aggregate CSV, contact CSV with raw emails, PDF reports; masked exports for everyone else; watermarked and fingerprinted PDFs with an export log and `/verify`; aggregate-only share links (256-bit tokens stored hashed, locked filters, expiry, revocation). | `src/lib/privacy.ts`, `src/lib/share.ts`, [REPORTS.md](REPORTS.md) | Decide who gets export permissions. |
| CC7.1, CC7.2 | Monitoring and anomaly detection | Audit log of sign-ins, failed sign-ins, 2FA changes, role changes, key creation, exports, reveals, erasures and settings changes; `security_alert` notifications to your channels; new-device email. | `src/lib/auth.ts` (`audit`), `src/lib/security/alerts.ts`, `new-device.ts` | Watch the alerts; log and host-level monitoring for your infrastructure. Audit-log CSV export can feed a SIEM by hand or script. |
| CC7.3, CC7.4 | Incident evaluation and response | Verifiable audit trail and CSV export as evidence; break-glass procedure for a locked-out owner (audited, alerts). | Audit log; [Break-glass](SECURITY.md#locked-out-of-two-factor-sign-in-break-glass) | Incident response plan and roles. |
| CC8.1 | Change management | Pull-request CI (lint, type check, tests on embedded and real PostgreSQL 16, browser tests with accessibility checks, Docker smoke test); dependency review and `pnpm audit`; CodeQL; Dependabot; frozen lockfile in the image build; SBOM and SLSA provenance on release images; migrations applied automatically and versioned in `drizzle/`; configuration changes in the product are audited. | `.github/workflows/`, `.github/dependabot.yml`, `Dockerfile` | Your own change process for upgrades: read release notes, test, roll out, keep the previous image tag. Note CodeQL uploads only run while the repository is public. |
| CC9.2 | Vendor and business-partner risk | Integration list = subprocessor list. | Settings → Workspace → Integrations | Vendor reviews and DPAs. |
| A1.2, A1.3 | Availability, backup, recovery | Health endpoint and Docker healthcheck; documented `pg_dump` backup and restore. AdLedger makes no backups itself. | `/api/v1/health`; [SELF_HOSTING.md](SELF_HOSTING.md#backups) | Scheduled backups, restore tests, monitoring, capacity. |
| C1.1, C1.2 | Confidentiality: identify, protect, dispose | Masked emails by role with audited reveal; encrypted credentials; hashed identifiers; erasure and retention tools. | See GDPR rows | Classification, secure disposal of disks and backups. |
| P1 to P8 (privacy) | Notice, choice, access, collection, use and retention, disclosure, quality | Consent modes, GPC, export, erasure, retention, integration list. | See sections 2 to 4 | Notices, contracts, complaint handling. Privacy criteria are optional in a SOC 2 scope. |
| PI1 (processing integrity) | Complete, accurate processing | Money in integer minor units; idempotent webhook ingestion on the provider's ids; every report number computed in SQL, never by the AI; a "Truth gap" page reconciling ad-platform claims against payments. | `src/lib/money.ts`, `src/lib/reports.ts` | Reconciliation against your books. |

## 6. ISO/IEC 27001:2022 Annex A

ISO 27001 certifies an information security management system (ISMS), not software. These are the
Annex A controls AdLedger can support.

| Control | Title | AdLedger support | Operator responsibility |
|---|---|---|---|
| A.5.15, A.5.18 | Access control; access rights | Roles, custom roles, workspace-scoped roles, invitations, member removal, API key scopes. | Access policy and periodic review. |
| A.5.17 | Authentication information | Password policy, TOTP, recovery codes, hashed storage. | Password manager guidance, MFA policy. |
| A.5.23 | Cloud services | The integration list shows every external service in use. | Supplier assessment. |
| A.5.34 | Privacy and protection of PII | Section 2 to 4 tools. | Legal basis and notices. |
| A.5.33, A.8.15 | Protection of records; logging | Hash-chained audit log, Verify, CSV export. Tamper-**evident**, not tamper-proof: someone with database write access could rewrite the whole chain, so note the head hash somewhere else. | Retention of logs, off-server copies. |
| A.8.2, A.8.3 | Privileged access; information access restriction | Owner-only security policy and organization settings; `contacts.pii` and `export.contacts` as separate permissions. | Limit owners and admins. |
| A.8.5 | Secure authentication | 2FA, lockouts, session limits, new-device alerts. | Enforce 2FA. |
| A.8.8 | Technical vulnerability management | Dependabot, `pnpm audit`, dependency review, CodeQL, Trivy on the image, [private vulnerability reporting](../SECURITY.md). | Apply updates promptly (`docker compose pull`). |
| A.8.9 | Configuration management | Security-posture checklist compares your install with the recommended settings; every setting has a default. | Baselines for your host. |
| A.8.10, A.8.11 | Information deletion; data masking | Retention, erasure, masked emails, masked exports, redacted payloads. | Deletion in backups and downstream systems. |
| A.8.12 | Data leakage prevention | Export permissions and log, watermarked PDFs, bulk-export alerts, aggregate-only share links. | Endpoint and network controls. |
| A.8.13 | Backup | Documented procedure. Not automatic. | Run and test backups. |
| A.8.20, A.8.21, A.8.24 | Network security; secure use of cryptography | HSTS, CSP, TLS via the bundled Caddy profile; AES-256-GCM; scrypt; SHA-256; `node:crypto` only. | TLS configuration, database TLS, disk encryption. |
| A.8.25 to A.8.29 | Secure development lifecycle | Typed code, tests, CI, review of dependencies, browser tests with axe, and a schema test that enforces `workspace_id` on every tenant table. | Your own review of forks and customisations. |
| A.8.32 | Change management | See SOC 2 CC8.1. | Your release process. |

## 7. OWASP Top 10 (2021) and ASVS Level 2

A self-assessment against the public lists. AdLedger has **not** been through a formal ASVS
verification or a third-party penetration test. Use the table as a starting point for your own.

| OWASP Top 10 (2021) | How AdLedger addresses it | Known limits |
|---|---|---|
| A01 Broken Access Control | Permission check first in every server action and API route; per-page gates; ids from the browser scoped to the caller's workspace or organization; API keys scoped to one workspace and explicit scopes; masked PII by role; same-origin check on session-authenticated writes; a test enforces `workspace_id` on tenant tables. | |
| A02 Cryptographic Failures | AES-256-GCM for stored secrets; scrypt for passwords; SHA-256 for tokens and API keys; HTTPS with HSTS through the Caddy profile; cookies `httpOnly`, `SameSite=Lax`, `Secure` over HTTPS. | The database itself is not encrypted by AdLedger. Rotating `APP_SECRET` isn't supported yet. The default key sits in the database until you set `APP_SECRET`. |
| A03 Injection | Drizzle ORM and parameterised `sql` templates; CSV cells that a spreadsheet would run as formulas are quoted on export; React escaping; outgoing emails escape every value. | |
| A04 Insecure Design | Least-privilege defaults (read-only key scope, masked emails); read-only MCP server; consent signals in the data model; threat-driven limits on body sizes and rates. | |
| A05 Security Misconfiguration | Secure defaults, security headers, posture checklist, non-root minimal image, documented hardening. | CSP `script-src` allows `'unsafe-inline'` because the Next.js App Router bootstraps with inline scripts. The compose file's default `POSTGRES_PASSWORD` is `adledger` (the database is not published on the host, but change it). |
| A06 Vulnerable and Outdated Components | Dependabot, dependency review, `pnpm audit --prod`, CodeQL, Trivy, frozen lockfile. | Findings below the gate levels (medium and unfixed) don't fail CI. |
| A07 Identification and Authentication Failures | 2FA, NIST-style password policy with a common-password list, lockouts, session rotation on sign-in, idle and absolute session timeouts, new-device alerts. | Rate limits are in-memory per process; per-IP limits trust the proxy's client-IP header. |
| A08 Software and Data Integrity Failures | Signature verification for revenue and lead webhooks (HMAC compared in constant time, replay windows where the provider supports them); SBOM and provenance on release images; hash-chained audit log. | Images are not signed with Cosign. |
| A09 Security Logging and Monitoring Failures | Audit log of security-relevant actions, verification, security alerts, structured logs written without tokens, emails or phone numbers (a project convention). | No built-in log shipping. Application logs go to stdout. |
| A10 Server-Side Request Forgery | Guarded fetch blocks private, loopback, link-local and metadata ranges for every dashboard-entered URL and re-checks redirects. | A DNS-rebinding attacker with a very short TTL could race the check. `ALLOW_PRIVATE_URLS=true` turns the guard off. |

| ASVS chapter (4.0.3) | Highlights |
|---|---|
| V2 Authentication | Salted scrypt; common-password refusal; TOTP MFA; recovery codes stored hashed; lockout; no default credentials (an admin is created on first run). |
| V3 Session Management | Random 256-bit tokens, hashed at rest, rotated on sign-in, revocable per device, idle and absolute timeouts. |
| V4 Access Control | Server-side enforcement, deny by default, tenant scoping, no escalation through custom roles. |
| V5 Validation and Encoding | zod validation of inputs; magic-byte sniffing for uploaded images; CSV import limits (10 MB, 100,000 rows, 100 columns); body-size caps on every public endpoint. |
| V6 Cryptography | Vetted primitives from `node:crypto` only; random IVs; authenticated encryption. |
| V7 Error Handling and Logging | Server actions don't return raw database errors; audit log without secrets or PII. |
| V8 Data Protection | Masking, hashing, truncation, redaction, retention, erasure, export permissions. |
| V9 Communications | HSTS over HTTPS; bundled automatic TLS profile. |
| V10 Malicious Code | Pinned lockfile, dependency review, CodeQL. |
| V13 API | Versioned `/api/v1`, scoped keys, rate limits, CSRF defence for cookie-authenticated calls, OpenAPI description at `/api/v1/openapi.json`. |
| V14 Configuration | Hardened image, headers, dependency scanning. |

## 8. CIS Docker Benchmark

A self-assessment of the shipped `Dockerfile` and `docker-compose.yml`.

| Area | What the image does | What's left to you |
|---|---|---|
| Image and build (CIS 4.x) | Official `node:24-alpine` base; multi-stage build so build tooling and sources stay out of the runtime image; runs as an unprivileged user (`adledger`, uid 1001); npm, npx and the bundled npm packages removed from the runtime image; `HEALTHCHECK` defined; only `COPY`, no `ADD`, no secrets baked in; Trivy scan for fixable high and critical CVEs on every pull request; SBOM and provenance on release images. | Base image is pinned by tag, not by digest. Pin a digest or scan in your registry if your policy requires it. |
| Host and daemon (CIS 1 and 2) | Not applicable to the image. | Host hardening, daemon configuration, auditing. |
| Container runtime (CIS 5.x) | No privileged mode, no host network, no Docker socket mount, no added capabilities. The bundled PostgreSQL is not published on the host. Data lives in named volumes. | Drop capabilities, `no-new-privileges`, read-only root filesystem, memory and CPU limits, restart policy review, and binding the app port to `127.0.0.1` when a reverse proxy fronts it (`PORT` publishes on all interfaces by default). None of these is set in the shipped compose file, on purpose, to keep first install simple. |
| Secrets | Random secrets are generated by `install.sh`; the app takes `APP_SECRET` from the environment. | A secrets manager if your policy requires one. Change `POSTGRES_PASSWORD` on any install reachable beyond the Docker network. |

## 9. What is not covered

- **HIPAA / protected health information.** Not designed, tested or supported for health data. Don't
  send it through forms, events or imports. AdLedger does not sign business associate agreements
  (it has no service to sign for).
- **PCI DSS.** **Card data never touches AdLedger.** Payment providers (Stripe and the others) hold
  it; AdLedger receives webhooks and reads amounts, currencies, ids and timestamps. Keeping it that
  way is your job: don't paste card numbers into forms that reach the pixel, lead webhooks, notes or
  imports. Your own PCI scope depends on how you take payments, not on AdLedger. There is no
  formal PCI assessment of AdLedger.
- **Children's data.** Not designed for it.
- **Certification of the project.** No SOC 2, ISO 27001, HITRUST, FedRAMP, or other attestation exists
  for AdLedger, and none can exist for the software alone.
- **Data residency, sovereignty, legal hold.** You choose where you host; AdLedger has no legal-hold
  feature.
- **Penetration testing.** No independent test has been published. Commission your own if a customer
  or regulator requires one.
- **Automatic backups, disaster recovery, database encryption at rest, log shipping, key rotation.**
  Not built in.

## 10. Operator checklist for going live

Settings → Organization → Security policy shows the first items with your install's live state.

**Infrastructure**
1. Serve over **HTTPS** (`docker compose --profile https up -d` with `DOMAIN`, or your own TLS proxy that
   sets `X-Forwarded-Proto`). Bind the app port to localhost if a proxy fronts it.
2. Set **`APP_SECRET`** and keep it out of the database backup. Change **`POSTGRES_PASSWORD`**.
3. Keep PostgreSQL private; enable disk or volume encryption at rest.
4. Schedule **backups**, keep them encrypted, and test a restore. Decide how long backups live (this
   sets how long erased data can remain).
5. Put AdLedger behind a proxy that sets the client IP header, so per-IP limits work.

**Access**
6. Turn on **Require two-factor sign-in**, owners first. Store recovery codes offline.
7. Use the smallest role that works; create custom roles; give `contacts:pii` API keys sparingly and
   set expiries.
8. Review members, roles and API keys on a schedule (quarterly is common) and keep a record.
9. Verify the audit log regularly and note the head hash off-server.

**Privacy**
10. Choose a consent mode: `required` or `cookieless` for EU and UK visitors; connect your cookie
    banner with the matching snippet.
11. Publish a privacy notice and cookie policy that match what you collect (see [PIXEL.md](PIXEL.md)),
    plus a "Do not sell or share" link if CCPA/CPRA applies.
12. Set a **retention period** for raw events, and a manual schedule for contacts and audit data.
13. Sign **DPAs** with processors: hosting, email, AI provider, ad platforms, notification channels.
    Use a local model if you don't want AI traffic to leave your server.
14. Write down the process for access and erasure requests, including erasing data sent to Meta,
    Google and other platforms.
15. Keep your Art. 30 record, DPIA (if needed) and incident plan (72-hour notification).

**Operations**
16. Update regularly (`docker compose pull && docker compose up -d`); read release notes first.
17. Watch `security_alert` notifications; route them to a channel someone reads.
18. Publish your own security contact with `SECURITY_CONTACT`.

## 11. Safe-to-claim statements

These are true of the code today and safe for a website, README or sales page. Use the wording as
written or close to it; the qualifiers matter.

| Statement | Why it is accurate |
|---|---|
| **Self-hosted: your data never leaves your server** (except through integrations you switch on) | No telemetry or phone-home; outbound calls are the integrations you configure. |
| **Open source and auditable (AGPL-3.0)** | Full source, CI and docs in the repository. |
| **Built to help you meet GDPR, UK GDPR and CCPA/CPRA obligations** ("GDPR-ready tooling", "CCPA-ready tooling") | Consent modes, GPC, export, erasure, retention, minimisation, masking. Always as *tooling that helps you comply*, never "GDPR compliant". |
| **Privacy by design: hashed identifiers, truncated IPs, masked emails, redacted payloads** | See Art. 5(1)(c) and 25 rows. Say "hashed", not "anonymous". |
| **SOC 2-aligned controls** (or "controls that map to SOC 2 criteria") | Section 5 maps access control, monitoring, change management and confidentiality features. Not "SOC 2 compliant", not "SOC 2 certified". |
| **ISO 27001-aligned controls** (optional) | Section 6. Not "ISO 27001 certified". |
| **Security practices informed by OWASP Top 10 and ASVS** | Section 7 self-assessment. Not "ASVS certified" or "ASVS Level 2 verified". |
| **Two-factor sign-in, custom roles and audit log, all free** | Everything is in the open-source code; there is no paid security tier. |
| **Tamper-evident audit log** | Hash-chained with Verify. Not "tamper-proof". |
| **AES-256-GCM encryption for stored credentials** | Connector credentials and 2FA secrets. Not "all data encrypted at rest". |
| **Non-root container image with vulnerability scanning in CI** | Dockerfile, Trivy step. |
| **Card data never touches AdLedger** | Payment providers hold it; only amounts and ids arrive. |
| **Supply-chain checks: dependency review, `pnpm audit`, CodeQL, Dependabot, SBOM and provenance** | Configured in `.github/workflows`. Say CodeQL runs on the public repository. |

**Do not claim:** "SOC 2 certified/compliant", "ISO 27001 certified", "GDPR compliant" or "CCPA compliant"
(as a property of the product), "HIPAA compliant", "PCI DSS compliant/certified", "penetration tested",
"bank-grade" or "military-grade" encryption, "unhackable", "zero trust", "your data is anonymous",
"encrypted at rest" without qualification, or any badge or logo of an auditor or certification body.
When you self-host, compliance is a property of your organisation and how you run it, and you can
say so plainly: "We run AdLedger, which ships controls that support our GDPR and SOC 2 programmes."
