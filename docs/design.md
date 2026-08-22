# 設計メモ（アセット配分最適化アプリ）

この文書は実装上の設計判断を記録する。詳細な金融モデル仕様・データソース選定はここに集約する。実装の進め方・ガイドラインは `CLAUDE.md` を参照（矛盾する場合はユーザーの最新指示を優先し、本メモを更新する）。

**ステータス**: 初期ひな型（スケルトン）構築完了。Yahoo データ取得 CLI（fetch → raw → normalize → processed → export-csv）実装完了。データ確認 GUI 第1弾（`/api/data/series` 配線・`/api/assets` の data_status・データ画面）実装完了。**最適化サービス（PyPortfolioOpt・`static_allocation`）・最適化 API（`POST /api/optimizations`）・最適化画面（GUI）、分析 API（`GET /api/data/analysis`）と分析画面、バックテスト（固定ウェイト・`POST /api/backtests`・バックテスト画面）、`app/domain/returns.py` のローリングボラ・相関行列、比較・保存画面**を実装済み。**再最適化（`rebalance_allocation`・バックテストの `reoptimize`）、年次（Y）リバランス、最適化結果の個別資産リターン/リスク、対象資産UI統一**も実装済み。**Black-Litterman（`expected_return_method="black_litterman"`・市場ポートフォリオ設定・絶対ビュー・ω/tau/リスク回避度）**も実装済み。未実装は、バックテスト実行結果の再現可能な保存（runs/jobs 配線）、API/GUI からのデータ取得（data_fetch）配線。

---

## 1. 技術スタックと選択理由

| 領域 | 選択 | 理由 |
| --- | --- | --- |
| バックエンド | Python 3.11+ / FastAPI / Uvicorn | CLAUDE.md 指定。uv が 3.11 を調達（ローカルは 3.10 のため） |
| 設定管理 | Pydantic Settings（`ASSET_ALLOC__` プレフィックス） | 型付き・`.env` 対応・テスト注入が容易 |
| 数値 | pandas / numpy / scipy / PyPortfolioOpt | CLAUDE.md 指定。最適化エンジン `static_allocation` は実装済み |
| データ保存 | Parquet（価格系列）+ SQLite（索引・資産定義・ジョブ・結果） | 分析に適した列指向 + 軽量な索引。今後置換可能に抽象化 |
| 依存管理 (Python) | **uv**（`pyproject.toml` + `uv.lock` コミット） | ユーザー選択。再現性のあるロック |
| フロント | React 18 + TypeScript + Vite + **Recharts** | ユーザー選択（グラフは Recharts）。型チェック・ESLint・Prettier・vitest |
| 依存管理 (Frontend) | **npm**（`package-lock.json` コミット） | ユーザー選択。pnpm は不使用 |

## 2. ディレクトリ構成（実装済み）

```text
backend/
  app/
    api/            # FastAPI ルーター（health / routes/assets,series,analysis,optimizations,jobs,runs）
      deps.py       # DI（get_settings）
      router.py     # /api プレフィックスで集約
      route_helpers.py  # load_price_matrix（複数資産の価格行列整列。analysis/optimizations で共用）
      routes/
        analysis.py     # GET /api/data/analysis（複数資産の分析データ）
        optimizations.py# POST /api/optimizations（static_allocation の同期配線）
        backtests.py    # POST /api/backtests（固定ウェイト＋再最適化の同期配線）
        assets.py / series.py / jobs.py / runs.py
    config/
      settings.py   # Pydantic Settings + validate_settings + get_settings（lru_cache）
      assets.py     # 資産定義読み込み
      assets.default.json  # 4資産の初期マッピング（仮）
    domain/
      assets.py     # 論理資産の型・定義辞書
      returns.py    # リターン計算・年率換算・頻度リサンプリング・rolling_volatility・correlation_matrix（実装済み）
    data/
      provider.py     # PriceProvider Protocol（fetch_history / get_available_history / name）
      repository.py   # Catalog(SQLite索引) / SeriesStore(Parquet) + スナップショットハッシュ
      raw.py          # RawParquetWriter（raw/{asset}.parquet + snapshot.json、取得直後に対応）
      normalize.py    # normalize_prices（ソート・dedup・欠損除去・既定値補完）
      calendar.py     # TradingCalendar（観測日ランク付与・祝日DBなし）
      pipeline.py     # PricePipeline（fetch → raw → normalize → processed + fetch_history 記録）
      export.py       # export_csv / export_csv_for_asset（processed → CSV エクスポート）
      summary.py      # summarize_series（data_status 用の集計）
      providers/
        yahoo.py      # YahooPriceProvider（query2 chart API、events=div、UA 付与）
    cli.py            # fetch / export-csv サブコマンドの argparse CLI
    __main__.py       # python -m app / -m app.cli 両対応
    optimization/
      service.py    # static_allocation と rebalance_allocation 実装済み
    backtest/
      engine.py     # run_backtest 実装済み（固定ウェイト＋再最適化。次営業日約定でルックアヘッド回避）
    schemas/        # Pydantic モデル（asset / dataseries / series / analysis / optimization / backtest / job）
    main.py         # create_app(settings=None) アプリファクトリ
    __init__.py     # __version__ = "0.1.0"
  tests/            # pytest 一式（test_cli / test_yahoo_provider / test_normalize / test_pipeline / test_export / test_analysis_api / test_optimizations_api ほか）
  tests/fixtures/   # yahoo_vti_sample.json（ネットワーク不使用のテスト用サンプル）
frontend/
  src/
    api/            # types.ts / client.ts（fetch ラッパー）/ index.ts
    components/     # Header, HealthCheck
    hooks/          # useHealth, useAssets, useSeries, useAnalysis
    pages/          # Data / Analysis（実装済み）/ Optimization / BlOptimization / Backtest / Compare（6画面）
    App.tsx / main.tsx / index.css
  tests/            # setup.ts / api.test.ts / DataScreen.test.tsx / App.test.tsx ほか
data/               # raw / processed / fixtures（git 管理外）
outputs/            # optimization / backtest（git 管理外）
docs/design.md      # 本メモ
```

## 3. アーキテクチャ方針

### 3.1 バックエンド

- **アプリファクトリ**: `create_app(settings: Settings | None = None)`。テストは設定を注入して独立アプリを作る（DI）。起動時は `app = create_app()`。
- **api / domain / data / schemas 分離**: HTTP層（api）・純粋ロジック（domain, optimization, backtest）・データアクセス（data）を分離。数値計算は UI から独立しテスト可能にする。
- **Dependency は `Annotated[..., Depends(...)]` エイリアス**を使い、`Depends()` をデフォルト引数に書かない（ruff B008回避・可読性）。
- **ジョブ方式**: 最適化・バックテストは初期版からジョブIDを返す非同期方式。現在はメモリ内ストアで状態遷移の契約（queued/running/succeeded/failed/cancelled）だけを提供し、将来 SQLite / プロセス間キューへ移行できる形にしている。

### 3.2 フロントエンド

