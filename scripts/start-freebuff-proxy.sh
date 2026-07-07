#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${1:-${TMPDIR:-/tmp}/bahai-agent}"

FREEBUFF_AUTO_START="${FREEBUFF_AUTO_START:-true}"
FREEBUFF_BASE_URL="${FREEBUFF_BASE_URL:-http://127.0.0.1:8080/v1}"
FREEBUFF_HEALTH_URL="${FREEBUFF_HEALTH_URL:-${FREEBUFF_BASE_URL%/}/models}"
FREEBUFF_START_CMD="${FREEBUFF_START_CMD:-}"
FREEBUFF_LOG_FILE="${FREEBUFF_LOG_FILE:-$LOG_DIR/freebuff.log}"
FREEBUFF_PID_FILE="${FREEBUFF_PID_FILE:-$LOG_DIR/freebuff.pid}"

mkdir -p "$LOG_DIR"

log() {
  printf '[freebuff] %s\n' "$1"
}

is_truthy() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

healthcheck() {
  curl -fsS --max-time 2 "$FREEBUFF_HEALTH_URL" >/dev/null 2>&1
}

already_running() {
  if [ -f "$FREEBUFF_PID_FILE" ]; then
    local pid
    pid="$(cat "$FREEBUFF_PID_FILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if ! is_truthy "$FREEBUFF_AUTO_START"; then
  log "Auto-start söndürülüb."
  exit 0
fi

if healthcheck; then
  log "Proxy artıq işləyir: $FREEBUFF_BASE_URL"
  exit 0
fi

if already_running; then
  log "Mövcud proses tapıldı, healthcheck yenidən gözlənilir..."
  for _ in {1..20}; do
    if healthcheck; then
      log "Proxy hazır oldu: $FREEBUFF_BASE_URL"
      exit 0
    fi
    sleep 0.5
  done
fi

if [ -z "$FREEBUFF_START_CMD" ]; then
  log "Start command verilməyib. Skip edilir. FREEBUFF_START_CMD təyin et."
  exit 0
fi

log "Proxy başladılır..."
(
  cd "$ROOT_DIR"
  nohup sh -lc "$FREEBUFF_START_CMD" >> "$FREEBUFF_LOG_FILE" 2>&1 &
  echo $! > "$FREEBUFF_PID_FILE"
)

for _ in {1..30}; do
  if healthcheck; then
    log "Proxy hazırdır: $FREEBUFF_BASE_URL"
    exit 0
  fi
  sleep 0.5
done

log "Proxy start edildi, amma healthcheck hələ keçmədi. Log: $FREEBUFF_LOG_FILE"
exit 0
