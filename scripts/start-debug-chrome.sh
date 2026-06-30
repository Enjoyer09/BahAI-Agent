#!/usr/bin/env bash
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PROFILE_DIR="${GUI_BROWSER_USER_DATA_DIR:-$HOME/.bahai/chrome-debug-profile}"
PORT="${GUI_BROWSER_DEBUG_PORT:-9222}"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome not found at: $CHROME" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

echo "Starting Google Chrome with remote debugging..."
echo "Profile: $PROFILE_DIR"
echo "CDP URL: http://127.0.0.1:$PORT"

"$CHROME" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "https://www.wix.com" >/dev/null 2>&1 &

echo "Chrome started. Use GUI_BROWSER_CDP_URL=http://127.0.0.1:$PORT in BahAI to attach."