- **API型と画面状態を分離**: `src/api/types.ts` にサーバー契約の型を定義し、`client.ts` の fetch ラッパーを介す。画面は型付きのクライアントのみを使う。
- **画面は6つ**: データ / 分析 / 最適化 / **最適化（BL）** / バックテスト / 比較・保存。データ画面（資産一覧＋系列グラフ）・**分析画面**（`useAnalysis` フック＋`getAnalysis`）・**最適化画面**（`OptimizationScreen.tsx`、BL 除外）・**最適化（BL）画面**（`BlOptimizationScreen.tsx`、BL 専用・期待リターン固定）・**バックテスト画面**（`BacktestScreen.tsx`＋`runBacktest`）は実装済み。比較・保存画面（`CompareScreen.tsx`・`compare/CompareContext.tsx`）は実装済み（実行結果をグローバル保持・JSON/CSV エクスポート）。
- **状態管理**: 現段階は React 標準の state + カスタムフック（`useHealth` / `useAssets` / `useSeries` / `useAnalysis`）。必要になった段階で検討。

## 4. 設定モデル（`config/settings.py`）

環境変数は `ASSET_ALLOC__*` プレフィックス、または `.env` から読む。`validate_settings` で値間の整合性を検証する。

| 設定 | 既定 | 意味 |
| --- | --- | --- |
| `app_env` | development | development / test / production |
| `app_port` | 8000 | Uvicorn ポート |
| `portfolio_base_currency` | **JPY** | ポートフォリオ基準通貨（初期版の必須） |
| `instrument_trading_currency` | USD | 各商品の取引通貨 |
| `underlying_currency_exposure` | USD | 裏付け資産の通貨エクスポージャー |
| `fx_policy` | unhedged | 為替ヘッジ方針（unhedged / hedged） |
| `data_root` / `output_root` | ../data / ../outputs | ルートからの相対 |
| `sqlite_path` | data_root/app.db | 未指定時は data_root 配下 |
| `asset_mapping_file` | app/config/assets.default.json | 資産マッピング |
| `price_max_staleness_days` | 5 | 価格陳腐化の最大許容日数 |
| `annualization_factor` | 252 | 日次→年率換算係数 |
| `cors_origins` | http://localhost:5173 | ローカル開発のみ |

**通貨・FX 分離**: `portfolio_base_currency`、`instrument_trading_currency`、`underlying_currency_exposure`、`fx_policy` を分離して管理する。**`/api/data/series`・`/api/data/analysis` の `currency` は実データの通貨（`instrument_trading_currency`=USD）** を返し、`portfolio_base_currency`（JPY）はポートフォリオ評価の基準通貨として別に扱う。USD建てETFをJPY基準で評価する場合の USD/JPY エクスポージャーは評価時に明示する。

## 5. データモデル

### 5.1 4資産の論理名（設定で差し替え可能）

| 論理資産 | 意味 |
| --- | --- |
| `us_equity` | 米国株式 |
| `us_bond` | 米国債券 |
| `ex_us_equity` | 米国を除く株式 |
| `ex_us_bond` | 米国を除く債券 |

資産定義（`assets.default.json`）には、論理資産・表示名・既定ティッカー・対象指数・資産クラス・通貨・デュレーション・信用リスク・為替ヘッジ・分配金再投資の扱いを含める。**MVP の既定値は仮**（後述の未確定事項参照）。

### 5.2 推奨データレコード

```text
date, asset_id, raw_close, adjusted_close, distribution,
currency, source, source_symbol, price_type, retrieved_at,
timezone, calendar, available_at, source_request_hash,
raw_snapshot_hash, processed_snapshot_hash
```

- **raw と processed を分離**して保存する。
- raw には取得リクエスト、内容ハッシュ、取得時刻、プロバイダーのデータバージョンを保存。
- 処理済みデータと実行結果は必ず特定の raw / processed スナップショットハッシュを参照する。

### 5.3 Repository 抽象

- `SeriesStore`: Parquet で価格系列を保存・読み出し。保存時に **SHA-256 スナップショットハッシュ**を計算しマニフェストに記録（決定論的 canonical JSON: 日付で安定ソート + `sort_keys`）。processed 側は保存された Parquet の内容から自身の `processed_snapshot_hash`、対応する raw スナップショットの参照 `raw_snapshot_hash` を保持する。
- `Catalog`（`SqliteIndexRepository`）: SQLite で資産定義・取得履歴・ジョブ・実行結果の索引を管理。取得履歴は `fetch_history` テーブル（`asset_id / source / started_at / finished_at / rows / status`、`insert_fetch_history` / `update_fetch_status` メソッド）。
- `RawParquetWriter`: raw データを `raw/{asset}.parquet` と `raw/{asset}.snapshot.json` に保存。スナップショットハッシュ手順は `SeriesStore` と同一レシピで、正規化前に raw のハッシュを確定する。
- `PriceProvider`（Protocol）: 実データ取得の抽象シグネチャ（`fetch_history` / `get_available_history` / `name`）。実装として `YahooPriceProvider`（query2 chart API）を持つ。追加プロバイダーはこの Protocol を実装するアダプターで行う。

## 6. データ正規化・データソース方針

- 4資産を同一通貨・同一頻度・同一営業日基準に整列する。基準カレンダーを定め、**inner join だけで観測日を削除しない**。
- 各資産の履歴開始日と、4系列の共通履歴開始日を明示。上場前データを推測で補完しない。
- 保有資産評価では直近価格を使用するが、`price_max_staleness_days`（既定5日）を超えたら警告または取引停止にする。
- リターン計算（年率換算 `annualization_factor=252`）と評価計算のカレンダー規則を分けて記録する。
- ETF のバックテスト総収益には原則として Adjusted Close を使うが、プロバイダーごとの定義をメタデータに残す。売買執行・スリッページ・回転率には未調整の取引価格を別途使う。
- 企業行動・分配金・シンボル変更・ETF償還は方針を記録。代替ETFへ自動乗り換えて連続系列を作らない。

### 6.4 データソース（Yahoo Finance chart API を採用）

**選定比較（2026-08-08 実プローブで確認）**

| プロバイダー | 結果 | 判断 |
| --- | --- | --- |
| **Yahoo Finance chart API（query2ホスト）** | ブラウザ UA ヘッダ付きで 200。`interval=1d&events=div` で日次終値・Adjusted Close・分配金（`events.dividends`）を返す | **採用**（無料・APIキー不要・研究目的で利用） |
| Yahoo Finance（query1ホスト） | UA なしだと 429 | query2 を利用 |
| stooq | JavaScript proof-of-work により取得不可 | 不採用（スクレイピング前提のため） |

**利用上の前提（CLAUDE.md 準拠）**
- Yahoo の利用規約に従い**非商用・研究利用に限定**。再配布しない。取得間隔は控えめにする。
- 実データの取得は CLI（`app.cli fetch`）経由のみ。API ジョブ／GUI への配線は本フェーズでは行わない。
- API キー不要（設定やログに秘密情報は出さない）。

**Yahoo データの扱い**
- **データ頻度は日次**（`interval=1d`）。Yahoo は全履歴を `range=max` で要求すると月足に自動ダウンサンプリングして返す（2026-08-08 実測で発覚し修正）。本実装は start/end 未指定でも `period1`=2000-01-01・`period2`=現在（UTC）を明示して日足を取得する。`period1` のみ指定だと Yahoo が endDate=-1 として 400 を返すため `period2` は必ず付与する。最適化・リターン統計はこの日次データと `annualization_factor=252` を前提とする。
- `adjusted_close`（`indicators.adjclose`）は分配金・分割を反映した Yahoo 定義の修正終値。バックテスト総収益は原則これを使う。定義はメタデータに残す。
- `events.dividends` の amount を `distribution` 列へ格納。配当日でない行は `0.0`。
- `close` が `null` の行（非営業日プレースホルダー）は `distribution=0.0` として保持し、`raw_close`/`adjusted_close` が両方空の行は正規化時に除去。
- `currency`=meta.currency、`timezone`=meta.exchangeTimezoneName、`calendar`="us"、`source`="yahoo"、`source_symbol`=ticker を記録。
- `source_request_hash`=レスポンス本文の SHA-256 で、取得内容を再現可能にする。

