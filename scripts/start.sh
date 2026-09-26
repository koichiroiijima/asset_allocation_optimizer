#!/usr/bin/env bash
# ============================================================================
# 開発サーバー（backend + frontend）をバックグラウンドで並列起動する。
# 停止は scripts/stop.sh（make stop）で行う。
#
#   backend : FastAPI / Uvicorn（既定ポート 8000, --reload）
#   frontend: Vite dev server（既定ポート 5173, /api を backend へプロキシ）
#
# ログ: logs/{backend,frontend}.log / PID: .run/{backend,frontend}.pid
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT="${ASSET_ALLOC__APP_PORT:-${PORT:-8000}}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
RUN_DIR="$ROOT/.run"
LOG_DIR="$ROOT/logs"
mkdir -p "$RUN_DIR" "$LOG_DIR"

is_running() {
  local pidfile="$1"
  [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null
}

if is_running "$RUN_DIR/backend.pid" || is_running "$RUN_DIR/frontend.pid"; then
  echo "既に起動しています。先に 'make stop' を実行してください。" >&2
  exit 1
fi

# backend 起動（setsid で独立したプロセスグループにし、停止時に子プロセスごと止める）
setsid bash -c 'cd "$1" && exec uv run uvicorn app.main:app --reload --port "$2"' \
  _ "$ROOT/backend" "$BACKEND_PORT" >"$LOG_DIR/backend.log" 2>&1 &
echo "$!" > "$RUN_DIR/backend.pid"

# frontend 起動
setsid bash -c 'cd "$1" && exec npm run dev -- --port "$2"' \
  _ "$ROOT/frontend" "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 &
echo "$!" > "$RUN_DIR/frontend.pid"

sleep 2

# Vite は指定ポートが使用中だと自動で別ポートへ移るため、実際の URL をログから拾う
frontend_url="$(grep -oE 'http://localhost:[0-9]+/' "$LOG_DIR/frontend.log" | tail -1 || true)"
[[ -z "$frontend_url" ]] && frontend_url="http://localhost:$FRONTEND_PORT/"

echo "backend : http://localhost:$BACKEND_PORT  (PID $(cat "$RUN_DIR/backend.pid") / log: logs/backend.log)"
echo "frontend: $frontend_url  (PID $(cat "$RUN_DIR/frontend.pid") / log: logs/frontend.log)"
echo "停止    : make stop"
