#!/usr/bin/env sh
# Run a self-contained local PingStep functional demo. No credentials or external services required.
set -eu

PORT="${PINGSTEP_DEMO_PORT:-3000}"
RUN_SECONDS="${PINGSTEP_DEMO_RUN_SECONDS:-60}"
JOB_KEY="${PINGSTEP_DEMO_JOB_KEY:-laptop-sim}"
DEMO_DIR="${TMPDIR:-/tmp}/pingstep-demo-$$"
TOKEN="pingstep-demo-$(node -e 'console.log(require("crypto").randomBytes(18).toString("hex"))')"
TOKEN_HASH="$(npm run --silent hash-token -- "$TOKEN")"

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$DEMO_DIR"
}
trap cleanup EXIT INT TERM
mkdir -p "$DEMO_DIR"

export PINGSTEP_DATA_FILE="$DEMO_DIR/pingstep.json"
export PINGSTEP_JOB_TOKEN_HASHES_JSON="{\"$JOB_KEY\":\"$TOKEN_HASH\"}"
export PINGSTEP_JOB_CONFIG_JSON="{\"$JOB_KEY\":{\"expected_update_interval_seconds\":600,\"expected_duration_seconds\":$RUN_SECONDS,\"late_grace_seconds\":0}}"
export PINGSTEP_URL="http://localhost:$PORT"
export PINGSTEP_TOKEN="$TOKEN"

PORT="$PORT" npm start >"$DEMO_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "$PINGSTEP_URL/health" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -fsS "$PINGSTEP_URL/health" >/dev/null 2>&1; then
  cat "$DEMO_DIR/server.log" >&2
  exit 1
fi

echo "PingStep dashboard: $PINGSTEP_URL"
echo "Running $RUN_SECONDS-second local simulation for $JOB_KEY..."
python3 examples/simulate_statuses.py --job-key "$JOB_KEY" --run-seconds "$RUN_SECONDS"
echo "\nFinal run state:"
curl -fsS "$PINGSTEP_URL/v1/runs"