**CLI パイプライン（fetch → raw → normalize → processed → export-csv）**

```text
fetch        YahooPriceProvider.fetch_history → raw/{asset}.parquet（+snapshot.json）
                                 ↓ 正規化（normalize_prices）
             processed/{asset}.parquet に raw_snapshot_hash を付与して保存
                                 ↓
export-csv   processed/{asset}.parquet → processed/{asset}.csv（UTF-8, %Y-%m-%d）
```

- raw（取得直後）と processed（正規化済み）を分離し、processed は必ず `raw_snapshot_hash` で特定の raw スナップショットを参照する。
- 取得履歴は SQLite の `fetch_history` に記録（`started_at`/`finished_at`/`rows`/`status`、失敗資産は `status=failed` で資産単位に隔離）。

### 6.5 実装済みデータ処理の挙動

- **正規化（`normalize_prices`）**: 日付を datetime64 化して昇順ソート → 重複日付は `keep="last"` で除去 → 数値列を float 化 → `raw_close` と `adjusted_close` が**両方 NaN の行を除去** → `distribution` / `timezone` / `available_at` / `price_type` の欠損を既定値で補完 → `SERIES_COLUMNS` の列のみを決められた順序で保持（未知列は除去）。空入力・必須列（`date`/`asset_id`）欠落・価格列が存在するのに全行が空、は **ValueError**（上場前データなどを推測で補完しない、という CLAUDE.md 方針）。
- **クローズの非営業日処理**: Yahoo は `close` が `null` の行（非営業日プレースホルダー）を返すことがある。これは `raw_close`/`adjusted_close` が空の行として正規化で除去される。配当日は `events.dividends` の amount を `distribution` に格納し、非配当日は `0.0`。
- **スナップショットハッシュ連携**: `fetch_history` の結果を正規化**前**に `RawParquetWriter` で保存し raw スナップショットハッシュを確定 → processed フレームの `raw_snapshot_hash` 列に同値を設定してから `SeriesStore` で保存。これにより processed は常に特定の raw スナップショットを参照する。
- **失敗の隔離**: `PricePipeline.run()` は資産単位に try/except で隔離。1資産の取得・保存に失敗しても他資産は続行し、失敗資産は `status=failed` とエラー内容をサマリ／fetch_history に記録する。例外は握りつぶさない。
- **CLI 検証**: `app.cli` の `fetch` / `export-csv` は `is_valid_asset_id` で資産IDを検証（未知IDは終了コード2）。全取得はネットワーク非依存のテスト（`httpx.MockTransport` + `tests/fixtures/yahoo_vti_sample.json`、fake provider、monkeypatch）で検証する。

### 6.6 リターン計算（`app/domain/returns.py`・実装済み）

正規化済み価格 series からリターン計算・年率換算・頻度リサンプリングを行う**純粋関数**（HTTP・DB 非依存）。インデックスは `DatetimeIndex`（昇順）を前提とする。

- **単純リターン `simple_return`**: `prices[t]/prices[t-1] - 1`（`pct_change(fill_method=None)`）。先頭は NaN。欠損は前処理しない。
- **対数リターン `log_return`**: `ln(prices[t]/prices[t-1])`。先頭は NaN。非正の価格は `-inf`/NaN として顕在化（推測補完しない）。
- **累積リターン `cumulative_return`**: 時間加重 `cumprod(1+r) - 1`。先頭は基準日＝ 0.0 に置換。途中の NaN は `cumprod` の skipna に任せ「観測なし＝1.0 の寄与」とみなす。
- **年率リターン `annualize_return`**: 欠損を除いた平均を年率換算。既定は **geometric** `(1+mean)^factor - 1`（バックテスト用・時間加重に整合）。`arithmetic` `mean×factor` は PyPortfolioOpt の `mean_historical_return` 互換として提供。空・全 NaN は `float("nan")`（ゼロ除算・空系列を握りつぶさない）。
- **年率対数リターン `annualize_log_return`**: `expm1(mean×factor)`。対数リターンの和は経路非依存のため正確。
- **年率ボラティリティ `annualize_volatility`**: 標本標準偏差 `std(ddof=1)` × `√factor`。データ 1 点未満は NaN。
- **頻度リサンプリング `resample_returns`**: `'D'`/`'W'`/`'M'`（`_FREQ_MAP={"D":"D","W":"W","M":"ME"}`）。入力が単純リターン（`log=False`）は期間内を `(1+r)` の積で複利合成、対数リターン（`log=True`）は和。集約 index は各期間の**最終観測日**。`'D'` は恒等。
- **年率換算係数**: `annualization_factor`（既定 252）を引数で注入。`Settings.annualization_factor` と整合させる。
- **価格系列リサンプリング `resample_prices`**: `frequency`（`'D'`/`'W'`/`'M'`）に応じて価格系列を集約する。`resample_returns` と同じ grouper を使い、各期間の**最終観測日**を index に、`groupby().last()` で集約（期間内の最終観測値をその期間の代表値とする）。`'D'` は恒等。リターン系（return/cumulative）の再サンプリングには `resample_returns`（複利合成）を使い、価格系（price/adjusted_close）には `resample_prices` を使う。
- **ローリングボラティリティ `rolling_volatility`**: リターン系列の移動年率ボラ。各時点で直近 `window` 個の観測（NaN 除外・`std(ddof=1)`）に `√factor` を掛けて年率換算。先頭区間（観測 < window）は NaN。空・全 NaN は全 NaN 系列を返す。`window < 2` は `ValueError`。
- **相関行列 `correlation_matrix`**: リターン系列（列=資産）のピアソン相関。NaN は資産ペアごとに観測のある組だけで除外（推測補完しない）。単一資産は 1×1（対角 1.0）、空は空行列を返す。
- **欠損方針**: fill / 推測補完を一切行わない。空・全 NaN 系列は例外を投げず NaN を返す。
- **未確定（future work）**: 週次 `'W'` のアンカーは pandas 既定（週末終わり）に任せる。カレンダー規則の確定時に、アンカーと週次複利の偶発的欠損の扱いを再検討する。

### 6.7 系列 API とデータ状態（データ確認 GUI 第1弾・実装済み）

