#!/usr/bin/env bash
#
# Run the given spec files with the test script of the workspace that owns them.
#
# This is `runner` in .gstack/pregate.json. Without it, gstack-pregate's runner detection
# picks `bun test`: the root package.json declares no test-runner dependency (each
# workspace owns its own) and bun is on PATH, so detection falls through to its last
# resort. Jest specs under bun fail on NestJS decorators alone — 422 of 518 on
# 2026-11-05 — which reads as a wall of in-branch failures and is noise.
#
# It delegates to `npm run test --workspace=<dir> --` rather than naming a runner, because
# the runners differ (jest in most workspaces, vitest in apps/worker) and both take
# trailing file paths. A workspace whose test script does NOT take paths is refused by
# name rather than silently mis-run: apps/mcp's is `node --test dist/*.test.js`, a fixed
# list that ignores its arguments, so routing a spec there would run two stale compiled
# tests and report an unrelated result.
#
# Paths come from gstack-pregate, which derives them from git. They are passed as a quoted
# array behind `--`, so a filename containing whitespace cannot split into an extra token
# that jest would read as an option (`--setupFiles=...`), and one starting with `-` cannot
# be read as a flag at all.
set -uo pipefail

[ "$#" -gt 0 ] || exit 0
exit_code=0

# Workspaces whose test script accepts trailing spec paths. apps/mcp is deliberately
# absent; add a workspace here only after checking its `test` script takes arguments.
PATH_TAKING_WORKSPACES="apps/api apps/grafana-sync apps/web apps/worker apps/perfana-report packages/shared"

owns() {
  case " $PATH_TAKING_WORKSPACES " in *" $1 "*) return 0 ;; *) return 1 ;; esac
}

# One pass per distinct two-segment prefix. `cut` rather than a helper function: the
# prefix IS the workspace path in this repo's layout, and `owns` is what decides whether
# it can be run, so there is nothing left for a classifier to do.
while IFS= read -r ws; do
  [ -n "$ws" ] || continue

  group=()
  for f in "$@"; do
    case "$f" in "$ws"/*) group+=("${f#"$ws"/}") ;; esac
  done

  if ! owns "$ws"; then
    echo "pregate-runner: $ws has no path-taking test script; refusing ${#group[@]} file(s)" >&2
    exit_code=1
    continue
  fi

  # Guarded because bash 3.2 (macOS /bin/bash) treats a bare "${g[@]}" on an EMPTY array
  # as an unbound variable under `set -u`. Unreachable today — $ws comes from the file
  # list, so at least one file carries it — but one refactor away from being reachable.
  [ "${#group[@]}" -gt 0 ] || continue

  echo "pregate-runner: $ws -> ${group[*]}"
  npm run --silent test --workspace="$ws" -- "${group[@]}" || exit_code=1
done <<EOF
$(printf '%s\n' "$@" | cut -d/ -f1-2 | sort -u)
EOF

exit "$exit_code"
