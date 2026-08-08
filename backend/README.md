# バックエンド（FastAPI）

4資産（`us_equity`, `us_bond`, `ex_us_equity`, `ex_us_bond`）のデータ収集・ポートフォリオ最適化・バックテストを行うバックエンド。

## セットアップ

`uv`（https://docs.astral.sh/uv/ 参照）が必要です。uv はプロジェクト用に Python 3.11 を自動で導入します（`backend/.python-version` 参照）。

```bash
uv sync
```

## 起動

```bash
uv run uvicorn app.main:app --reload --port 8000
```

ヘルスチェック: http://localhost:8000/api/health

OpenAPI スキーマ: http://localhost:8000/docs

## テスト / Lint / 型チェック

```bash
uv run pytest          # テスト
uv run ruff check .    # lint
uv run mypy app        # 型チェック
```

## 構成（抜粋）

- `app/config/` — Pydantic Settings と資産マッピング設定
- `app/schemas/` — API スキーマ（OpenAPI の契約）
- `app/domain/` — 純粋な計算ロジック（現在はプレースホルダー）
- `app/data/` — データプロバイダー／リポジトリ抽象
- `app/optimization/`, `app/backtest/` — 最適化／バックテスト（現在はプレースホルダー）
- `app/api/` — FastAPI ルーター

詳細はルート `README.md` と `docs/design.md` を参照。
