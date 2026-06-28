#!/bin/bash
# Wrapper that records the screen for as long as a target process is
# alive, then stops cleanly via SIGINT (so screencapture finalises the
# file). Replaces the time-bounded "screencapture -v -V SECONDS"
# pattern which often truncated runs that took longer than expected.
#
# Usage:
#   scripts/record-while-running.sh <output.mov> <process-name-pattern>
# Example:
#   scripts/record-while-running.sh ~/Desktop/x.mov fullRecordedRun
set -euo pipefail

OUTPUT="${1:?usage: $0 <output.mov> <process-pattern>}"
PATTERN="${2:?usage: $0 <output.mov> <process-pattern>}"

rm -f "$OUTPUT"
echo "==> starting screencapture (process-bound)"
echo "    output : $OUTPUT"
echo "    pattern: $PATTERN"
screencapture -v "$OUTPUT" &
REC_PID=$!
trap "kill -INT $REC_PID 2>/dev/null; wait $REC_PID 2>/dev/null" EXIT INT TERM

sleep 2
echo "    recorder pid=$REC_PID"

# Wait for the target process to START (max 60s).
WAITED=0
while ! pgrep -f "$PATTERN" >/dev/null; do
  sleep 1
  WAITED=$((WAITED + 1))
  if [ "$WAITED" -gt 60 ]; then
    echo "    !! target process never started after 60s"
    break
  fi
done
[ "$WAITED" -le 60 ] && echo "    target started after ${WAITED}s"

# Wait for the target process to finish (poll every 5s, no upper bound).
echo "==> waiting for target to finish..."
LAST_HEARTBEAT=$(date +%s)
while pgrep -f "$PATTERN" >/dev/null; do
  sleep 5
  NOW=$(date +%s)
  if [ "$((NOW - LAST_HEARTBEAT))" -gt 60 ]; then
    ELAPSED=$((NOW - LAST_HEARTBEAT))
    echo "    still running... ($((ELAPSED))s since last heartbeat)"
    LAST_HEARTBEAT=$NOW
  fi
done

echo "==> target finished. stopping recorder."
kill -INT $REC_PID 2>/dev/null || true
wait $REC_PID 2>/dev/null || true
trap - EXIT INT TERM

ls -la "$OUTPUT"
echo "==> done"
