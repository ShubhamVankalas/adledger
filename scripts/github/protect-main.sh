#!/usr/bin/env bash
# Locks down the AdLedger GitHub repository the way docs/MAINTAINERS.md describes:
# a branch ruleset on the default branch, repository security and merge settings, Actions
# permissions for fork PRs, and the triage labels.
#
# This is a BASH script. On Windows, run it from Git Bash (not PowerShell or cmd):
#     bash scripts/github/protect-main.sh
# From PowerShell you can still call it through Git Bash:
#     & "C:\Program Files\Git\bin\bash.exe" scripts/github/protect-main.sh
#
# Requirements: the GitHub CLI (`gh`), signed in as a repository ADMIN (`gh auth login`).
# Run it once the repository is public (private repos on the free plan can't use rulesets,
# secret scanning or code scanning). It is idempotent: run it again any time to re-apply.
#
# Usage:
#   scripts/github/protect-main.sh                 # repo taken from the current clone
#   scripts/github/protect-main.sh --repo owner/name
#   scripts/github/protect-main.sh --dry-run       # print every change, apply nothing
#
# Environment:
#   FORK_APPROVAL   first_time_contributors (default) | all_external_contributors
#                   | first_time_contributors_new_to_github
#
# Every step reports OK or FAILED; a failed step never stops the others, and the script exits
# non-zero at the end if anything failed so you can fix it (or do it by hand) and re-run.

set -uo pipefail
export MSYS_NO_PATHCONV=1   # keep Git Bash from rewriting API paths

REPO=""
DRY_RUN=0
FORK_APPROVAL="${FORK_APPROVAL:-first_time_contributors}"
RULESET_NAME="Protect main"

# Job names from .github/workflows/ci.yml and pr-hygiene.yml (a check's name is its job id
# unless the job sets `name:`). Keep in sync when a job is renamed.
REQUIRED_CHECKS=(supply-chain check e2e postgres docker dco title)
# Admins (the owner) can push to main directly ("always"); set BYPASS_MODE=pull_request to make them go through PRs too.
BYPASS_MODE="${BYPASS_MODE:-always}"

# GitHub Actions app id: pins each required check to checks reported by Actions, so another
# app can't satisfy a check by posting a status with the same name.
GITHUB_ACTIONS_APP_ID=15368
# Repository role id of "Admin" for ruleset bypass actors.
ADMIN_ROLE_ID=5

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="${2:?--repo needs owner/name}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,29p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

command -v gh >/dev/null 2>&1 || { echo "The GitHub CLI (gh) is required: https://cli.github.com" >&2; exit 1; }

if [ -z "$REPO" ]; then
  REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
fi
[ -n "$REPO" ] || { echo "Could not work out the repository. Pass --repo owner/name." >&2; exit 1; }

FAILURES=0
MANUAL=()

say()  { printf '\n== %s\n' "$*"; }
ok()   { printf '   OK      %s\n' "$*"; }
fail() { printf '   FAILED  %s\n' "$*"; FAILURES=$((FAILURES + 1)); }
dry()  { printf '   DRY RUN %s\n' "$*"; }

# gh_call <description> <method> <path> [json-body]
gh_call() {
  local desc="$1" method="$2" path="$3" body="${4:-}"
  if [ "$DRY_RUN" -eq 1 ]; then
    dry "$method $path  ($desc)"
    [ -n "$body" ] && printf '%s\n' "$body" | sed 's/^/           /'
    return 0
  fi
  local out
  if [ -n "$body" ]; then
    out="$(printf '%s' "$body" | gh api -X "$method" "$path" --input - 2>&1)"
  else
    out="$(gh api -X "$method" "$path" 2>&1)"
  fi
  local rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "$desc"
    return 0
  fi
  fail "$desc"
  printf '%s\n' "$out" | head -n 3 | sed 's/^/           /'
  return 1
}

echo "Repository: $REPO"
[ "$DRY_RUN" -eq 1 ] && echo "Mode: dry run (nothing is changed)"

if [ "$DRY_RUN" -eq 0 ]; then
  gh auth status >/dev/null 2>&1 || { echo "Not signed in. Run: gh auth login" >&2; exit 1; }
  perm="$(gh api "repos/$REPO" --jq '.permissions.admin' 2>/dev/null || echo false)"
  [ "$perm" = "true" ] || { echo "You need admin rights on $REPO to run this." >&2; exit 1; }
  branch="$(gh api "repos/$REPO" --jq .default_branch)"
else
  branch="main"
fi
echo "Default branch: $branch"

# ---------------------------------------------------------------- repository settings
say "Merge settings (squash only, tidy branches, sign-off on web commits)"
gh_call "merge settings" PATCH "repos/$REPO" '{
  "allow_merge_commit": false,
  "allow_squash_merge": true,
  "allow_rebase_merge": false,
  "allow_auto_merge": true,
  "allow_update_branch": true,
  "delete_branch_on_merge": true,
  "web_commit_signoff_required": true,
  "squash_merge_commit_title": "PR_TITLE",
  "squash_merge_commit_message": "PR_BODY"
}'

