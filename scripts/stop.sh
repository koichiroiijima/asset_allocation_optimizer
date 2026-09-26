#!/usr/bin/env bash
# ============================================================================
# 開発サーバー（backend + frontend）を停止する。
#
#   scripts/stop.sh            # backend / frontend の両方を停止
#   scripts/stop.sh backend    # backend のみ
#   scripts/stop.sh frontend   # frontend のみ
#
# PID ファイル（.run/*.pid）があればプロセスグループごと停止し、
# 手動起動など PID ファイルが無い場合は pkill のパターンで停止する。
# ポート番号による停止は他プロジェクトを巻き込む恐れがあるため行わない。
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"

TARGET="${1:-all}"

stop_one() {
  local name="$1" pidfile="$2" pattern="$3"
  local stopped=0

  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
      stopped=1
    fi
    rm -f "$pidfile"
  fi

  if pgrep -f "$pattern" >/dev/null 2>&1; then
    pkill -TERM -f "$pattern" 2>/dev/null || true
    stopped=1
  fi

  if [[ "$stopped" == 1 ]]; then
    echo "$name を停止しました。"
  else
    echo "$name は起動していません。"
  fi
}

case "$TARGET" in
  all)
    stop_one "backend" "$RUN_DIR/backend.pid" "uvicorn app.main:app"
    stop_one "frontend" "$RUN_DIR/frontend.pid" "$ROOT/frontend/node_modules/.bin/vite"
    ;;
  backend)
    stop_one "backend" "$RUN_DIR/backend.pid" "uvicorn app.main:app"
    ;;
  frontend)
    stop_one "frontend" "$RUN_DIR/frontend.pid" "$ROOT/frontend/node_modules/.bin/vite"
    ;;
  *)
    echo "使い方: scripts/stop.sh [all|backend|frontend]" >&2
    exit 2
    ;;
esac