- **`GET /api/data/series`** を processed Parquet へ配線した。`settings.processed_dir` から `ParquetPriceRepository.load_series(asset_id, start, end)` で読み込み、`series_type` に応じて `app/domain/returns.py` の純粋関数で変換する（`adjusted_close`→調整済み終値、`price`→`raw_close`、`return`→`simple_return`、`cumulative`→`cumulative_return(simple_return)`）。`frequency`（既定 D）が W/M のとき、リターン系は `resample_returns`、価格系は `resample_prices` で再サンプリングする。
- **NaN の扱い**: リターン系の初回 NaN などは**JSON 配線時に NaN の点を除外**する（無効な JSON を避ける）。値は補完・推測しない。`missing` 数や警告ですでに画面に顕在化させている。
- **未取得資産**: `load_series` が `FileNotFoundError` を投げた場合、例外を握りつぶさず**空の points ＋ 日本語警告**（「データが未取得です（{id}）。先にデータ取得 CLI を実行してください。」）を返す。
- **`GET /api/assets`**: 設定由来の資産定義に `data_status`（`AssetDataStatus`）を合成する。`summarize_series(df)`（`app/data/summary.py` の純粋関数）が processed フレームから `available` / `start` / `end` / `rows` / `missing`（adjusted_close の NaN 行数）/ `source` / `price_type` / `retrieved_at` を集計し、route 側で `repo.read_manifest()` の `snapshot_hash` を合成する。未取得は `available=false`。
- **DI は最小化**: リポジトリは route 内で `settings.processed_dir` から直接構築する。`app.state.repositories` への配線は将来のワーカー置換フェーズに回す。

### 6.8 分析 API（`GET /api/data/analysis`・実装済み）

- **役割**: 分析画面（価格推移・累積リターン・ローリングボラ・相関ヒートマップ）のために、複数資産のデータを 1 リクエストでまとめて返す。
- **入力**: `asset_ids`（必須・min_length=1）、`start` / `end`（期間）、`frequency`（D/W/M・既定D）、`window`（ローリング窓・既定60・5〜1000）。
- **共通ヘルパー**: `app/api/route_helpers.py` の `load_price_matrix(repo, asset_ids, start, end)` で複数資産の adjusted_close を**外側 union の日付インデックス**で整列した価格行列を作る。観測日が資産ごとに異なるセルは NaN のまま（推測補完しない）。未取得資産（`FileNotFoundError`）・期間外（空データ）は除外し、日本語警告に積む。analysis と optimizations の両ルートで共用する（設計方針: 例外を握りつぶさず警告として顕在化）。
- **計算**: `frequency != D` のとき価格を `resample_prices` で先に再サンプリング（各期間の最終観測値）。その後、価格行列 → `simple_return`（列=資産）→ `cumulative_return` / `rolling_volatility(window, annualization_factor)` / `correlation_matrix` を適用。相関は共通日付に整列したリターン行列から計算し、単一資産は 1×1。
- **レスポンス**: `AnalysisResponse`（`app/schemas/analysis.py`）= `currency`（`instrument_trading_currency`、実データの通貨 USD）/ `assets_used`（実際に使った資産）/ `window` / `prices` / `cumulative` / `rolling_volatility`（各 `AssetSeries`）/ `correlation`（`CorrelationMatrix`：欠損セルは `null`）/ `warnings`。
- **警告（日本語）**: 未取得・期間外の資産は除外して警告、全資産が使えない場合は空レスポンス＋警告、1資産のみのときは「相関の解釈には2資産以上必要です。」
- **フロントエンド**: `frontend/src/hooks/useAnalysis.ts`（`AnalysisSpec` 変更で再取得）と `AnalysisScreen.tsx`（価格・累積・ローリングボラを Recharts 折れ線、相関をヒートマップ表で表示。頻度切り替え、取得済み資産のみ対象）。`src/api/client.ts` の `getAnalysis` / `analysisQuery`。

## 7. 最適化・バックテスト（最適化サービス・最適化 API・バックテストは実装済み）

### 7.1 最適化サービス（`app/optimization/`・実装済み）

- **`app/optimization/service.py`**: HTTP・DB に依存しない純粋な計算層。`static_allocation(prices, params, *, benchmark=None) -> OptimizationResult` を提供（静的エイリアス `optimize`）。入力は **price 系列**（列=資産、行=日次調整済み終値）。`returns_data=False` を貫き、リターン系列と混同しない。ルックアヘッド回避（リバランス時点より後を使わない）は**呼び出し側で保証された入力 series を前提**とし、サービス自体は時系列スライスを行わない。
- **`rebalance_allocation`（再最適化・実装済み）**: `app/optimization/service.py::rebalance_allocation(prices, params, asset_ids, rebalance_frequency) -> (weights_by_exec, warnings)`。各シグナル日（D/W/M/Y の最終観測日）まで `prices.loc[:sig]` にスライスして `static_allocation` を実行し、`clean_weights` を実行日（=翌観測日）のターゲットにする。**スライスによりシグナル日以降のデータを使わないためルックアヘッドを構造的に回避**（`static_allocation` はスライスしない設計を維持）。最適化失敗時点はスキップし**直前のウェイト継続＋日本語警告**（ユーザー決定）。対象資産は `asset_ids` で指定（保存済み最適化の再現パラメータから渡す）。
- **`app/schemas/optimization.py`**: `StaticAllocationParams`（入力）と `OptimizationResult`（結果）の型契約。
  - 入力: `optimization_method`（max_sharpe / min_volatility / efficient_risk / efficient_return）、`expected_return_method`（mean_historical_return / capm_return / ema_historical_return / **black_litterman**）、`covariance_method`（sample_cov / semicovariance / ledoit_wolf）、`risk_free_rate`、`annualization_factor`（既定252）、`weight_bounds`（既定0–1）、`asset_weight_bounds`（資産別上書き）、`target_return` / `target_volatility`（手法に応じ必須）。
  - **Black-Litterman 入力**（`expected_return_method="black_litterman"` のときのみ使用）: `bl_market_weights`（**市場ポートフォリオのウェイト**（資産ID→比率、合計 1。省略時は既定 `DEFAULT_MARKET_WEIGHTS`））、`bl_views`（**絶対ビュー**（年率期待リターン（r_f込み）の水準。資産ID→率））、`bl_view_confidences`（ビュー確信度 0–1）、`bl_omega_method`（default / idzorek）、`bl_tau`（既定 0.05）、`bl_risk_aversion`（省略時は市場ポートフォリオのリターンから逆算）。
  - 結果: **生ウェイト `weights`（丸め前）＋表示用 `clean_weights`（丸め後）を併記**。`metrics`（年率リターン・年率ボラ・Sharpe・**個別資産の年率リターン `asset_returns`・年率ボラ `asset_volatilities`**）、`params`、`warnings`。`asset_returns`/`asset_volatilities` は最適化に使った推定（`mu`・`sqrt(diag(sigma))`）から算出し、選択した期待リターン方式・共分散方式と一致する。CLAUDE.md「重みは丸める前の値を保存し、表示用に丸める」に従う。
