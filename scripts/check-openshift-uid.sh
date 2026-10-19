#!/usr/bin/env bash
#
# Fails when the web image cannot do its startup writes as an arbitrary UID.
#
# OpenShift's default restricted-v2 SCC ignores the image USER and runs the
# container as a random UID from the namespace range with GID 0 supplementary
# and no passwd entry. apps/web/scripts/start-server.js writes twice at
# startup — __env.js into public/, and the patched CSP into
# .next/routes-manifest.json — and both are warnings, not errors: the server
# starts anyway, serves a working page, and silently keeps the build-time CSP.
# So nothing fails loudly when this regresses. Hence this check.
#
# Usage: scripts/check-openshift-uid.sh [image-ref]
#
# Requires a local docker daemon and an image that is already built/loaded.

set -euo pipefail

IMAGE="${1:-perfana-web:ocp-check}"
TEST_UID="${OPENSHIFT_TEST_UID:-1000680000}"
CONTAINER="ocp-uid-check-$$"
TIMEOUT_S="${OPENSHIFT_CHECK_TIMEOUT:-60}"

# Both are required: without them start-server.js skips the CSP patch entirely
# ("No CSP runtime env vars set") and the check would pass without writing.
API_URL="https://api.example.invalid/api"
FRAME_SRC="https://grafana.example.invalid"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Running $IMAGE as UID $TEST_UID with GID 0, all caps dropped"
docker run -d --name "$CONTAINER" \
    --user "$TEST_UID:0" \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    -e NEXT_PUBLIC_API_URL="$API_URL" \
    -e NEXT_PUBLIC_CSP_FRAME_SRC="$FRAME_SRC" \
    "$IMAGE" >/dev/null

# Wait for the server to come up; the writes both happen before it listens.
deadline=$((SECONDS + TIMEOUT_S))
while [ "$SECONDS" -lt "$deadline" ]; do
    if docker logs "$CONTAINER" 2>&1 | grep -q "Ready in"; then break; fi
    if [ -z "$(docker ps -q -f name="$CONTAINER")" ]; then
        echo "FAIL: container exited before the server was ready" >&2
        docker logs "$CONTAINER" 2>&1 | tail -40 >&2
        exit 1
    fi
    sleep 1
done

logs=$(docker logs "$CONTAINER" 2>&1)
echo "$logs"
echo "----------------------------------------"

failed=0

# 1. Neither write may fail. EACCES is what an arbitrary UID gets on a file
#    owned nonroot:nonroot without the group bit.
if printf '%s\n' "$logs" | grep -qE "EACCES|Could not write"; then
    echo "FAIL: a startup write was refused as UID $TEST_UID" >&2
    printf '%s\n' "$logs" | grep -E "EACCES|Could not write" >&2
    failed=1
fi

# 2. Both writes must actually have happened. Absence of a warning is not
#    evidence: a skipped CSP patch, a moved manifest or a start-server.js that
#    stops writing at all would also produce no warning.
if ! printf '%s\n' "$logs" | grep -qE "^\[env-config\] Generated .*apps/web/public/__env\.js"; then
    echo "FAIL: __env.js was never written under apps/web/public" >&2
    failed=1
fi
if ! printf '%s\n' "$logs" | grep -qE "^\[csp-patch\] Updated .*\.next/routes-manifest\.json"; then
    echo "FAIL: routes-manifest.json was never patched" >&2
    failed=1
fi

# 3. And the patch must have carried the runtime value, not the build-time one.
if ! printf '%s\n' "$logs" | grep -qF "frame-src → 'self' blob: $FRAME_SRC"; then
    echo "FAIL: the patched frame-src does not carry the runtime value" >&2
    failed=1
fi

if [ "$failed" -ne 0 ]; then
    echo "" >&2
    echo "The image cannot run under OpenShift's restricted-v2 SCC." >&2
    echo "Fix: the paths start-server.js writes need group 0 with the owner's" >&2
    echo "bits — 'chmod -R g=u' in the builder stage and '--chown=<user>:0' on" >&2
    echo "the runtime COPY. See Dockerfile, stage 5 and stage 7." >&2
    exit 1
fi

echo "PASS: both startup writes succeeded as UID $TEST_UID with GID 0"
