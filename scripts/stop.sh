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
#
# SIGTERM に応答しないプロセス（環境によっては uvicorn/--reload が該当）に
# 備え、猶予後に SIGKILL へエスカレートして確実に停止する。
# ============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.run"
GRACE_STEPS=25 # 0.2s 刻みで最大 5 秒待つ

TARGET="${1:-all}"

# パターン一致の生存プロセス（自身と祖先 PID は除外）。
# pkill -f は呼び出し元シェルのコマンドラインにも誤って一致し得るため、
# stop.sh から見た祖先（呼び出し元の make / bash など）を除外して巻き込みを防ぐ。
matching_pids() {
  local pattern="$1"
  local ancestors=" " p=$$ next i=0
  while [[ "$p" =~ ^[0-9]+$ ]] && (( p > 1 )) && (( i < 64 )); do
    ancestors="$ancestors$p "
    next="$(awk '/^PPid:/{print $2}' "/proc/$p/status" 2>/dev/null)"
    [[ "$next" =~ ^[0-9]+$ ]] || break
    (( next == p )) && break
    p="$next"
    i=$(( i + 1 ))
  done
  local pid
  for pid in $(pgrep -f "$pattern" 2>/dev/null); do
    case "$ancestors" in
      *" $pid "*) : ;;
      *) printf '%s\n' "$pid" ;;
    esac
  done
}

stop_one() {
  local name="$1" pidfile="$2" pattern="$3"
  local pid="" found=0

  if [[ -f "$pidfile" ]]; then
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      found=1
    fi
    rm -f "$pidfile"
  fi

  if [[ -n "$(matching_pids "$pattern")" ]]; then
    found=1
  fi

  if [[ "$found" == 0 ]]; then
    echo "$name は起動していません。"
    return 0
  fi

  # 1) プロセスグループ（PID ファイル）と、祖先を除外した一致 PID へ SIGTERM
  #    （pkill -f は使わない: 呼び出し元シェルを巻き込む恐れがあるため）
  if [[ -n "$pid" ]]; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  fi
  local target
  for target in $(matching_pids "$pattern"); do
    kill -TERM "$target" 2>/dev/null || true
  done

  # 2) 猶予後にまだ残っていれば SIGKILL へエスカレート
  local i=0
  while (( i < GRACE_STEPS )); do
    if [[ -z "$(matching_pids "$pattern")" ]]; then
      echo "$name を停止しました。"
      return 0
    fi
    sleep 0.2
    i=$(( i + 1 ))
  done

  if [[ -n "$pid" ]]; then
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi
  for target in $(matching_pids "$pattern"); do
    kill -KILL "$target" 2>/dev/null || true
  done
  sleep 0.3

  if [[ -n "$(matching_pids "$pattern")" ]]; then
    echo "$name を停止できませんでした（PID: $(matching_pids "$pattern" | tr '\n' ' ')）。" >&2
    return 1
  fi
  echo "$name を強制停止しました（SIGTERM に応答しなかったため SIGKILL を使用）。"
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