- **入力検証・エラー方針**: 空データ・非正価格（0以下）・観測不足（2時点未満）・資産不足（2資産未満）・ベンチマーク欠如（capm）は、握りつぶさず `OptimizationInputError`（日本語メッセージ、内部例外は `origin` に保持）で返す。solver 失敗（`OptimizationError`）も制約矛盾・データ不足・推定不安定として説明可能なエラーに変換。NaN は全列 NaN 行の除外（警告）と、中途欠損は PyPortfolioOpt 内部の前fill（警告）で扱い、値自体を推測補完しない。
- **推定**: `expected_returns.mean_historical_return` / `capm_return`（ベンチマークは Series→DataFrame 化して渡す、`returns_data=False`）/ `ema_historical_return`、`risk_models.sample_cov` / `semicovariance` / `CovarianceShrinkage.ledoit_wolf()`。
- **Black-Litterman（実装済み）**: `expected_return_method="black_litterman"` のときは `_compute_black_litterman`（`app/optimization/service.py`）で **先行情報 Π と事後分布 μ/Σ** を計算し、`static_allocation` の `mu`・`sigma` へそのまま流す（その後は既存の Efficient Frontier 構築・目的関数・ウェイト算出を利用）。
  - **市場均衡の先行情報**: `Π = δ·Σ·w_mkt + r_f`（`bl_risk_aversion` 未指定時は `δ = (E[r_p] - rf) / Var[r_p]` を市場ポートフォリオのリターン系列から逆算）。
  - **ビュー**: `absolute_views`（絶対ビュー、**年率期待リターンの水準（r_f 込み）**）のみ対応。相対ビュー（P/Q 行列）は未実装。**入力値は r_f を含む絶対水準として扱う**（例: r_f=1%、資産の年率リターン見込み 5% なら `0.05` を渡す。超過リターンの場合は `0.04` ではない）。これは PyPortfolioOpt の `market_implied_prior_returns` が Π に `+ r_f` する実装と整合させた設計判断（UI・ドキュメントにも明記）。
  - **ω**: `bl_omega_method` で `default`（分散に比例。**τ は結果に影響しない**＝ PyPortfolioOpt の `default_omega = τ·P·Σ·Pᵀ` と分子の `τ·Σ·Pᵀ` が打ち消し合う仕様）／`idzorek`（ビュー確信度から算出。τ の効果が現れる）。
  - **市場ポートフォリオ＝ユーザー指定ウェイト合成**。個別 ETF の時価総額（AUM）は使わない。省略時は既定値（`DEFAULT_MARKET_WEIGHTS`）で米国株式 22.88% / 米国債券 21.40% / 除く株式 23.73% / 除く債券 31.98%（時価総額 126.7/145.1 兆USD と株式/債券配分から合成）。
  - **リバランス時**: 市場ウェイト・ビューは全シグナル日で**固定値**（時価総額の時間変化は反映しない）。`bl_risk_aversion=None`（自動逆算）は slice 序盤の観測不足で失敗しうるが、`rebalance_allocation` の「直前ウェイト継続＋警告」でフォールバックする。
  - **誤差・前提**: ビュー・τ・市場ウェイトは投資家の主観入力。将来成果・「最適」を保証しない。
- **再現性**: 入力期間・使用データ・推定方法・全パラメータ・目的関数・結果・警告・設定・データバージョン・コードバージョン・実行時刻を保存。固定データの未来部分を変更しても過去のバックテスト結果が変わらないことを検証するテストを用意する（再最適化時も `tests/test_backtest.py` で検証済み）。
- 高い成績を「最適」や「将来も有効」と表現しない。

### 7.2 最適化 API（`POST /api/optimizations`・実装済み）

- **役割**: `static_allocation` へ配線する同期エンドポイント。リクエストには最適化パラメータ（`StaticAllocationParams`）に加えて `asset_ids` と `start`/`end`（期間）をフラットに足した `OptimizationRequest`（`app/schemas/optimization.py`）を受け取る。
- **ルックアヘッド回避**: `static_allocation` 自体は時系列スライスを行わないため、**`start`/`end` 入力で使用する価格期間を呼び出し側が決めて将来データ混入を排除**する。既定は全期間。
- **入力データ**: `load_price_matrix`（`route_helpers.py`）で複数資産の adjusted_close 行列を整列。
- **エラー方針**（400・日本語）:
  - 未取得・期間外の資産がある場合、資産集合が揃って初めて最適化が成立するため**除外せず 400**（「データが未取得の資産があるため最適化を実行できません: …」）。
  - 指定期間に価格データが無い場合も 400。
  - `OptimizationInputError`（データ不足・制約矛盾・非正価格・達成不能な目標値など）は `str(exc)` をそのまま `HTTPException(detail=...)` へ変換（ユーザーに理解可能な日本語のまま顕在化）。
- **警告の連結**: ルート層で検出した欠落行情報（`load_warnings`）をサービス層の `warnings` の先頭に連結して UI に返す。
- **テスト**: `tests/test_optimizations_api.py`（14件）が成功系・400 系（未取得資産・期間外）・期間指定・422・**BL**（成功・市場ウェイト合計・τ 不正・ビュー対象外・市場ウェイト不整合）を検証。

### 7.3 バックテスト（固定ウェイト・実装済み）

- **方針（ユーザー決定）**: リバランス配分は**固定ウェイト**（既定）または**再最適化**（`reoptimize=True` で比較一覧の保存済み最適化アルゴリズムを使う）を選択できる。実装はエンジン + 同期 API + 画面（GUI）の3層で完結。
- **エンジン** `app/backtest/engine.py`: `run_backtest(prices, params, *, currency="", weights_by_exec=None) -> BacktestResult`。HTTP・DB 非依存の純粋計算。`BacktestInputError(ValueError)`（message + origin）でエラーを表現。
  - **入力**: 価格行列（列=資産、行=日次 adjusted_close、DatetimeIndex）。全資産が有効価格を持つ観測日のみに絞る（NaN 行は除外し警告。推測補完しない）。
  - **リバランス**: 約定日 = **シグナル日の翌観測日**（次営業日約定）。シグナル日は D では全観測日（初日除く）、W/M/Y では各期間（週/月/年）の最終観測日（`pd.Grouper` の pandas 既定アンカー、`resample_*` と同じ規則）。初日 t0 は初期投資（リバランスではない）。**ルックアヘッド回避は「シグナル日で確定 → 翌観測日約定」の構造で保証**され、未来データ混入検知テスト（`tests/test_backtest.py`）で検証する。
  - **再最適化**: `weights_by_exec`（実行日→ターゲットウェイト）を渡すと各実行日で異なるターゲットへリバランスする（固定ウェイトは省略で従来挙動）。実行日に対応するウェイトが無い時点は**直前のウェイトを継続**してリバランスしない（再最適化失敗時と同じ継続ロジック）。
  - **売買コスト**: `cost_rate`（両建てレッグ通貨ベース）。各リバランスで `delta_value = target - market_value`、`fee = cost_rate*Σ|delta|`。初期アロケーションにも同率賦課し取引一覧に記録。
  - **評価指標**（`BacktestMetrics`・年率換算 `annualization_factor` 注入）:
    - cumulative_return = `equity_end / initial_capital - 1`・annual_return = `annualize_return(geometric)`
    - annual_volatility = `annualize_volatility`（std(ddof=1)×√factor）
    - sharpe = `(annual - rf) / annual_vol`・sortino = `(annual - rf) / downside_dev`（downside_dev = √mean(min(r,0)²)×√factor）
    - calmar = `annual / |max_drawdown|`・max_drawdown = `min(equity/equity.cummax()-1)`（負値）
    - win_rate = `count(r>0)/count(|r|>1e-12)`・turnover = 年率回転率（0.5×Σ|delta|/V の通算を年数で除算）・total_fees
    - **未定義（観測不足・ゼロ除算）は `null`**（`float | None`）。フロントでは「—」表示。