say "Security features"
gh_call "private vulnerability reporting" PUT "repos/$REPO/private-vulnerability-reporting"
gh_call "Dependabot alerts" PUT "repos/$REPO/vulnerability-alerts"
gh_call "Dependabot security updates" PUT "repos/$REPO/automated-security-fixes"
gh_call "secret scanning" PATCH "repos/$REPO" '{"security_and_analysis":{"secret_scanning":{"status":"enabled"}}}'
gh_call "secret scanning push protection" PATCH "repos/$REPO" '{"security_and_analysis":{"secret_scanning_push_protection":{"status":"enabled"}}}'

# ---------------------------------------------------------------- Actions permissions
say "Actions: fork pull requests and default token"
if ! gh_call "require approval to run workflows for fork PRs ($FORK_APPROVAL)" PUT \
  "repos/$REPO/actions/permissions/fork-pr-contributor-approval" \
  "{\"approval_policy\":\"$FORK_APPROVAL\"}"; then
  MANUAL+=("Settings -> Actions -> General -> Fork pull request workflows from outside collaborators: choose \"Require approval for first-time contributors\" (or stricter), then Save.")
fi
if ! gh_call "workflow token is read-only by default, and can't approve PRs" PUT \
  "repos/$REPO/actions/permissions/workflow" \
  '{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}'; then
  MANUAL+=("Settings -> Actions -> General -> Workflow permissions: \"Read repository contents and packages permissions\", and untick \"Allow GitHub Actions to create and approve pull requests\".")
fi

# ---------------------------------------------------------------- ruleset
say "Ruleset \"$RULESET_NAME\" on the default branch"
checks_json=""
for c in "${REQUIRED_CHECKS[@]}"; do
  checks_json="${checks_json}${checks_json:+,}{\"context\":\"$c\",\"integration_id\":$GITHUB_ACTIONS_APP_ID}"
done
echo "   Required checks: ${REQUIRED_CHECKS[*]}"

ruleset_body="$(cat <<EOF
{
  "name": "$RULESET_NAME",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": $ADMIN_ROLE_ID, "actor_type": "RepositoryRole", "bypass_mode": "$BYPASS_MODE" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": true,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [ $checks_json ]
      }
    }
  ]
}
EOF
)"

existing_id=""
if [ "$DRY_RUN" -eq 0 ]; then
  existing_id="$(gh api "repos/$REPO/rulesets" --jq ".[] | select(.name == \"$RULESET_NAME\") | .id" 2>/dev/null | head -n 1)"
fi
if [ -n "$existing_id" ]; then
  echo "   Found existing ruleset #$existing_id: updating it"
  gh_call "ruleset updated" PUT "repos/$REPO/rulesets/$existing_id" "$ruleset_body" \
    || MANUAL+=("Settings -> Rules -> Rulesets -> \"$RULESET_NAME\": review it by hand (see docs/MAINTAINERS.md).")
else
  gh_call "ruleset created" POST "repos/$REPO/rulesets" "$ruleset_body" \
    || MANUAL+=("Settings -> Rules -> Rulesets -> New branch ruleset. Rules are listed in docs/MAINTAINERS.md (branch protection policy). Rulesets need a public repository on the free plan.")
fi

# ---------------------------------------------------------------- labels
say "Labels"
make_label() { # name color description
  if [ "$DRY_RUN" -eq 1 ]; then
    dry "label \"$1\" ($2) $3"
    return 0
  fi
  if gh label create "$1" --repo "$REPO" --color "$2" --description "$3" --force >/dev/null 2>&1; then
    ok "label \"$1\""
  else
    fail "label \"$1\""
  fi
}
make_label "good first issue" "7057ff" "Small, well-scoped, a good place to start"
make_label "help wanted"      "008672" "Maintainers would welcome a contribution"
make_label "bug"              "d73a4a" "Something is broken"
make_label "enhancement"      "a2eeef" "New feature or improvement"
make_label "integration"      "1d76db" "New ad platform, revenue source or connector"
make_label "security"         "b60205" "Security-related (vulnerabilities go through private reporting)"
make_label "docs"             "0075ca" "Documentation only"
make_label "needs-triage"     "fbca04" "New; a maintainer has not looked at it yet"

# ---------------------------------------------------------------- summary
say "Summary"
if [ "${#MANUAL[@]}" -gt 0 ]; then
  echo "Manual steps still to do:"
  for m in "${MANUAL[@]}"; do echo "  - $m"; done
fi
echo "Also check by hand (no API for these):"
echo "  - Settings -> Code security: \"Private vulnerability reporting\" shows as Enabled."
echo "  - Settings -> Pages: Source is \"GitHub Actions\" (for the website workflow)."
echo "  - Discussions are turned on (Settings -> General -> Features), the issue template links point at them."

if [ "$FAILURES" -gt 0 ]; then
  echo
  echo "$FAILURES step(s) failed. Fix the cause (usually: not public yet, or missing admin rights) and run again."
  exit 1
fi
echo
echo "Done."
