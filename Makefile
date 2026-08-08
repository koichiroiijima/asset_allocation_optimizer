# ============================================================================
# アセット配分最適化アプリ 標準コマンド
# 要件: uv（Python管理）, npm（frontend）
# ============================================================================

.PHONY: setup test test-backend test-frontend lint lint-backend lint-frontend \
        typecheck typecheck-backend typecheck-frontend dev dev-backend dev-frontend \
        format format-backend format-frontend reset-data

# ---- セットアップ ----
setup:
	cd backend && uv sync
	cd frontend && npm install

# ---- テスト ----
test: test-backend test-frontend

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && npm run test

# ---- Lint ----
lint: lint-backend lint-frontend

lint-backend:
	cd backend && uv run ruff check .

lint-frontend:
	cd frontend && npm run lint

# ---- 型チェック ----
typecheck: typecheck-backend typecheck-frontend

typecheck-backend:
	cd backend && uv run mypy app

typecheck-frontend:
	cd frontend && npm run typecheck

# ---- フォーマット ----
format: format-backend format-frontend

format-backend:
	cd backend && uv run ruff format .

format-frontend:
	cd frontend && npm run format

# ---- 開発サーバー（並列起動） ----
# backend: uvicorn (:8000)   frontend: Vite (:5173, /api を :8000 へプロキシ)
dev: dev-backend dev-frontend

dev-backend:
	cd backend && uv run uvicorn app.main:app --reload --port $(or $(PORT),8000)

dev-frontend:
	cd frontend && npm run dev

# ---- データリセット（取得済みデータ・DBを削除。fixtures は対象外） ----
reset-data:
	rm -rf data/raw/* data/processed/* outputs/* data/app.db