- **lookback**: `BacktestParams` に保持（既定 252・`ge=1`）し params echo に含めるが、固定ウェイトでは**エンジンは未使用**（再最適化の学習窓としては現状「開始日/データ冒頭からリバランス日まで」を採用し、lookback は将来の予約パラメータ）。UI には表示しない。
- **再最適化ロジック** `app/optimization/service.py::rebalance_allocation`: 各シグナル日 `s` まで `prices.loc[:s]` にスライスして `static_allocation` を実行し、`clean_weights` をその実行日のターゲットにする。**スライスによりシグナル日以降のデータを使わないため、ルックアヘッドを構造的に回避**する（`static_allocation` は内部で時系列スライスしない設計を維持）。最適化に失敗（データ不足・達成不能な目標値）した時点はスキップし、**直前のウェイトを継続**＋日本語警告を積む（ユーザー決定）。
- **スキーマ** `app/schemas/backtest.py`: `BacktestParams`（weights / rebalance_frequency / initial_capital / cost_rate / risk_free_rate / annualization_factor / lookback / **reoptimize** / **optimization_params**）・`BacktestRequest`（asset_ids/start/end 継承・`model_validator` で weights キー=asset_ids・`reoptimize=True` では `optimization_params` 必須）・`BacktestMetrics`（`float | None`）・`EquityPoint`・`Trade`・`AllocationPoint`・`YearlyPerformance`・`BacktestResult`（params echo・warnings・**rebalance_weights**）。
- **API** `app/api/routes/backtests.py`: `POST /api/backtests` 同期。`load_price_matrix` で価格行列（未取得資産は 400 で明示）→ `reoptimize=True` なら `rebalance_allocation` で `weights_by_exec` を構築（最適化対象資産が未取得なら 400）→ `run_backtest` → `BacktestInputError` は 400（日本語）。スキーマ検証違反（ウェイト合計・キー不一致）は 422。
- **GUI** `frontend/src/pages/BacktestScreen.tsx`: 対象資産（**最適化と同じ multi-select ドロップダウン**・取得済みのみ）・資産ごと固定ウェイト（number input・合計をリアルタイム表示）・リバランス頻度（日次/週次/月次/**年次**）・初期資金・コスト率・リスクフリー金利・期間・**再最適化元の最適化（比較一覧から選択）**・**リバランス時に再最適化チェック**を入力。結果表示は評価指標表（`null` は「—」）・累積資産折れ線・ドローダウン折れ線・年次成績表・配分推移折れ線・**リバランス時の採用ウェイト表（再最適化時）**・取引一覧（直近200件）・params echo・免責表示（Recharts・`.opt-form`/`.result-table`）。
- **テスト**: `tests/test_backtest.py`（20件: 単一/2資産・次営業日約定・コスト/回転率・指標手計算・**バイアス検知**（未来データ変更で過去 equity/drawdown/trades が不変・再最適化時も）・中途終了が全期間の prefix・年次頻度・再最適化の採用ウェイト/失敗時継続・エラー/警告/null）・`tests/test_backtests_api.py`（13件: 200・JSONにNaN無し・400・422・年次・再最適化・BL 再最適化）・`BacktestScreen.test.tsx`（14件）。
- **既知の制約**: 「実行結果の再現可能な保存」（スナップショット・コードバージョン永続化）は今回スコープ外。params echo と固定データにより手動再現は可能。runs/jobs への配線は未実施（メモリ内プレースホルダーのまま）。

## 8. API 設計（初期スケジュール）

実装済み: `GET /api/health`、`GET /api/assets`、`GET /api/data/series`、`GET /api/data/analysis`、`POST /api/optimizations`、`POST /api/backtests`（詳細は §6.7 / §6.8 / §7.2 / §7.3、スキーマは `app/schemas/` の Pydantic モデルで定義。OpenAPI は実装の契約として扱う）。

骨格のみ（実処理は未配線）: `POST /api/jobs`、`GET /api/jobs/{job_id}`、`POST /api/jobs/{job_id}/cancel`、`GET /api/runs/{run_id}`、`GET /api/runs/{run_id}/equity-curve`、`GET /api/runs/{run_id}/trades`。

初期版の公開範囲は **localhost 利用のみ**。ネットワーク公開時は認証・認可、CORS許可元、レート制限、APIキーの秘密管理、入力サイズ制限、監査ログを設計してから有効化する。

## 9. GUI 画面（初期6画面）

1. **データ**（実装済み）: 4資産の候補・データソース・期間・欠損・取得日時・価格種別を確認（series_type / frequency 選択、系列折れ線）
2. **分析**（実装済み）: 価格推移・累積リターン・ローリングボラティリティ・相関ヒートマップ（frequency D/W/M 切り替え、取得済み資産のみ対象）
3. **最適化**（実装済み）: 手法・期待リターン（BL 除く）・共分散・期間・制約・リスクフリー金利 → ウェイト・期待利得・リスク・Sharpe（`POST /api/optimizations` 配線）
4. **最適化（BL）**（実装済み）: Black-Litterman 専用フォーム（市場ポートフォリオ・絶対ビュー・確信度・ω・τ・リスク回避度。期待リターンは black_litterman 固定・共分散は選択可能）。結果は `kind:'optimization'` で保存されバックテストの再最適化元にも選択可
5. **バックテスト**（実装済み）: 対象資産・固定ウェイト・リバランス頻度・初期資金・コスト率 → 累積資産・ドローダウン・年次成績・配分推移・取引一覧（`POST /api/backtests` 配線）
6. **比較・保存**（実装済み）: 最適化・バックテストの実行結果を「比較に追加」でグローバル保持（`CompareContext`、最大50件・メモリ保持）し、比較画面で種別ごとの指標比較（最良値強調・null は「—」）・ラベル編集・削除と、JSON（実行結果一式）/ CSV（指標比較表）エクスポートができる

各画面で、使用したデータスナップショット・通貨方針・シグナル日/約定日規則・警告を結果の近くに表示する。

## 10. 品質管理

- backend: pytest / ruff / mypy（strict）/ pandas-stubs。`pyproject.toml` + `uv.lock` で固定。
- frontend: ESLint / Prettier / TypeScript（strict）/ vitest + Testing Library。`package-lock.json` をコミット。
- 重要な計算は固定データによる再現可能テストを持つ。外部データへ依存するテストは固定保存データを使い、ネットワーク依存テストと分離する。
- 再現性テスト: データスナップショット・依存関係・設定JSONのハッシュを使う（後続）。

## 11. 未確定事項（後続工程で確定）

| 事項 | 現在の状態 | 確定までの作業 |
| --- | --- | --- |
| 実データソース/プロバイダー | **Yahoo Finance chart API（query2）採用** | 取得間隔・非商用利用の遵守。代替プロバイダー追加はアダプターで対応 |
| 4資産の既定ティッカー | **VTI / AGG / VXUS / IAGG（Yahoo 取得で確認済み）** | コードに固定せず設定で変更可能（`assets.default.json`） |
| `ex_us_bond` の対象指数・為替方針 | IAGG（USD建て・unhedged）。2015年設立のため履歴は 2015-11〜 | 国際債券ETFの為替ヘッジ有無と対象指数を確認 |
| 履歴長・共通履歴開始日 | 実取得時の meta.firstTradeDate / regularMarketTime で確認可能 | fetch 実行後に決定し画面表示 |
| 最適化実ロジック | **実装済み**（`app/optimization/`・`static_allocation`・`rebalance_allocation`。固定値テストで検証）。**API 配線済み**（`POST /api/optimizations`）・**最適化画面（GUI）実装済み**・個別資産リターン/リスクも結果に含む | 互換性表 |
| バックテスト実ロジック | **実装済み**（`app/backtest/engine.py`・固定ウェイト＋再最適化。`POST /api/backtests`・`BacktestScreen` 配線済み） | 実行結果の永続化 |
| 年率換算・カレンダー規則の詳細 | **実装済み**（`app/domain/returns.py`＋固定値テスト。年率リターンは geometric 既定、年率ボラティリティは `std(ddof=1)×√factor`、`factor=252` 引数注入） | 週次 `'W'` のアンカーと週次複利の偶発的欠損の扱い |
| バックテスト指標の詳細定義 | **実装済み・記録済み**（§7.3 に数式を固定。Sharpe/Sortino/Calmar 分母・ゼロ除算は null で表現） | 変化なし |
| 過去データの将来変更要テスト（バイアス検査） | **実装済み**（`test_backtest.py` の `test_future_price_change_does_not_alter_past_results`・`test_truncated_run_is_prefix_of_full_run`） | 変化なし |

## 12. 決定履歴

- **2026-08-08** — 初版。全体ひな型（骨格）を構築し設計判断を記録。uv（依存管理）/ Recharts（グラフ）/ npm（frontend パッケージ）を採用。4資産の既定ティッカーを仮確定（VTI / BND / VXUS / BNDX）、`portfolio_base_currency=JPY`・`fx_policy=unhedged` を確定。公開範囲は localhost 限定。最適化・バックテスト本体は未実装（スタブ）。
- **2026-08-08** — データ取得フェーズ。Yahoo Finance chart API（query2）を実データソースとして採用（query1=429、stooq は proof-of-work で不可）。データ取得 CLI（`app.cli fetch` / `export-csv`）を実装。raw/processed の分離・raw スナップショットハッシュ・fetch_history 記録を追加。Yahoo ToS（非商用・研究利用限定）と Adjusted Close / 分配金の扱いを記録。API ジョブ／GUI への配線は本フェーズでは行わない。
- **2026-08-08** — リターン計算・年率換算フェーズ。`app/domain/returns.py` を新設（単純／対数／累積リターン・年率換算・年率ボラティリティ・頻度リサンプリング）。累積・年率は時間加重を採用。年率リターンは geometric 既定（arithmetic は PyPortfolioOpt `mean_historical_return` 互換）。欠損は補完せず NaN を返し、空系列は例外を投げない。`normalize_prices` 後の価格 series を入力とし、HTTP 配線（`/api/data/series`）はデータ表示 GUI フェーズで後続。固定値テスト（`tests/test_returns.py`）で既知の数値例と照合。
- **2026-08-08** — データ確認 GUI 第1弾（フロントエンド データ画面＋系列 API 配線）。`GET /api/data/series` を processed Parquet へ配線し（series_type=adjusted_close/price/return/cumulative、frequency=D/W/M、NaN は JSON 配線で除外、未取得は警告＋空）、`GET /api/assets` に `data_status` を合成（`AssetDataStatus`／`summarize_series`／`snapshot_hash` 連携）。`resample_prices` を `app/domain/returns.py` に追加。フロントエンドにデータ画面（資産一覧表＋系列グラフ、series_type/frequency 選択式）を実装。**分析画面・最適化・バックテスト・`/api/jobs` からの data_fetch 配線は引き続き未実装**。
- **2026-08-08** — 最適化サービスと単体テスト（PyPortfolioOpt）。`app/optimization/service.py` に純粋計算層の `static_allocation`（HTTP・DB 非依存、price 系列入力・`returns_data=False` 貫通、静的エイリアス `optimize`）を実装。`app/schemas/optimization.py` に入出力の型契約（`StaticAllocationParams`／`OptimizationResult`：生ウェイト `weights`＋表示用 `clean_weights` を併記）。手法（max_sharpe / min_volatility / efficient_risk / efficient_return）、期待リターン（mean_historical_return / capm_return / ema_historical_return）、共分散（sample_cov / semicovariance / ledoit_wolf）を選択可能。入力検証・solver 失敗は握りつぶさず `OptimizationInputError`（日本語・`origin` 保持）で返す。固定データの単体テスト（`tests/test_optimization.py`、合計・上下限・既知解・手法同値・エラー系）を追加。**rebalance_allocation 分離・互換性表・最適化 UI/API 配線、バックテストは引き続き未実装**。
- **2026-08-09** — 分析 API（`GET /api/data/analysis`）と最適化 API（`POST /api/optimizations`）を実装。`app/domain/returns.py` に `rolling_volatility`（移動年率ボラ）と `correlation_matrix`（ピアソン相関）を追加。`app/api/route_helpers.py` に `load_price_matrix`（複数資産の価格行列を外側 union で整列・未取得を警告化）を新設し、両ルートで共用。スキーマは `app/schemas/analysis.py` / `app/schemas/optimization.py`（`OptimizationRequest`）。フロントエンドは `useAnalysis` フックと分析画面（価格・累積・ローリングボラの折れ線＋相関ヒートマップ、frequency 切り替え、取得済み資産のみ）を実装。最適化は同期エンドポイントとして配線（`start`/`end` でルックアヘッド回避）、エラーは 400＋日本語。テスト `tests/test_analysis_api.py`（8件）・`tests/test_optimizations_api.py`（9件）。**最適化画面（GUI）・rebalance_allocation・バックテスト・data_fetch 配線は引き続き未実装**。
- **2026-08-09** — バックテスト（固定ウェイト）を実装（ユーザー決定: リバランス配分は固定ウェイトのみ・エンジン+API+画面を一気通貫）。`app/backtest/engine.py` の `run_backtest(prices, params, *, currency)` を実装し、`BacktestInputError`（日本語・origin 保持）でエラーを表現。**ルックアヘッド回避は「約定日=シグナル日の翌観測日」の構造で保証**し、バイアス検知テストで検証。評価指標（累積/年率リターン・ボラ・Sharpe/Sortino/Calmar・最大DD・勝率・回転率・手数料）は未定義を `null`（`float | None`）で返す。`app/schemas/backtest.py`（`BacktestParams`/`BacktestRequest`/`BacktestMetrics`/`EquityPoint` 等）と `POST /api/backtests`（`app/api/routes/backtests.py`）を新設。GUI は `BacktestScreen.tsx`（資産・固定ウェイト・リバランス頻度・初期資金・コスト入力と、累積資産/ドローワウン/配分推移の折れ線・指標表・年次成績・取引一覧・免責表示）。テスト: `test_backtest.py`（16件・バイアス検知含む）・`test_backtests_api.py`（8件）・`BacktestScreen.test.tsx`（5件）。「実行結果の再現可能な保存」は params echo で手動再現可能だが永続化（スナップショット・コードバージョン）は未 Scope、runs/jobs 配線も未実施。

- **2026-08-10** — 比較・保存画面を実装（ユーザー決定: 保存は「フロント保持+エクスポート」。バックエンド runs 永続化はスコープ外）。`frontend/src/compare/`（`types.ts`・`CompareContext.tsx`・`export.ts`・`indicators.ts`）と `CompareScreen.tsx` を新設し、`App.tsx` の画面全体を `CompareProvider` で包んで実行結果をグローバル保持（最大50件・メモリ保持・ページ再読込で消失）。最適化・バックテスト画面に「比較に追加」ボタンを追加。比較画面は種別ごとに指標比較表（最良値を強調表示、`null` は「—」）、ラベル編集・削除、JSON（実行結果一式）/ CSV（指標比較表・横持ち）エクスポート（Blob ダウンロード）を実装。免責文（保存はブラウザ内のみ・将来の成果を保証しない）を UI に併記。テスト `CompareScreen.test.tsx`（6件）＋既存 `OptimizationScreen`/`BacktestScreen`/`App` テストを Provider 込みに更新（全25件 green）。
- **2026-08-10** — リターン/リスク表示と `efficient_return` の限界調査。`app/domain/returns.py` に `ema_annual_return`・`sharpe_ratio`・`return_stats` を追加し、`GET /api/data/analysis` の `stats` フィールド（`AssetStats`）として資産ごとの平均/EMA 年率リターン・年率ボラ・シャープを返すようにした（リスクフリー金利は既定 0.0・UI に明示）。分析画面に統計表を追加。最適化画面は選択中リターン方式（平均/EMA）を日本語ラベルで明示し、`efficient_return` の限界値についてヒントを追加。
- **`efficient_return` の限界挙動（調査結論）**: PyPortfolioOpt の `efficient_return` は min-vol を目的関数とし、`ret >= target_return` の**不等式制約**で解く。上限判定 `_max_return_value` は「weight_bounds 内で単一資産に全振りしたときの最大期待リターン」で、これを超えると `ValueError`（日本語 400 に変換）。対象が単一資産 100% になるのは目標リターンが `_max_return_value` に**等しい場合のみ**で、わずかに下回ると min-vol 目的のため分散的に複数資産へ逃げる。実データ（EMA）では `ex_us_equity`（VXUS）の EMA 期待リターン ≈ 0.2559 が最大で、0.255 では VXUS/VTI に分散する（これが観察された挙動）。これはエンジンの正しい限界であり、回避策として限界値を UI に明示した（将来は上限バリデーションや上限値の事前表示を検討）。
- **2026-08-10** — 既定ティッカーを変更（ユーザー指示）。米国債券 `BND`→`AGG`（iShares Core U.S. Aggregate Bond、同一 Bloomberg US Agg Index、2003-09〜・5751行）、米国を除く債券 `BNDX`→`IAGG`（iShares Core International Aggregate Bond、同一 Bloomberg Global Agg ex-USD Index、USD建て・unhedged を継続）。Yahoo chart API で取得可能性・データ品質（欠損0・重複0）を確認後、`assets.default.json` を更新し `fetch` で再取得。全機能（assets / series / analysis / optimizations / backtests）を統合テストで確認（すべて 200、最適化・バックテストの指標は意味のある値）。**`ex_us_bond` の履歴は 2013-06（BNDX）→ 2015-11（IAGG）に短縮**（IAGG は2015年設立のため）。これは機能の欠落ではなく利用可能期間の変化。「4資産を揃えた分析・最適化」は2015年以降に限定される点に注意。
- **2026-08-15** — バックテスト・最適化画面を拡張（6要件）。①バックテストの対象資産選択を最適化と同じ multi-select ドロップダウンに統一。②最適化画面の `efficient_return` の「目標リターンは最適化に使う…」説明文を削除（目標値入力は残す）。③最適化結果に個別資産の年率リターン/リスクを追加（`OptimizationMetrics` の `asset_returns`/`asset_volatilities`、最適化に使った `mu`・`sqrt(diag(sigma))` から算出）し、最適化画面に資産別統計表を表示。④保存済み最適化（`StoredResult.request` に `OptimizationRequest` を保持）をバックテストから選択して呼び出し可能に。⑤リバランス頻度に年次（`Y`、年度末シグナル・翌観測日約定）を追加。⑥「リバランス時に再最適化」チェックで `rebalance_allocation`（各シグナル日まで `prices.loc[:sig]` スライス）により再最適化。失敗時は**直前ウェイト継続＋日本語警告**（ユーザー決定）。`_simulate` を実行日→ウェイト（`weights_by_exec`）対応に拡張し、`BacktestParams` に `reoptimize`/`optimization_params`、`BacktestResult` に `rebalance_weights` を追加。再最適化時もルックアヘッド検査テストで検証。バックテストのエンジン・スキーマ・API・GUI・テスト（backend 145件・frontend 32件 green）を更新。
- **2026-08-16** — Black-Litterman 期待リターン推定を実装（`expected_return_method="black_litterman"`）。ユーザー決定: ①市場ポートフォリオは**ウェイト（割合）で入力**（時価総額ではなく。デフォルト = 米国株式 22.88% / 米国債券 21.40% / 除く株式 23.73% / 除く債券 31.98%。時価総額 126.7/145.1 兆USD と株式/債券配分から合成を scheme の `DEFAULT_MARKET_WEIGHTS` に定数化）、②ビューは**絶対ビュー（年率期待リターン（r_f込み）の水準）のみ**、③フルスコープ（backend+frontend+test+docs）。`_compute_black_litterman`（`app/optimization/service.py`）を新設し、先行情報 Π=δ·Σ·w_mkt+rf（`bl_risk_aversion` 省略時は市場ポートフォリオのリターンから逆算）、絶対ビュー、ω=default/idzorek、τ を `BlackLittermanModel` に流して事後 μ/Σ を算出。ビュー 0 件は市場均衡に一致（PyPortfolioOpt は空ビュー非対応のため専用分岐で μ=Π・Σ を返す）。スキーマに `bl_*` フィールド＋validator（τ 範囲・リスク回避度正・確信度 0-1・市場ウェイト合計≈1・ビュー対象が選択資産内）を追加。フロントは最適化画面に BL 条件フォーム（市場ウェイト・ビュー・ω/τ/リスク回避度）とデフォルト値表示。**`omega="default"` では τ は結果に影響しない**（PyPortfolioOpt の `default_omega` と事後式の分子が打ち消し合う仕様）ことをテストで検証し明記。backend テスト +6件（test_optimization）、+5件（test_optimizations_api）、+1件（test_backtests_api へ BL 再最適化）、frontend テスト +5件（OptimizationScreen）を追加。
- **2026-08-17** — BL の表記・UX を統一（実装ロジックは不変）。①BL 絶対ビューの説明を「年率期待超過リターン」から「**年率期待リターン（r_f込み）の水準**」へ統一（UI/README/docs、PyPortfolioOpt の `market_implied_prior_returns` が Π に `+r_f` する実装と整合）。具体例（r_f=1% で 5% 見込みなら「5」、超過 4% ではない）を UI ヒントと docs に明記。②BL ω=idzorek でビューのある資産に確信度が未入力のまま実行する失敗を UX 改善（クライアント検証を強化し、未入力資産名を明示した日本語エラーを表示。確信度 0 は弱いビューとして許容）。テスト +2件（OptimizationScreen）。
- **2026-08-22** — **最適化画面をタブ分割**（ユーザー指示）。ヘッダーナビを6タブ化し、**「最適化」と「最適化（BL）」を分離**。最適化タブは `git show 09a6b61^` を使って BL 追加前の状態へ戻し（BL 機能を全て削除・期待リターン選択肢から black_litterman を除外）、新設の最適化（BL）タブは `BlOptimizationScreen.tsx` として BL 専用フォームを提供（**期待リターンは black_litterman 固定・共分散は選択可能**）。BL 結果は従来どおり `kind:'optimization'` で保存されるため、バックテストの「再最適化元の最適化」（`kind==='optimization'` フィルタ）で BL 結果も選択可能（compare/types・indicators・BacktestScreen は無変更）。テスト: `OptimizationScreen.test.tsx`（7件）・`BlOptimizationScreen.test.tsx`（7件・固定化検証含む）・`App.test.tsx`（タブ切替 +1件）。backend は変更なし。
