#!/usr/bin/env bash
# ============================================================================
# 開発サーバー（backend + frontend）をバックグラウンドで並列起動する。
# 停止は scripts/stop.sh（make stop）で行う。
#
#   backend : FastAPI / Uvicorn（既定ポート 8000, --reload）
#   frontend: Vite dev server（既定ポート 5173, /api を backend へプロキシ）
#
# ログ: logs/{backend,frontend}.log / PID: .run/{backend,frontend}.pid
#
# 起動前に対象ポートの空きを確認し、起動後に HTTP 応答を実際に検証する。
# どちらかに失敗した場合は、起動済みプロセスを停止して非ゼロで終了する。
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT="${ASSET_ALLOC__APP_PORT:-${PORT:-8000}}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
RUN_DIR="$ROOT/.run"
LOG_DIR="$ROOT/logs"
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
HEALTH_URL="$BACKEND_URL/api/health"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT/"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-30}" # 秒
mkdir -p "$RUN_DIR" "$LOG_DIR"

pid_alive() {
  [[ -f "$1" ]] && kill -0 "$(cat "$1" 2>/dev/null)" 2>/dev/null
}

# 指定ポートを LISTEN している PID を空白区切りで返す（未使用なら空）。
# localhost ではなく 127.0.0.1 を使う（IPv6 ::1 への誤接続・ハングを避ける）。
port_pids() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | tr '\n' ' ' || true
  fi
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 || command -v fuser >/dev/null 2>&1; then
    [[ -n "$(port_pids "$port")" ]]
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -qE "[:.]$port[[:space:]]"
  else
    false
  fi
}

require_free_port() {
  local name="$1" port="$2"
  if ! port_in_use "$port"; then
    return 0
  fi
  local pids
  pids="$(port_pids "$port")"
  pids="$(echo $pids)" # 余分な空白を畳む
  echo "[start] エラー: ${name} のポート ${port} は既に使用中です${pids:+ (PID: ${pids// /, })}。" >&2
  echo "        'make stop' で停止するか、別ポートを指定してください。" >&2
  echo "        backend: ASSET_ALLOC__APP_PORT=<port> / frontend: FRONTEND_PORT=<port>" >&2
  exit 1
}

# 既にこのスクリプトが起動したプロセスが生きていれば二重起動を避ける。
if pid_alive "$RUN_DIR/backend.pid" || pid_alive "$RUN_DIR/frontend.pid"; then
  echo "既に起動しています。先に 'make stop' を実行してください。" >&2
  exit 1
fi

# 起動前に対象ポートが空いていることを確認する。
require_free_port "backend" "$BACKEND_PORT"
require_free_port "frontend" "$FRONTEND_PORT"

cleanup_started() {
  echo "[start] 起動済みプロセスを停止します。" >&2
  "$ROOT/scripts/stop.sh" >/dev/null 2>&1 || true
}

# backend 起動（setsid で独立したプロセスグループにし、停止時に子プロセスごと止める）
setsid bash -c 'cd "$1" && exec uv run uvicorn app.main:app --reload --port "$2"' \
  _ "$ROOT/backend" "$BACKEND_PORT" >"$LOG_DIR/backend.log" 2>&1 &
echo "$!" > "$RUN_DIR/backend.pid"

# frontend 起動
setsid bash -c 'cd "$1" && exec npm run dev -- --port "$2"' \
  _ "$ROOT/frontend" "$FRONTEND_PORT" >"$LOG_DIR/frontend.log" 2>&1 &
echo "$!" > "$RUN_DIR/frontend.pid"

# URL が 200 を返すまでポーリングする（curl が無ければ python3 で代替）。
http_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fs -o /dev/null --max-time 2 "$url" 2>/dev/null
  else
    python3 - "$url" <<'PY'
import sys, urllib.request
try:
    urllib.request.urlopen(sys.argv[1], timeout=2).read(1)
except Exception:
    sys.exit(1)
PY
  fi
}

wait_for_url() {
  local name="$1" url="$2" logfile="$3" pidfile="$4" timeout="${5:-30}"
  local deadline=$(( timeout * 2 ))
  local i=0
  while (( i < deadline )); do
    if ! kill -0 "$(cat "$pidfile" 2>/dev/null)" 2>/dev/null; then
      echo "[start] エラー: ${name} のプロセスが起動直後に終了しました。" >&2
      echo "--- ${logfile} (tail) ---" >&2
      tail -n 20 "$logfile" >&2 2>/dev/null || true
      return 1
    fi
    if http_ok "$url"; then
      return 0
    fi
    sleep 0.5
    i=$(( i + 1 ))
  done
  echo "[start] エラー: ${name} が ${timeout} 秒以内に応答しません（${url}）。" >&2
  echo "--- ${logfile} (tail) ---" >&2
  tail -n 20 "$logfile" >&2 2>/dev/null || true
  return 1
}

if ! wait_for_url "backend" "$HEALTH_URL" "$LOG_DIR/backend.log" "$RUN_DIR/backend.pid" "$STARTUP_TIMEOUT"; then
  cleanup_started
  exit 1
fi

# Vite は指定ポートが使用中だと自動で別ポートへ移るため、実際の URL をログから拾う
frontend_url="$(grep -oE 'http://localhost:[0-9]+/' "$LOG_DIR/frontend.log" | tail -1 || true)"
if [[ -z "$frontend_url" ]]; then
  frontend_url="$FRONTEND_URL"
fi
frontend_probe="${frontend_url/localhost/127.0.0.1}"

if ! wait_for_url "frontend" "$frontend_probe" "$LOG_DIR/frontend.log" "$RUN_DIR/frontend.pid" "$STARTUP_TIMEOUT"; then
  cleanup_started
  exit 1
fi

echo "backend : $BACKEND_URL  (PID $(cat "$RUN_DIR/backend.pid") / log: logs/backend.log)"
echo "frontend: $frontend_url  (PID $(cat "$RUN_DIR/frontend.pid") / log: logs/frontend.log)"
echo "停止    : make stop"
