# Maintainers' guide

Short notes for whoever holds the keys. Contributors: see [CONTRIBUTING.md](../CONTRIBUTING.md).
Current maintainer and owner: Shubham Vankalas ([@ShubhamVankalas](https://github.com/ShubhamVankalas)).

## Cutting a release

Releases are tags. `.github/workflows/release.yml` does the rest.

1. Make sure `main` is green (CI, CodeQL) and `docs/ROADMAP.md` is current.
2. Bump `version` in `package.json` on a normal PR (`chore: release 0.2.0`), and merge it.
3. Tag the merge commit and push the tag, using the semver form `vX.Y.Z`:

   ```bash
   git checkout main && git pull
   git tag -s v0.2.0 -m "v0.2.0"      # or -a if you don't sign tags
   git push origin v0.2.0
   ```

4. The **Release image** workflow builds a multi-arch (amd64, arm64) image and pushes it to
   `ghcr.io/shubhamvankalas/adledger` as `:0.2.0`, `:0.2` and `:latest`, with an SBOM and SLSA
   provenance attached. Every push to `main` also publishes `:edge`.
5. Write the GitHub Release notes (Releases -> Draft a new release -> pick the tag ->
   **Generate release notes**, then edit). Credit contributors and security reporters (if they agreed).
   Note breaking changes and migrations at the top.
6. Verify: `docker pull ghcr.io/shubhamvankalas/adledger:0.2.0`, then run the one-line install on a
   clean machine.

A security fix goes out as a patch release. Publish the GitHub Security Advisory (with CVE if
warranted) once the patched image is up. See [SECURITY.md](../SECURITY.md).

## Branch protection policy

`main` is protected by the repository ruleset **Protect main**. Apply or re-apply it with
`scripts/github/protect-main.sh` (run from Git Bash once the repository is public; it is idempotent,
and `--dry-run` shows what it would change). It sets:

- **Pull request required**: 1 approval, stale approvals dismissed on new pushes, **CODEOWNERS review**
  required (`.github/CODEOWNERS`), all conversations resolved. Squash merge only.
- **Required status checks** (job names): `supply-chain`, `check`, `e2e`, `postgres`, `docker` (from
  `ci.yml`), `dco` and `title` (from `pr-hygiene.yml`). Rename a job and you must update the script and rerun it.
- **No force pushes, no deletion, linear history.**
- **Bypass**: repository admins can bypass **through a pull request only**, so the sole maintainer can
  merge their own PR (nobody else can approve it) without ever pushing to `main` directly.
- Repository settings: squash merge only, branches deleted after merge, auto-merge allowed, sign-off
  required on web commits, private vulnerability reporting, secret scanning with push protection,
  Dependabot security updates, and approval required before workflows run on PRs from first-time
  contributors. The default workflow token is read-only.

Workflow rules: every workflow declares least-privilege `permissions:`, third-party actions are pinned
to a full commit SHA with a version comment (Dependabot updates them weekly), checkouts use
`persist-credentials: false`, and **`pull_request_target` is not used** with PR code. Keep it that way.
Review `.github/**` changes with extra care: they are the keys to the release pipeline.

The [OpenSSF Scorecard](https://securityscorecards.dev/) workflow grades all of this weekly.

## Triage

Every new issue starts as `needs-triage`. Aim to look at it within a week: reproduce, ask for missing
detail, then swap `needs-triage` for the right labels. Vulnerability reports arrive privately through
Security Advisories and are handled by the timeline in [SECURITY.md](../SECURITY.md); if one shows up as
a public issue, remove the sensitive details, ask the reporter to use private reporting, and label it `security`.

| Label | Meaning |
|---|---|
| `needs-triage` | New. A maintainer hasn't looked yet. Remove once handled |
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |
| `integration` | New ad platform, revenue source or connector |
| `docs` | Documentation only |
| `security` | Security-related; never carries exploit details. Vulnerabilities go through private reporting |
| `good first issue` | Small, well-scoped, clear acceptance criteria. Add a pointer to the relevant files |
| `help wanted` | We'd welcome a contribution and it isn't a beginner task |

Close stale questions politely, point support questions to Discussions, and decline out-of-scope
requests kindly with a reason (see the non-negotiables in CONTRIBUTING.md).

## Reviewing pull requests

- Small and focused? Read the diff, run the checks you doubt, and merge when green.
- Touches auth, permissions, crypto, the database layer, migrations, workflows, the Dockerfile or
  `install.sh`? Review line by line, and check for new outbound calls and new dependencies.
- New dependency? It must be justified in the PR, fit the dependency licence policy in CONTRIBUTING.md (no GPL, AGPL, SSPL or BUSL) and pass dependency review.
- Approve the workflow run for a first-time contributor only after skimming the diff for changes to
  `.github/`, `package.json` scripts and lockfile oddities.
- Squash-merge with a conventional title. The PR title becomes the commit message.
