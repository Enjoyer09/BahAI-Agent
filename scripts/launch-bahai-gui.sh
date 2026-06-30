#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

BACKEND_PORT="${PORT:-3001}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
CDP_PORT="${GUI_BROWSER_DEBUG_PORT:-9222}"
CHROME_PROFILE="${GUI_BROWSER_USER_DATA_DIR:-$HOME/.bahai/chrome-debug-profile}"
LOG_DIR="${TMPDIR:-/tmp}/bahai-agent"

mkdir -p "$LOG_DIR"

cleanup_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Port $port istifadədədir. Köhnə proseslər dayandırılır..."
    kill $pids 2>/dev/null || true
    sleep 1
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [ -n "$pids" ]; then
      kill -9 $pids 2>/dev/null || true
    fi
  fi
}

cleanup_stale_processes() {
  echo "Köhnə bahAI Desktop prosesləri yoxlanılır..."
  pkill -f "electron.*BahAI-Agent/electron" 2>/dev/null || true
  pkill -f "node backend/index.js" 2>/dev/null || true
  pkill -f "vite.*--port $FRONTEND_PORT" 2>/dev/null || true
  sleep 1
}

ensure_deps() {
  if [ ! -d "./node_modules" ]; then npm install; fi
  if [ ! -d "./backend/node_modules" ]; then npm install --prefix backend; fi
  if [ ! -d "./frontend/node_modules" ]; then npm install --prefix frontend; fi
  if [ ! -d "./electron/node_modules" ]; then npm install --prefix electron; fi
}

echo "bahAI Desktop detached rejimdə başladılır..."
echo "Log qovluğu: $LOG_DIR"

ensure_deps
cleanup_stale_processes
cleanup_port "$BACKEND_PORT"
cleanup_port "$FRONTEND_PORT"

GUI_BROWSER_CDP_URL="http://127.0.0.1:$CDP_PORT" \
GUI_BROWSER_PERSISTENT=true \
GUI_BROWSER_VISIBLE=true \
GUI_BROWSER_SLOW_MO_MS=700 \
LOCAL_MODE=true \
PORT="$BACKEND_PORT" \
  nohup npm start > "$LOG_DIR/backend.log" 2>&1 &

nohup npm run dev --prefix frontend -- --host 127.0.0.1 --port "$FRONTEND_PORT" \
  > "$LOG_DIR/frontend.log" 2>&1 &

echo "Serverlərin qalxması gözlənilir..."
for _ in {1..40}; do
  if curl -fsS "http://localhost:$BACKEND_PORT/api/auth/config" >/dev/null 2>&1 &&
     curl -fsS "http://localhost:$FRONTEND_PORT" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

(cd electron && nohup npx electron . --dev > "$LOG_DIR/electron.log" 2>&1 &)

echo "bahAI Desktop açılır."
echo "Backend:  http://localhost:$BACKEND_PORT"
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "CDP:      http://127.0.0.1:$CDP_PORT"
echo "Loglar:   $LOG_DIR"
echo "Qeyd: Chrome yalnız GUI browser tələb olunanda başladılacaq."
echo ""
echo "Bu terminali bağlaya bilərsən; proseslər arxa planda qalacaq."
