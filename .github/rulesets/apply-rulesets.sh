#!/usr/bin/env bash
#
# Apply the "Protect main" branch ruleset to the GitHub repository.
#
# Prerequisites:
#   - The repo must be PUBLIC (or on a GitHub Pro/Team/Enterprise plan).
#     Rulesets on private repos require a paid plan; on a free public repo
#     they are available at no cost.
#   - `gh` CLI authenticated with admin rights on the repo.
#
# Usage:
#   .github/rulesets/apply-rulesets.sh                 # targets perfana/perfana
#   REPO=owner/name .github/rulesets/apply-rulesets.sh # override target
#
# Idempotent: creates the ruleset if absent, otherwise updates it in place.

set -euo pipefail

REPO="${REPO:-perfana/perfana}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULESET_JSON="${SCRIPT_DIR}/main-branch-protection.json"
RULESET_NAME="$(jq -r '.name' "${RULESET_JSON}")"

echo "▶ Target repo:    ${REPO}"
echo "▶ Ruleset:        ${RULESET_NAME}"
echo "▶ Definition:     ${RULESET_JSON}"
echo

# --- Sanity: repo visibility ------------------------------------------------
VISIBILITY="$(gh repo view "${REPO}" --json visibility --jq '.visibility' 2>/dev/null || echo UNKNOWN)"
echo "▶ Visibility:     ${VISIBILITY}"
if [ "${VISIBILITY}" = "PRIVATE" ]; then
  echo
  echo "⚠  Repo is PRIVATE. Rulesets require a paid plan on private repos."
  echo "   Make the repo public first, or run on a Pro/Team/Enterprise plan."
  echo "   Continuing anyway — the API call will fail with 403 if unsupported."
  echo
fi

# --- Create or update -------------------------------------------------------
EXISTING_ID="$(gh api "repos/${REPO}/rulesets" --jq \
  ".[] | select(.name == \"${RULESET_NAME}\") | .id" 2>/dev/null | head -n1 || true)"

if [ -n "${EXISTING_ID}" ]; then
  echo "▶ Updating existing ruleset (id=${EXISTING_ID})…"
  gh api --method PUT "repos/${REPO}/rulesets/${EXISTING_ID}" \
    --input "${RULESET_JSON}" >/dev/null
  echo "✓ Updated ruleset '${RULESET_NAME}'."
else
  echo "▶ Creating ruleset…"
  gh api --method POST "repos/${REPO}/rulesets" \
    --input "${RULESET_JSON}" >/dev/null
  echo "✓ Created ruleset '${RULESET_NAME}'."
fi

echo
echo "Done. Review it at: https://github.com/${REPO}/settings/rules"
