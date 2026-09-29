#!/usr/bin/env bash
# Developer Certificate of Origin check.
#
# Every non-merge commit in BASE..HEAD must carry a "Signed-off-by: Name <email>" trailer whose
# email matches the commit's author or committer email. `git commit -s` adds it for you.
# Commits from bots (dependabot and friends) are exempt.
#
# Usage (run from a clone with full history):
#   scripts/github/check-dco.sh <base-ref-or-sha> [head-ref-or-sha]   # head defaults to HEAD
# On Windows, run it from Git Bash.
#
# Used by .github/workflows/pr-hygiene.yml; contributors can run it locally before pushing:
#   scripts/github/check-dco.sh origin/main

set -euo pipefail

base="${1:?usage: check-dco.sh <base> [head]}"
head="${2:-HEAD}"

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

failed=0
checked=0

while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  author_email=$(lower "$(git show -s --format='%ae' "$sha")")
  committer_email=$(lower "$(git show -s --format='%ce' "$sha")")
  subject=$(git show -s --format='%s' "$sha")

  # Bots don't sign off.
  case "$author_email" in
    *"[bot]@users.noreply.github.com") continue ;;
  esac

  checked=$((checked + 1))
  ok=0
  while IFS= read -r line; do
    email=$(printf '%s' "$line" | sed -n 's/^[Ss]igned-off-by:[[:space:]]*.*<\([^>]*\)>[[:space:]]*$/\1/p')
    [ -n "$email" ] || continue
    email=$(lower "$email")
    if [ "$email" = "$author_email" ] || [ "$email" = "$committer_email" ]; then
      ok=1
      break
    fi
  done < <(git show -s --format='%B' "$sha" | git interpret-trailers --only-trailers --unfold)

  if [ "$ok" -ne 1 ]; then
    failed=$((failed + 1))
    echo "::error title=Missing DCO sign-off::${sha:0:10} \"$subject\" has no Signed-off-by matching $author_email"
    echo "  missing sign-off: ${sha:0:10} $subject"
  fi
done < <(git rev-list --no-merges --reverse "$base..$head")

if [ "$failed" -gt 0 ]; then
  cat <<'EOF'

DCO check failed. Every commit needs a "Signed-off-by: Your Name <you@example.com>" line
whose email matches the commit's author. See CONTRIBUTING.md#sign-off-dco.

Fix the last commit:      git commit --amend -s --no-edit
Fix every commit in a PR: git rebase --signoff origin/main && git push --force-with-lease
EOF
  exit 1
fi

echo "DCO OK: $checked commit(s) signed off."
