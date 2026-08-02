#!/usr/bin/env sh
# Run a self-contained local PingStep functional demo. No credentials or external services required.
set -eu

PORT="${PINGSTEP_DEMO_PORT:-3000}"
RUN_SECONDS="${PINGSTEP_DEMO_RUN_SECONDS:-60}"
JOB_KEY="${PINGSTEP_DEMO_JOB_KEY:-laptop-sim}"
JOBS="${PINGSTEP_DEMO_JOBS:-1}"
OUTCOME="${PINGSTEP_DEMO_OUTCOME:-complete}"
DEMO_DIR="${TMPDIR:-/tmp}/pingstep-demo-$$"
TOKEN="pingstep-demo-$(node -e 'console.log(require("crypto").randomBytes(18).toString("hex"))')"
TOKEN_HASH="$(npm run --silent hash-token -- "$TOKEN")"

case "$JOBS" in
  ''|*[!0-9]*) echo "PINGSTEP_DEMO_JOBS must be a positive integer." >&2; exit 1 ;;
esac
if [ "$JOBS" -lt 1 ]; then echo "PINGSTEP_DEMO_JOBS must be at least 1." >&2; exit 1; fi

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$DEMO_DIR"
}
trap cleanup EXIT INT TERM
mkdir -p "$DEMO_DIR"

export PINGSTEP_DATA_FILE="$DEMO_DIR/pingstep.json"
TOKEN_ENTRIES=""
CONFIG_ENTRIES=""
for index in $(seq 1 "$JOBS"); do
  key="$JOB_KEY-$index"
  if [ "$JOBS" -eq 1 ]; then key="$JOB_KEY"; fi
  separator=""
  if [ "$index" -gt 1 ]; then separator=","; fi
  TOKEN_ENTRIES="$TOKEN_ENTRIES$separator\"$key\":\"$TOKEN_HASH\""
  CONFIG_ENTRIES="$CONFIG_ENTRIES$separator\"$key\":{\"expected_update_interval_seconds\":600,\"expected_duration_seconds\":$RUN_SECONDS,\"late_grace_seconds\":0}"
done
export PINGSTEP_JOB_TOKEN_HASHES_JSON="{$TOKEN_ENTRIES}"
if [ "$OUTCOME" = "stale" ]; then
  CONFIG_ENTRIES=""
  for index in $(seq 1 "$JOBS"); do
    key="$JOB_KEY-$index"; if [ "$JOBS" -eq 1 ]; then key="$JOB_KEY"; fi
    separator=""; if [ "$index" -gt 1 ]; then separator=","; fi
    CONFIG_ENTRIES="$CONFIG_ENTRIES$separator\"$key\":{\"expected_update_interval_seconds\":6,\"liveness_grace_seconds\":1}"
  done
  export PINGSTEP_EVALUATOR_INTERVAL_MS=1000
fi
export PINGSTEP_JOB_CONFIG_JSON="{$CONFIG_ENTRIES}"
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
echo "Running $JOBS parallel $RUN_SECONDS-second local simulation(s)..."
PIDS=""
for index in $(seq 1 "$JOBS"); do
  key="$JOB_KEY-$index"
  if [ "$JOBS" -eq 1 ]; then key="$JOB_KEY"; fi
  progress=3; if [ "$OUTCOME" = "stale" ]; then progress=1; fi
  python3 examples/simulate_statuses.py --job-key "$key" --run-seconds "$RUN_SECONDS" --progress-seconds "$progress" --outcome "$OUTCOME" &
  PIDS="$PIDS $!"
done
for pid in $PIDS; do wait "$pid"; done
if [ "$OUTCOME" = "stale" ]; then sleep 8; fi
echo "\nFinal run state:"
curl -fsS "$PINGSTEP_URL/v1/runs"
