#!/usr/bin/env sh
# Show Active, Stale, Succeeded, and Failed rows together without manual testing.
set -eu
PORT="${PINGSTEP_DEMO_PORT:-3000}"
DIR="${TMPDIR:-/tmp}/pingstep-gallery-$$"
TOKEN="pingstep-gallery-$(node -e 'console.log(require("crypto").randomBytes(18).toString("hex"))')"
HASH="$(npm run --silent hash-token -- "$TOKEN")"
cleanup() { [ -z "${SERVER_PID:-}" ] || kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$DIR"; }
trap cleanup EXIT INT TERM
mkdir -p "$DIR"
export PINGSTEP_DATA_FILE="$DIR/state.json"
export PINGSTEP_URL="http://localhost:$PORT"
export PINGSTEP_TOKEN="$TOKEN"
export PINGSTEP_EVALUATOR_INTERVAL_MS=1000
export PINGSTEP_JOB_TOKEN_HASHES_JSON="{\"gallery-active\":\"$HASH\",\"gallery-stale\":\"$HASH\",\"gallery-succeeded\":\"$HASH\",\"gallery-failed\":\"$HASH\"}"
export PINGSTEP_JOB_CONFIG_JSON='{"gallery-active":{"expected_update_interval_seconds":600},"gallery-stale":{"expected_update_interval_seconds":6,"liveness_grace_seconds":1},"gallery-succeeded":{"expected_update_interval_seconds":600},"gallery-failed":{"expected_update_interval_seconds":600}}'
PORT="$PORT" npm start >"$DIR/server.log" 2>&1 & SERVER_PID=$!
for _ in 1 2 3 4 5; do curl -fsS "$PINGSTEP_URL/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "$PINGSTEP_URL/health" >/dev/null
echo "Open $PINGSTEP_URL now — all four rows appear within about 20 seconds."
python3 examples/simulate_statuses.py --job-key gallery-active --run-seconds 12 --outcome active & A=$!
python3 examples/simulate_statuses.py --job-key gallery-stale --run-seconds 12 --progress-seconds 1 --outcome stale & B=$!
python3 examples/simulate_statuses.py --job-key gallery-succeeded --run-seconds 12 --outcome complete & C=$!
python3 examples/simulate_statuses.py --job-key gallery-failed --run-seconds 12 --outcome error & D=$!
wait "$A"; wait "$B"; wait "$C"; wait "$D"; sleep 8
echo "\nExpected final rows: active=running, stale=stale, succeeded=succeeded, failed=failed"
curl -fsS "$PINGSTEP_URL/v1/runs"
