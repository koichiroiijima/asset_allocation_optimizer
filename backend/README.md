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

- `app/config/` — Pydantic Settings、資産セット定義（`assets.default.json`=米国モード / `assets.jp.json`=日本モード）
- `app/schemas/` — API スキーマ（OpenAPI の契約。asset / series / analysis / optimization / backtest / job）
- `app/domain/` — 純粋な計算ロジック（リターン計算・年率換算・頻度リサンプリング・ローリングボラ・相関行列 `returns.py`）
- `app/data/` — データプロバイダー／リポジトリ抽象（Parquet + SQLite 索引 + スナップショットハッシュ）
- `app/optimization/` — 最適化サービス（PyPortfolioOpt `static_allocation` 実装済み）
- `app/backtest/` — バックテストエンジン（固定ウェイト・リバランス `run_backtest` 実装済み）
- `app/api/` — FastAPI ルーター（`routes/` 配下に assets / series / analysis / optimizations / backtests / jobs / runs、`route_helpers.py` が複数資産の価格行列整列を共用）

### 資産セット（モード）とデータ取得

```bash
# 米国モード（us・既定・USD基準）の4資産を取得
uv run python -m app.cli fetch

# 日本モード（jp・JPY基準・円建て ETF）の4資産を取得
uv run python -m app.cli fetch --set jp
```

最適化・バックテスト・分析の入力は**分配金補正付き `adjusted_close`**（Yahoo `indicators.adjclose`）を使用します（`raw_close` は表示専用）。

### 実装済みエンドポイント

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/api/health` | 稼働状態 |
| `GET` | `/api/assets?set={us\|jp}` | 資産定義＋データ状態（data_status。既定 us・未知名は400） |
| `GET` | `/api/data/series` | 単一資産の系列（adjusted_close / price / return / cumulative、D/W/M、NaN 除外） |
| `GET` | `/api/data/analysis` | 複数資産の分析データ（価格・累積リターン・ローリングボラ・相関行列、未取得は除外して警告） |
| `POST` | `/api/optimizations` | 最適化（`static_allocation`）の同期実行。`start`/`end` で期間を絞りルックアヘッドを回避 |
| `POST` | `/api/backtests` | バックテスト（固定ウェイト・リバランス）の同期実行。次営業日約定でルックアヘッドを回避 |
| `POST`/`GET`/`cancel` | `/api/jobs` 系 | ジョブ状態遷移の骨格（実処理の配線は未実施） |
| `GET` | `/api/runs` 系 | 実行結果の骨格（プレースホルダー） |

詳細はルート `README.md` と `docs/design.md` を参照。
