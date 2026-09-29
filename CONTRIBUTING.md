# Contributing to AdLedger

Thanks for helping! AdLedger is a free, self-hosted ad attribution and revenue ledger, and its
number one goal is that **anyone can install it with one command**. Good contributions keep that
true: small, focused, no new services, no heavy dependencies.

This page covers how to get set up, how a change travels from your fork to `main`, and the few
rules that are not up for negotiation. It is short on purpose. If something is unclear, ask in a
[Discussion](https://github.com/ShubhamVankalas/adledger/discussions); questions are welcome.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). AdLedger is
licensed under [AGPL-3.0](LICENSE), and your contributions are too (see [Sign-off](#sign-off-dco)).

**Contents:** [Ways to help](#ways-to-help) · [Set up](#set-up) · [Branches and commits](#branches-and-commits) ·
[The pull request flow](#the-pull-request-flow) · [What "done" means](#what-done-means) ·
[Non-negotiables](#non-negotiables) · [Security expectations](#security-expectations) ·
[Sign-off (DCO)](#sign-off-dco) · [Big changes](#proposing-a-big-change) · [Good first issues](#good-first-issues)

## Ways to help

- **Report a bug** or **request a feature or integration** with the
  [issue forms](https://github.com/ShubhamVankalas/adledger/issues/new/choose). Search first; add your
  details to an existing issue if there is one.
- **Fix something.** Issues labelled `good first issue` and `help wanted` are the best places to start.
- **Improve the docs.** A confusing sentence you had to read twice is a bug. Fix it.
- **Add an integration** (an ad platform or revenue source). Open an issue first, see [Big changes](#proposing-a-big-change).
- **Found a security problem?** Do **not** open a public issue. Follow [SECURITY.md](SECURITY.md).

## Set up

You need Node.js 20.9 or newer and [pnpm](https://pnpm.io/installation). You do **not** need Docker
or a database server.

```bash
git clone https://github.com/<your-username>/adledger.git   # your fork
cd adledger
pnpm install
pnpm dev        # http://localhost:3000
```

- `pnpm dev` starts an **embedded PostgreSQL** (PGlite) in `./.data`. Delete that folder to start
  over. Migrations apply automatically at startup.
- On first open you get the setup screen; tick **Start with demo data** for a realistic workspace
  with 90 days of spend, visitors, leads and revenue.
- Every connector has a **mock mode** that serves realistic data in the platform's real API format
  (`CONNECTOR_MODE=mock`, or per connection). You never need real ad or Stripe accounts to
  develop or test. Tests use mock mode too.
- All environment variables are optional and documented in [.env.example](.env.example). Configuration
  belongs in the dashboard where possible, not in env files.
- Windows is fully supported. Keep LF line endings (`.gitattributes` handles it).

Useful commands:

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server with the embedded database |
| `pnpm lint` / `pnpm typecheck` | ESLint and TypeScript (strict) |
| `pnpm test` | Whole test suite (vitest, embedded Postgres) |
| `pnpm exec vitest run tests/money.test.ts` | Just one test file while you work |
| `TEST_DATABASE_URL=postgres://… pnpm test` | Suite against a real PostgreSQL 16 |
| `pnpm db:generate` | Create a migration after editing `src/lib/db/schema.ts` |
| `pnpm pixel` | Rebuild the tracking pixel (must stay under 5 KB gzipped) |
| `pnpm build` | Production build |
| `docker compose up -d --build` | The full Docker stack, http://localhost:3000 |

New here? Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the stack, data model and flows, and
[docs/PRODUCT.md](docs/PRODUCT.md) for what we are building and for whom.

This is Next.js 16 with breaking changes compared to older tutorials. Check
`node_modules/next/dist/docs/` when in doubt (for example `middleware` is now `proxy`, and
`params` and `searchParams` are Promises).

## Branches and commits

1. **Fork** the repository and clone your fork.
2. Create a **branch from `main`**, named `type/short-description` in lowercase with dashes:
   `feat/bing-ads-connector`, `fix/refund-rounding`, `docs/self-hosting-caddy`, `chore/bump-drizzle`.
3. Commit with **[Conventional Commits](https://www.conventionalcommits.org/)**:
   `type(optional-scope): what changed`, in the imperative and under about 72 characters.

   | Type | Use for |
   |---|---|
   | `feat` | A user-visible feature |
   | `fix` | A bug fix |
   | `docs` | Documentation only |
   | `refactor` / `perf` | Code changes that don't alter behaviour / make it faster |
   | `test` | Tests only |
   | `build` / `ci` / `chore` | Tooling, dependencies, workflows, housekeeping |

   Examples: `fix: reject negative spend rows`, `feat(connectors): add Bing Ads`, `docs: clarify install.sh flags`.
   Add `!` for a breaking change (`feat!: rename the spend API field`) and explain it in the body.
4. **Sign every commit off** with `git commit -s` (see [Sign-off](#sign-off-dco)).

Keep commits and pull requests **small and focused**: one concern per PR. A 150-line PR gets
reviewed this week; a 3,000-line one waits.

## The pull request flow

```
fork  →  branch  →  pull request to main  →  CI passes  →  review  →  squash merge
```

1. Push your branch to your fork and open a **pull request against `main`**. Fill in the template.
   The **PR title must be a conventional commit message** too, because it becomes the commit on
   `main` (we squash-merge).
2. **CI must pass.** It runs lint, type check, the tests (embedded and real Postgres), a production
   build, a browser test, a Docker build with an image scan, a dependency and licence review, a DCO
   check and the PR title check. The first time you contribute, a maintainer has to approve the run.
3. **Review.** A maintainer reviews every PR. Expect questions and requests for changes; they are about the
   code, not about you. Push follow-up commits (still signed off) and resolve conversations when done.
   Changes to security-sensitive code (auth, permissions, crypto, migrations, workflows, Dockerfile,
   `install.sh`) always need the maintainer's review.
4. **Squash merge.** Once approved and green, a maintainer squash-merges. `main` keeps a linear
   history and your branch is deleted automatically. You are credited as the author.

Draft PRs are welcome for early feedback. Mark them ready when CI is green.

## What "done" means

A change is ready for review when **all** of these are true:

- [ ] `pnpm lint` passes.
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm test` passes, and your change has tests (a bug fix has a test that fails without the fix).
- [ ] **Docs are updated** where behaviour changed: the relevant page in `docs/`, `.env.example` for new env vars,
      [docs/ROADMAP.md](docs/ROADMAP.md) if you finish or start a roadmap item.
- [ ] **Schema changed?** You edited `src/lib/db/schema.ts`, ran `pnpm db:generate`, and committed the
      generated SQL in `drizzle/`. Never edit a migration that has shipped. Add a new one.
- [ ] **UI changed?** Screenshots (light and dark if it matters) are in the PR, and it works on a phone-width screen.
- [ ] **New connector?** It has a mock mode serving realistic data in the platform's real API format, a
      fixture in `fixtures/`, and a parser test. Register it in the folder's `index.ts`; the registry drives
      the Settings catalog, sync and webhooks.
- [ ] Every commit is signed off.
- [ ] No secrets, tokens or real customer data anywhere in the diff.

Run `pnpm build` too if you touched anything that affects the production bundle (routes, config, the pixel).

## Non-negotiables

These are the project's load-bearing rules. PRs that break them will be asked to change, however
good the rest is.

1. **Install stays dead simple.** `docker compose up -d` and the one-line `install.sh` must keep
   working for a non-technical person. **No new services or containers** (no Redis, queue, worker)
   without a very good reason agreed in an issue first. Background work runs in-process
   (`src/lib/jobs.ts`). Migrations apply automatically at startup.
2. **Every env var is optional.** A fresh install works with none set. Configuration goes in the
   dashboard (stored encrypted in the database) where possible. Document any new variable in `.env.example`.
3. **Money is integer minor units, never floats.** Store `*_minor bigint` plus an ISO currency and use
   `src/lib/money.ts`. Timestamps are UTC `timestamptz`; convert only in the UI or with the
   workspace timezone in SQL.
4. **Every tenant table has `workspace_id`** (only `workspaces` and `app_meta` don't). A test enforces it.
   Ids that come from the browser are always scoped to the caller's workspace or organization.
5. **Protect personal data.**
   - Raw email lives only in `contacts` (and the admin login in `users`). Everywhere else store the
     SHA-256 of the lowercased, trimmed value.
   - Run stored payloads through `redactPii`.
   - **Never log** tokens, emails or phone numbers.
6. **Server actions start with `guard(permission)`** (see `src/lib/permissions.ts`) and record changes
   with `audit()`. Pages that need a role use `requireUser(permission)`.
7. **Numbers come from SQL.** All reporting figures come from `src/lib/reports.ts`. The LLM never
   computes numbers.
8. **MCP tools are read-only.** A future write tool must default to paused or draft and require explicit
   confirmation.
9. **REST routes are versioned** (`/api/v1/...`).
10. **Keep the stack.** Next.js 16 + TypeScript strict, PostgreSQL via Drizzle, Tailwind v4 + shadcn/ui
    (Base UI flavour: use `render={<Link/>}`, not `asChild`), Vercel AI SDK, pnpm. Prefer the standard
    library and dependencies we already have. Changing the stack needs a discussion first.

## Security expectations

AdLedger holds ad-platform credentials, customer emails and revenue data, so review is strict about:

- **No secrets in code, tests, fixtures, docs or commit history.** That includes real API keys, tokens,
  webhook secrets, and real customer emails or phone numbers. Use obviously fake values
  (`ana@acme.test`). If you leak a real secret by accident, tell us and **revoke it immediately**;
  deleting the commit is not enough.
- **No new outbound network calls without discussion.** AdLedger's promise is no telemetry and no
  phone-home: the only outbound calls are the ones the operator configures (ad platforms, revenue
  sources, their AI model, their notification channels). A new integration or endpoint needs an
  issue first, must be off until configured, and must go through the SSRF guard when the URL is user-supplied.
- **New dependencies need justification.** Say in the PR what it does, why the standard library or an
  existing dependency isn't enough, its licence (it must fit AGPL-3.0; SSPL and BUSL are refused by CI),
  and how well maintained it is. Prefer small, widely used packages, and none that run install scripts
  unless unavoidable. Never add a dependency to the pixel.
- **Don't weaken defaults.** No loosening of the CSP, cookie flags, rate limits, permission checks or the
  private-URL guard just to make something work.
- **Found a vulnerability?** Report it privately, not in a public issue or PR. See [SECURITY.md](SECURITY.md).

## Sign-off (DCO)

AdLedger uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). It is a
lightweight way to say "I wrote this, or I have the right to submit it, under this project's licence
(AGPL-3.0)". There is no CLA and you keep your copyright.

You sign off by adding one line to each commit message:

```
Signed-off-by: Your Name <you@example.com>
```

Git does it for you:

```bash
git commit -s -m "fix: reject negative spend rows"
```

- The name and email must match your commit author (`git config user.name` / `user.email`). GitHub's
  private `…@users.noreply.github.com` address is fine.
- Forgot? Fix the last commit with `git commit --amend -s --no-edit`, or every commit in your branch with
  `git rebase --signoff origin/main` followed by `git push --force-with-lease`.
- To sign off automatically, use a git alias such as `git config --global alias.cs "commit -s"`.
- CI **requires** it: the `dco` check fails the PR when a commit is missing its sign-off. You can run the
  same check locally with `bash scripts/github/check-dco.sh origin/main` (Git Bash on Windows).
  Commits made by bots such as Dependabot are exempt.

## Proposing a big change

For anything larger than a bug fix or a small improvement, **open an issue or a
[Discussion](https://github.com/ShubhamVankalas/adledger/discussions) before writing code.** That
includes new integrations, schema changes, new dependencies, changes to auth, permissions or
attribution logic, and anything touching the install path. Describe the problem, your proposed
approach, files and schema affected, and how you'll test it. A few minutes of agreement up front saves
you from a rejected 2,000-line PR.

Small things (typos, a clear bug fix, a doc improvement, a test) don't need an issue. Just open the PR.

## Good first issues

Look for the [`good first issue`](https://github.com/ShubhamVankalas/adledger/labels/good%20first%20issue)
and [`help wanted`](https://github.com/ShubhamVankalas/adledger/labels/help%20wanted) labels. Typical
starters: a docs fix, a missing test, a small UI polish, a mock fixture for a connector, a translation of an
error message. Comment on the issue to claim it so two people don't do the same work; if you go quiet for
two weeks it goes back in the pool, no hard feelings.

## Code of Conduct

Be kind, be constructive, assume good intent. The full text is in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
(Contributor Covenant 2.1) and applies to issues, pull requests, discussions and every other project space.

## Project layout and maintainers

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the project layout. How releases are cut, the branch
protection policy and the triage labels are in [docs/MAINTAINERS.md](docs/MAINTAINERS.md).
