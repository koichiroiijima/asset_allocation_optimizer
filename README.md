# アセット配分最適化アプリ

4資産（米国株式・米国債券・米国を除く株式・米国を除く債券）を対象に、データ収集・ポートフォリオ最適化・バックテスト・可視化を行う**研究用Webアプリケーション**です。

> **免責事項**: 本アプリは研究・教育・シミュレーション用途です。個別の投資助言、将来リターンの保証、税務・法務判断は行いません。バックテストや最適化の結果は仮想シミュレーションであり、約定・税金・流動性・為替・価格インパクトを完全には再現しません。

詳細な設計方針・データモデル・未確定事項は [`docs/design.md`](docs/design.md)、実装の進捗は [`docs/TODO.md`](docs/TODO.md) を参照してください。

---

## 構成

| ディレクトリ | 内容 |
| --- | --- |
| `backend/` | FastAPI + Python（api / domain / data / optimization / backtest / schemas） |
| `frontend/` | React + TypeScript + Vite（6画面、Recharts） |
| `data/` | 取得データ（raw / processed / fixtures）。`data/*` は git 管理外 |
| `outputs/` | 最適化・バックテスト成果物。git 管理外 |
| `docs/design.md` | 設計メモ |

## 必要なツール

| ツール | 用途 | 備考 |
| --- | --- | --- |
| [uv](https://docs.astral.sh/uv/) | Python 3.11 の調達と依存管理 | ローカルが Python 3.10 でも uv が 3.11 を用意 |
| [npm](https://www.npmjs.com/) | frontend の依存管理 | `package-lock.json` をコミット |

`uv` が未導入の場合は、公式のインストール手順に従って導入してください（例: `curl -LsSf https://astral.sh/uv/install.sh | sh`）。

## セットアップ

```bash
make setup
```

これは以下と同等です。

```bash
cd backend && uv sync      # .venv に 3.11 を導入し依存をインストール
cd frontend && npm install # node_modules をインストール
```

環境変数のサンプルは [`.env.example`](.env.example) にあります。実際の値は `.env` にコピーして設定してください（`.env` は gitignore 済み）。プレフィックスは `ASSET_ALLOC__` です。

## 標準コマンド

| コマンド | 内容 |
| --- | --- |
| `make test` | backend と frontend の全テスト |
| `make test-backend` | `cd backend && uv run pytest` |
| `make test-frontend` | `cd frontend && npm run test` |
| `make lint` | backend (ruff) + frontend (eslint) |
| `make typecheck` | backend (mypy) + frontend (tsc) |
| `make format` | backend (ruff format) + frontend (prettier) |
| `make dev` | 開発サーバーを並列起動（backend :8000 + frontend :5173） |
| `make dev-backend` | FastAPI（Uvicorn + reload） |
| `make dev-frontend` | Vite dev server |
| `make reset-data` | 取得データ・成果物・DB を削除（fixtures は対象外） |

個別で実行する場合:

```bash
# backend
cd backend
uv run pytest              # テスト
uv run ruff check .        # lint
uv run ruff format .       # format
uv run mypy app            # 型チェック

# frontend
cd frontend
npm run test               # テスト (vitest)
npm run lint               # lint (eslint)
npm run typecheck          # 型チェック (tsc --noEmit)
npm run format             # format (prettier)
npm run build              # 本番ビルド
```

### 開発サーバー

```bash
make dev
# または2つのターミナルで
make dev-backend   # http://localhost:8000  (OpenAPI: /docs)
make dev-frontend  # http://localhost:5173 (/api を :8000 へプロキシ)

frontend の API ベース URL は環境変数 `VITE_API_BASE` で変更できます（既定は `/api`、後述の Vite プロキシ経由）。backend 側の設定は `ASSET_ALLOC__*` プレフィックス（`.env.example` 参照）ですが、**frontend 側は Vite の `VITE_` プレフィックス**なので注意してください。
```

プルークチェック: `curl http://localhost:8000/api/health` が `{"status":"ok",...}` を返せば接続成功です。

## API 一覧（初期スケジュール）

CLAUDE.md の API 設計に基づく初期エンドポイント。**最適化は同期エンドポイント（`POST /api/optimizations`）、バックテストは同期エンドポイント（`POST /api/backtests`）で実行**します。ジョブ方式（`/api/jobs`）は**メモリ内の状態遷移骨格のみ実装済みで、実処理（データ取得の配線）は未実施**です（プレースホルダー）。

| メソッド | パス | 内容 | 状態 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | 稼働状態 | 実装済み |
| `GET` | `/api/assets` | 資産定義・候補商品・**データ状態** | 実装済み（processed から状態を合成） |
| `GET` | `/api/data/series` | 正規化済み系列（価格・リターン・累積、D/W/M 再サンプリング、NaN 除外） | 実装済み（processed に配線） |
| `GET` | `/api/data/analysis` | 分析画面用データ（複数資産の価格・累積リターン・ローリングボラ・相関・**リターン/リスク統計 `stats`**） | 実装済み（未取得資産は除外して警告） |
| `POST` | `/api/optimizations` | 最適化（`static_allocation`）の同期実行 | 実装済み（`start`/`end` でルックアヘッド回避） |
| `POST` | `/api/backtests` | バックテスト（固定ウェイト/再最適化・リバランス）の同期実行 | 実装済み（次営業日約定でルックアヘッド回避・`reoptimize` 対応） |
| `POST` | `/api/jobs` | ジョブ作成（`data_fetch` / `optimization` / `backtest`） | 骨格のみ（実処理は未配線） |
| `GET` | `/api/jobs/{job_id}` | ジョブ状態（queued/running/succeeded/failed/cancelled） | 骨格のみ（メモリ内） |
| `POST` | `/api/jobs/{job_id}/cancel` | 実行中ジョブのキャンセル | 骨格のみ |
| `GET` | `/api/runs/{run_id}` | 実行結果の概要 | 骨格のみ（メモリ内） |
| `GET` | `/api/runs/{run_id}/equity-curve` | 累積損益 | 骨格のみ（プレースホルダー） |
| `GET` | `/api/runs/{run_id}/trades` | 取引一覧 | 骨格のみ（プレースホルダー） |

OpenAPI スキーマは起動後に `http://localhost:8000/docs` で確認できます。

## 4資産のマッピング

論理資産は設定ファイル（`backend/app/config/assets.default.json`）で定義します。ティッカーは変更可能です（`assets.default.json` を編集）。

| 論理資産 | 表示名 | 既定ティッカー | 対象指数 | 通貨 |
| --- | --- | --- | --- | --- |
| `us_equity` | 米国株式 | `VTI` | CRSP US Total Market Index | USD |
| `us_bond` | 米国債券 | `AGG` | Bloomberg U.S. Aggregate Bond Index | USD |
| `ex_us_equity` | 米国を除く株式 | `VXUS` | FTSE Global All Cap ex US Index | USD |
| `ex_us_bond` | 米国を除く債券 | `IAGG` | Bloomberg Global Aggregate ex-USD Index | USD |

> 既定ティッカーは **Yahoo Finance chart API で取得確認済み**です（データソースの選定理由・Adjusted Close / 分配金の扱いは [`docs/design.md`](docs/design.md) の §6.4 を参照）。ティッカーは設定で変更可能で、`sync` を前提にコードへ固定していません。

## データ取得 CLI

4資産の価格データは **Yahoo Finance chart API（query2 ホスト）** から取得します。取得は CLI 経由で行い、raw（取得直後）と processed（正規化済み）の Parquet ＋ CSV エクスポートを生成します。**API ジョブ／GUI からの取得は現在未接続です。**

```bash
cd backend

# 全4資産（VTI / AGG / VXUS / IAGG）の全履歴を取得して保存
uv run python -m app.cli fetch

# 特定資産・期間を指定
uv run python -m app.cli fetch --asset us_equity --asset us_bond \
    --start 2024-01-01 --end 2024-06-30

# 正規化済み Parquet を CSV へエクスポート（既定: processed ディレクトリ）
uv run python -m app.cli export-csv --out ../data/processed

# ヘルプ / バージョン
uv run python -m app.cli --help
uv run python -m app.cli --version
```

出力:
- `data/raw/{asset}.parquet` ＋ `data/raw/{asset}.snapshot.json` — 取得直後の原本（スナップショットハッシュ付き）
- `data/processed/{asset}.parquet` — 正規化済み（`raw_snapshot_hash` で raw スナップショットを参照）
- `data/processed/{asset}.csv` — CSV エクスポート（UTF-8・日付 `%Y-%m-%d`）
- SQLite の `fetch_history` テーブル — 取得履歴（`started_at`/`finished_at`/`rows`/`status`）

> ⚠️ **利用上の注意**: Yahoo Finance のデータは**非商用・研究目的**の利用に限定し、再配布しないでください（利用規約を確認してください）。取得間隔は控えめにしてください。`query1` ホストは 429 を返すため、本実装は `query2` を使用します。
>
> データ頻度は**日次（`interval=1d`）**です。Yahoo は全履歴を `range=max` で要求すると月足に自動ダウンサンプリングするため、本実装は `period1`（2000-01-01 起点）と `period2`（現在）を明示して日足を取得します（設計メモ §6.4 参照）。最適化はこの日次データと `annualization_factor=252`（日次→年率）を前提とします。

## 最適化 API（`POST /api/optimizations`）

最適化サービス（PyPortfolioOpt の `static_allocation`）を同期実行します。対象資産の価格データ（processed Parquet）を読み込み、手法・期待リターン・共分散・制約に応じてウェイトと期待指標を返します。

```bash
# 例: 最大シャープレシオ（既定）で 4資産を最適化
curl -X POST http://localhost:8000/api/optimizations \
  -H 'Content-Type: application/json' \
  -d '{
    "asset_ids": ["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"],
    "optimization_method": "max_sharpe",
    "expected_return_method": "mean_historical_return",
    "covariance_method": "sample_cov",
    "risk_free_rate": 0.0,
    "weight_bounds": [0.0, 0.5]
  }'
```

主な入力:

| 項目 | 既定 | 説明 |
| --- | --- | --- |
| `asset_ids` | （必須） | 対象資産の論理ID一覧 |
| `start` / `end` | なし（全期間） | 使用する価格の期間。**ルックアヘッド回避**はこの期間指定で保証される |
| `optimization_method` | `max_sharpe` | `max_sharpe` / `min_volatility` / `efficient_risk` / `efficient_return` |
| `expected_return_method` | `mean_historical_return` | `mean_historical_return` / `capm_return` / `ema_historical_return` / **`black_litterman`**（`capm_return` はベンチマーク系列が必要） |
| `covariance_method` | `sample_cov` | `sample_cov` / `semicovariance` / `ledoit_wolf` |
| `risk_free_rate` | `0.0` | リスクフリー金利 |
| `weight_bounds` | `[0.0, 1.0]` | 全資産共通のウェイト上下限。`asset_weight_bounds` で資産別に上書き可 |
| `target_return` / `target_volatility` | なし | 各々 `efficient_return` / `efficient_risk` に必須 |
| `bl_market_weights` | 既定の市場ポートフォリオ | **Black-Litterman** の市場ポートフォリオウェイト（資産ID→比率、合計1）。省略時は既定値（米国株式 22.88% / 米国債券 21.40% / 除く株式 23.73% / 除く債券 31.98%） |
| `bl_views` | `{}` | Black-Litterman の**絶対ビュー**（年率期待リターン（r_f込み）の水準。資産ID→比率）。空なら市場均衡のみ |
| `bl_view_confidences` | `{}` | ビューの確信度（0–1）。`bl_omega_method="idzorek"` のとき必須 |
| `bl_omega_method` | `default` | `default`（分散に比例）／ `idzorek`（確信度から算出） |
| `bl_tau` | `0.05` | ビュー信頼係数（`0 < τ ≤ 1`）。**`omega="default"` では結果に影響しない** |
| `bl_risk_aversion` | `null` | リスク回避度。省略時は市場ポートフォリオのリターンから逆算 |

> **BL 入力の検証（422・日本語）**: `bl_tau` は `0 < τ ≤ 1`、`bl_risk_aversion` は正、確信度は 0〜1、指定時は市場ウェイト合計誤差 `≤1e-3`。`bl_omega_method="idzorek"` でビューがある場合は**ビュー全キーに確信度が必要**。また `bl_views`/`bl_market_weights` のキーは選択 `asset_ids` の範囲内でなければならない。

レスポンスには、**丸め前の生ウェイト `weights` と表示用 `clean_weights`**、年率換算の `metrics`（期待リターン・ボラティリティ・Sharpe・個別資産の年率リターン `asset_returns` / 年率ボラ `asset_volatilities`）、入力 `params`、`warnings`（欠落行情報など）が含まれます。未取得資産・期間外・達成不能な目標値は **400（日本語メッセージ）** を返します。

> **Black-Litterman の入力例**: 市場ポートフォリオをウェイトで設定し、米国株式に年率 +3% の期待リターン（r_f 込み）ビューを置く場合
> ```bash
> curl -X POST http://localhost:8000/api/optimizations -H 'Content-Type: application/json' -d '{
>   "asset_ids": ["us_equity", "us_bond"],
>   "expected_return_method": "black_litterman",
>   "bl_market_weights": {"us_equity": 0.5, "us_bond": 0.5},
>   "bl_views": {"us_equity": 0.03},
>   "bl_omega_method": "default",
>   "bl_tau": 0.05
> }'
> ```

## バックテスト API（`POST /api/backtests`）

固定ウェイトまたはリバランス時再最適化のバックテストを同期実行します。対象資産の価格データを読み込み、**シグナル日の翌観測日に約定**（次営業日約定）して累積資産・評価指標・取引を返します。`reoptimize=true` にすると、各リバランスシグナル日まで（開始日またはデータ冒頭から）のデータで保存済み最適化アルゴリズム（`optimization_params`。**再最適化の対象資産はこの `optimization_params.asset_ids`**）を再実行してウェイトを決めます。**再最適化が成功したリバランス日にのみ新ウェイトを採用**し、失敗した時点は**その日はリバランスせず現状維持**＋日本語警告が積まれます。

```bash
# 例: 4資産を固定ウェイト・月次リバランスでバックテスト
curl -X POST http://localhost:8000/api/backtests \
  -H 'Content-Type: application/json' \
  -d '{
    "asset_ids": ["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"],
    "weights": {"us_equity": 0.4, "us_bond": 0.3, "ex_us_equity": 0.2, "ex_us_bond": 0.1},
    "rebalance_frequency": "M",
    "initial_capital": 1000000,
    "cost_rate": 0.001,
    "risk_free_rate": 0.0
  }'
```

主な入力:

| 項目 | 既定 | 説明 |
| --- | --- | --- |
| `asset_ids` | （必須） | 対象資産の論理ID一覧 |
| `weights` | （必須） | 固定ウェイト（`asset_ids` 全資産分のキー。合計 1・各 0〜1） |
| `rebalance_frequency` | `M` | `D` / `W` / `M` / `Y`（年次）。約定日はシグナル日（D:毎営業日、W/M/Y:各期間の最終観測日）の翌観測日 |
| `initial_capital` | `1000000` | 初期資金（ポートフォリオ基準通貨） |
| `cost_rate` | `0.0` | 売買手数料率（両建てレッグベース。0.001 = 0.1%） |
| `risk_free_rate` | `0.0` | Sharpe / Sortino 等のリスクフリー金利（年率） |
| `annualization_factor` | `252` | 年率換算係数 |
| `start` / `end` | なし（全期間） | 使用する価格の期間（ルックアヘッド回避は約定構造が担保） |
| `lookback` | `252` | 予約パラメータ（固定ウェイトでは未使用・echo 用） |
| `reoptimize` | `false` | `true` にするとリバランス時に再最適化（`optimization_params` 必須） |
| `optimization_params` | なし | 再最適化に使う最適化パラメータ（保存済み最適化の `OptimizationRequest`） |

レスポンスには、`metrics`（累積/年率リターン・ボラ・Sharpe/Sortino/Calmar・最大ドローワウン・勝率・回転率・手数料。未定義は `null`）、日次の `equity_curve` / `drawdown` / `allocation`、暦年の `yearly`（**前年最終観測日基準の複利リターン**で、初年度は対象外）、`trades`（取引一覧）、`params`、`warnings`、再最適化時は各リバランス日の採用ウェイト `rebalance_weights` が含まれます。未取得資産・期間外・計算不能な入力は **400（日本語）**、スキーマ検証違反（ウェイト合計≠1 など）は **422** です。

## 通貨・FX 方針（初期版）

- `instrument_trading_currency` = **USD**（各 ETF の取引通貨。価格・リターンの実データ通貨）
- `underlying_currency_exposure` = **USD**（裏付け資産の通貨エクスポージャー）
- `portfolio_base_currency` = **JPY**（ポートフォリオ基準通貨。初期版の設定値）
- `fx_policy` = **unhedged**（為替ヘッジなし）

**`/api/data/series` と `/api/data/analysis` の `currency` は実データの通貨（USD）** を返します（データレコードの `currency` 列）。`portfolio_base_currency`（JPY）はポートフォリオ評価の基準通貨で、価格・リターン系列の通貨とは別に扱います。USD建てETFを日本円基準で評価する場合の USD/JPY エクスポージャーは、アプリ内で明示します（現状は評価換算の実装なし）。

## 現在の実装状態

初期ひな型（データが動き、テストが通る全体の骨格）に加え、4資産のデータ取得 CLI、**データ確認 GUI（第1弾）**、**分析画面・最適化 API・最適化画面・バックテスト** まで実装済みです。具体的には:

- **完了**: プロジェクト構造、設定管理（Pydantic Settings）、データレコードと repository 抽象（Parquet + SQLite 索引 + スナップショットハッシュ）、API スキーマとルート、フロントエンド6画面の骨格、テスト基盤。
- **完了**: Yahoo Finance からのデータ取得 CLI（`fetch` → raw → 正規化 → processed → `export-csv`、取得履歴の SQLite 記録、raw/processed のスナップショットハッシュ連携）。
- **完了**: リターン計算・年率換算（`app/domain/returns.py`）。単純／対数リターン、累積リターン（時間加重）、年率換算（geometric 既定）、年率ボラティリティ、頻度リサンプリング（単純=複利合成／対数=和）。定義は [`docs/design.md`](docs/design.md) §6.6 を参照。
- **完了**: **データ確認 GUI（第1弾）**。`GET /api/data/series` を実データ（processed Parquet）へ配線し、series_type（adjusted_close / price / return / cumulative）と frequency（D/W/M）の再サンプリングを実装。`GET /api/assets` に各資産のデータ状態（取得可否・期間・行数・欠損・出所・取得日時・スナップショットハッシュ）を合成。フロントエンドの「データ」画面で 4 資産の状態一覧表と、選択資産の系列折れ線グラフ（Recharts）を確認できます。
- **完了**: **最適化サービス（PyPortfolioOpt・`static_allocation`）**。`app/optimization/service.py` に HTTP・DB 非依存の純粋計算層を実装。手法（max_sharpe / min_volatility / efficient_risk / efficient_return）、期待リターン（mean_historical_return / capm_return / ema_historical_return / **black_litterman**）、共分散（sample_cov / semicovariance / ledoit_wolf）を選択可能。生ウェイトと表示用 `clean_weights` を併記。入力検証・solver 失敗は日本語エラーで返す。固定データの単体テスト付き。
- **完了**: **Black-Litterman 期待リターン推定**。`expected_return_method="black_litterman"` で市場均衡の先行情報（Π=δ·Σ·w_mkt+rf）と投資家の絶対ビュー（年率期待リターン（r_f込み）の水準）を合成して事後分布を求める。**市場ポートフォリオはユーザーがウェイトで設定可能**（省略時の既定値: 米国株式 22.88% / 米国債券 21.40% / 除く株式 23.73% / 除く債券 31.98%）。ビュー不確実性（ω=default/idzorek）、τ、リスク回避度（省略時は市場から自動逆算）を指定可能。**最適化（BL）タブ（GUI）に BL 専用フォームを用意**（期待リターンは black_litterman 固定）。ビューなしは市場均衡に一致。
- **完了**: **最適化 API（`POST /api/optimizations`）**。`static_allocation` へ配線し、`OptimizationRequest`（対象資産・期間 `start`/`end`・手法・共分散・リスクフリー金利・制約）で同期実行。未取得資産・期間外は 400（日本語）、`OptimizationInputError` はユーザーに理解可能なメッセージで返す。`start`/`end` 入力によるルックアヘッド回避。API テスト付き。
- **完了**: **分析 API（`GET /api/data/analysis`）と分析画面**。processed Parquet から複数資産の価格推移・累積リターン・ローリングボラティリティ・相関行列をまとめて返し（`app/domain/returns.py` の `rolling_volatility` / `correlation_matrix` を再利用）、フロントエンドで日次/週次/月次を切り替えて Recharts 折れ線＋相関ヒートマップを表示。未取得資産は除外して日本語警告を附す。
- **完了**: **最適化画面（GUI）と最適化（BL）画面**。ヘッダーナビを **「最適化」と「最適化（BL）」の2タブ**に分割。**最適化タブ**には通常手法（手法・期待リターン（BL 除く）・共分散・期間・リスクフリー金利・ウェイト上下限を入力）を、**最適化（BL）タブ**には BL 専用フォーム（市場ポートフォリオ・絶対ビュー・確信度・ω・τ・リスク回避度。期待リターンは black_litterman 固定）を配置。**絶対ビュー入力欄には選択資産の EMA 年率リターンを参考表示**（「（EMA: xx.x%・参考）」、`GET /api/data/analysis` の `stats` を再利用・資産未選択中は取得しない）。両タブとも資産別ウェイト・**個別資産のリターン/リスク**・年率指標・警告を表示。
- **完了**: **バックテスト（固定ウェイト/再最適化・エンジン+API+画面）**。`app/backtest/engine.py` の `run_backtest` がリバランスを計算し（**次営業日約定でルックアヘッド回避**）、`POST /api/backtests` と「バックテスト」画面（固定ウェイト・リバランス頻度（日次/週次/月次/年次）・初期資金・コスト率・**再最適化元の最適化（比較一覧から選択）**・再最適化チェックを入力 → 累積資産/ドローワウン/配分推移の折れ線・評価指標・年次成績・**リバランス時の採用ウェイト**・取引一覧を表示）に配線。`rebalance_allocation`（各シグナル日までスライスして最適化）によりリバランス時再最適化に対応し、失敗時は直前ウェイト継続＋日本語警告。評価指標（累積/年率リターン・ボラ・Sharpe/Sortino/Calmar・最大ドローワウン・勝率・回転率・手数料）は未定義を null で返す。対象資産は最適化と同じ multi-select。
- **完了**: **比較・保存画面**。最適化・バックテストの実行結果を「比較に追加」でブラウザ内（`CompareContext`・メモリ・最大50件）にグローバル保持し、「比較・保存」画面で種別ごとの指標比較（最良値強調・null は「—」）・ラベル編集・削除と、JSON（実行結果一式）/ CSV（指標比較表）エクスポートができる。最適化の保存は再現用リクエスト（`OptimizationRequest`）を含め、バックテストの再最適化で呼び出せる。保存はブラウザ内のみ（ページ再読込で消える）ことを UI に明示。
- **予定（後続工程）**: バックテスト実行結果の再現可能な保存（スナップショット・コードバージョン）、`/api/jobs` からの data_fetch 配線、Black-Litterman の**相対ビュー（Q/P 行列）**・`omega="manual"`・市場時価総額（AUM）入力。

バックテストの計算は**過去データによる仮想シミュレーション**です。高い成績を「最適」や「将来も有効」と解釈しないでください。

## 既知の制限

- 実データ取得は **CLI 経由でのみ**接続しています。API ジョブ／GUI からの取得は未接続です（`/api/jobs` の data_fetch は未配線）。
- Yahoo Finance のデータは非商用・研究目的に限定（利用規約を確認）。取得間隔は控えめにしてください。
- 最適化（API + GUI）とバックテスト（固定ウェイト＋再最適化）は実装済み。再最適化の学習期間は「開始日またはデータ冒頭からリバランス日まで」（`lookback` は予約パラメータのまま）。
- バックテストの「実行結果の再現可能な保存」（スナップショット・コードバージョンの永続化）は未実装（params echo による手動再現は可能）。`/api/runs` ・`/api/jobs` はメモリ内プレースホルダーのまま。
- Black-Litterman は**絶対ビュー・ω=default/idzorek・τ・リスク回避度**に対応済み。**相対ビュー（Q/P 行列）・`omega="manual"`・市場時価総額（AUM）入力は未実装**。
- `price_max_staleness_days`（価格陳腐化の最大許容日数・既定5日）は**設定のみ定義で未適用**。判定式（`AssetDataStatus.end` からの暦日数 > 設定値）と適用方針は `docs/design.md` §6 に明記（警告の顕在化・将来の取引停止は今後）。
- データ画面の系列グラフの系列種別は **adjusted_close / return / cumulative の3択**（`price`/raw_close は API では選択可だが GUI ドロップダウンには無い）。
- アプリは **localhost 利用限定**（初期版）。ネットワーク公開時は認証・認可、CORS、レート制限、APIキーの秘密管理、監査ログを設計してから有効化します。
- 再現可能な `make test` 相当の全テスト、lint、型チェック、開発サーバー起動は上記「標準コマンド」で実行できます。

## 開発方針

詳細は [`CLAUDE.md`](CLAUDE.md) と [`docs/design.md`](docs/design.md) にあります。主な方針:

- 数値計算ロジックは UI から分離し、Python の純粋なサービス／ドメイン層でテスト可能にする。
- 取得データをそのまま信頼せず、重複日付・欠損・異常値・配当・分割・営業日ずれを検証する。
- ルックアヘッド（未来情報の混入）を避けるバックテストを厳密に守る。
- 金融データの値や定義を推測で補完せず、取得できない場合はエラー・警告・代替案を返す。
