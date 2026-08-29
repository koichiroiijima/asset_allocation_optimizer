# 実装進捗（TODO）

このファイルはアセット配分最適化アプリの実装進捗を追跡する。実装状況の詳細（設計判断・決定履歴）は [`design.md`](design.md)、利用方法は [`README.md`](../README.md)、進め方の指針は [`CLAUDE.md`](../CLAUDE.md) を参照。

最終更新: 2026-08-29

## 凡例

- [x] 完了
- [~] 進行中（部分的に完了）
- [ ] 未着手

---

## 基盤

- [x] プロジェクト構造（backend / frontend / data / outputs / docs）
- [x] Pydantic Settings による設定管理（`ASSET_ALLOC__*`、.env、validate_settings）
- [x] データレコードと repository 抽象（Parquet + SQLite 索引 + スナップショットハッシュ）
- [x] FastAPI API 骨格（health / assets / series / analysis / optimizations / backtests / jobs / runs）+ OpenAPI スキーマ
- [x] フロントエンド6画面の骨格 + Header / HealthCheck
- [x] テスト基盤（backend: ruff / mypy strict / pytest、frontend: ESLint / Prettier / tsc / vitest）

## データ取得（Yahoo Finance）

- [x] Yahoo Finance chart API（query2・ブラウザUA付与）採用（query1=429・stooq 辞退の比較記録）
- [x] データ取得 CLI（`app.cli fetch` / `export-csv`）
- [x] fetch → raw → normalize → processed → export-csv パイプライン
- [x] raw / processed の分離、raw スナップショットハッシュ連携
- [x] SQLite の fetch_history 記録・資産単位の失敗隔離
- [x] 4資産の既定ティッカー取得確認（VTI / AGG / VXUS / IAGG、USD）
- [ ] `price_max_staleness_days`（陳腐化更新の警告・取引停止）— 設定値のみ定義、適用は未実装
- [ ] `/api/jobs` からの data_fetch 配線（GUI/API からの取得は未接続、CLI のみ）
- [ ] レート制限対応・取得失敗時の再試行・データ品質警告

## リターン計算・年率換算

- [x] `app/domain/returns.py`: 単純／対数／累積リターン
- [x] 年率リターン（geometric 既定）・年率対数リターン・年率ボラティリティ
- [x] 頻度リサンプリング（`resample_returns`・`resample_prices`、頻度 D/W/M）
- [x] 欠損方針（補完しない、空系列は例外を投げない）
- [x] 固定値テスト（`tests/test_returns.py`）
- [x] `resample_prices`（価格系列の D/W/M 集約、リターン系は `resample_returns` で複利合成）
- [x] ローリングボラティリティ（`rolling_volatility`、移動年率ボラ・窓 2 以上を検証）
- [x] 相関行列（`correlation_matrix`、ピアソン相関・ペアごとに観測で NaN 除外）
- [x] リターン統計（`return_stats`・`ema_annual_return`・`sharpe_ratio`。平均/EMA 年率リターン・年率ボラ・シャープ。分析 API の `stats` に配線）

## データ確認 GUI（第1弾）

- [x] `GET /api/data/series` を processed Parquet へ配線（series_type / frequency / NaN 除外 / 未取得警告）
- [x] `GET /api/assets` に data_status 合成（`AssetDataStatus` / `summarize_series` / snapshot_hash）
- [x] フロントエンド データ画面（資産一覧表＋系列グラフ、series_type / frequency 選択式）
- [x] データ画面のテスト・API クライアントテスト

## 最適化（static_allocation・最適化 API・最適化画面 実装済み）

- [x] PyPortfolioOpt 最適化サービスと単体テスト（`static_allocation`）
- [x] 最適化 API ルート配線（`POST /api/optimizations` 同期エンドポイント＋API テスト、`OptimizationRequest` の `start`/`end` でルックアヘッド回避）
- [x] 最適化画面・GUI（手法 / 期待リターン / 共分散 / 期間 / リスクフリー金利 / ウェイト上下限の入力と結果表示）— `POST /api/optimizations` を配線、`frontend/src/pages/OptimizationScreen.tsx` + テスト（`OptimizationScreen.test.tsx` 7件）。capm_return はベンチマーク非対応のため選択肢除外、efficient_return/efficient_risk は目標値を条件表示、クライアント側検証でサーバー422に依存しない。
- [x] 最適化タブ分割（**最適化** / **最適化（BL）**）— ヘッダーナビを6タブ化。**最適化タブ**は BL 機能を削除（`OptimizationScreen.tsx`、期待リターン選択肢から black_litterman を除外）。**最適化（BL）タブ**は BL 専用フォーム（`BlOptimizationScreen.tsx`、期待リターンは black_litterman 固定・共分散は選択可能）。BL 結果も `kind:'optimization'` で保存されバックテストの再最適化元に選択可。テスト `BlOptimizationScreen.test.tsx`（7件）・`App.test.tsx`（タブ切替）追加。
- [x] `rebalance_allocation`（リバランス最適化）の実装 — `app/optimization/service.py`。各リバランスシグナル日まで `prices.loc[:sig]` にスライスして `static_allocation` を実行（ルックアヘッド回避）。失敗時は直前ウェイト継続＋日本語警告。バックテスト API の `reoptimize` / `optimization_params` から呼び出し
- [x] 個別資産のリターン・リスク（最適化結果）— `OptimizationMetrics` に `asset_returns` / `asset_volatilities`（最適化に使った `mu`・`sqrt(diag(sigma))` から算出）を追加、最適化画面に資産別統計表を表示
- [ ] 互換性表・入力範囲・既定値のスキーマ共用
- [x] Black-Litterman アロケーションの実装 — `expected_return_method="black_litterman"`（`app/optimization/service.py` の `_compute_black_litterman`）。PyPortfolioOpt 1.6.0 の `BlackLittermanModel` / `market_implied_prior_returns` を利用し、先行情報 Π=δ·Σ·w_mkt+rf と**絶対ビュー**（年率期待リターン（r_f込み）の水準）を合成して事後 μ/Σ を `static_allocation` に渡す。**市場ポートフォリオはユーザーがウェイトで設定可能**（既定: 米国株式22.88% / 米国債券21.40% / 除く株式23.73% / 除く債券31.98%）。`bl_tau`（既定0.05・`omega="default"`では無効）・`bl_omega_method`（default/idzorek）・`bl_risk_aversion`（未指定は市場から逆算）を schema + pydantic validator（τ 範囲・確信度0-1・市場ウェイト合計≈1・ビュー対象が選択資産内）で検証。テスト: ビュー寄与・**τ 独立性**（default_tau では不変）・同値検証（直接 PyPortfolioOpt と一致）・独立な推算一致。フロントは **最適化（BL）タブ**（`BlOptimizationScreen.tsx`）に BL 専用フォーム（市場ウェイト・ビュー・ω/τ/リスク回避度）とデフォルト値表示（ビューは r_f 込みの年率水準。ω=idzorek では確信度未入力の資産を明示して送信前に検証）。backend +12件・frontend +7件のテストを追加（`test_optimization` / `test_optimizations_api` / `test_backtests_api` / `BlOptimizationScreen.test.tsx`）。**相対ビュー（Q/P行列）・`omega="manual"`・時価総額（AUM）入力は未着手（将来拡張）**。

## バックテスト（固定ウェイト実装済み）

- [x] ルックアヘッド回避のバックテストエンジン（`app/backtest/engine.py`・`run_backtest`。約定日=シグナル日の翌観測日で構造的に回避）
- [x] 評価指標（累積/年率リターン・ボラ・Sharpe/Sortino/Calmar・最大ドローダウン・勝率・回転率・手数料。未定義は null）
- [x] シグナル日と約定日の分離（次営業日約定。D は全観測日、W/M/Y は各期間の最終観測日）
- [x] 未来データ混入を検出するバイアス検査テスト（`test_backtest.py`：未来データ変更で過去 equity/drawdown/trades が不変・中途終了が全期間の prefix）
- [x] 年次（Y）リバランス頻度 — `RebalanceFrequency` に `"Y"`（年度末シグナル・翌観測日約定）を追加
- [x] リバランス時再最適化 — `_simulate` を実行日→ウェイト（`weights_by_exec`）対応に拡張。`BacktestParams` に `reoptimize` / `optimization_params`、`BacktestResult` に `rebalance_weights` を追加。再最適化は `rebalance_allocation`（各シグナル日までスライス）で実行し、失敗時は直前ウェイト継続＋日本語警告。ルックアヘッド検査テスト（再最適化時）追加
- [ ] 実行結果の再現可能な保存（スナップショット・設定・コードバージョンの永続化。現状は params echo で手動再現のみ。`/api/runs` 配線も未実施）

  API・GUI 配線: `POST /api/backtests`（`app/api/routes/backtests.py`・スキーマ `app/schemas/backtest.py`）・バックテスト画面（`BacktestScreen.tsx`、累積資産/ドローダウン/配分推移折れ線・指標表・年次成績・取引一覧・免責表示・リバランス時再最適化で採用ウェイト）。対象資産は最適化と同じ multi-select ドロップダウン。テスト `test_backtests_api.py`（13件）・`BacktestScreen.test.tsx`（14件）。

## 画面（分析以降）

- [x] 分析画面（価格推移・累積リターン・ローリングボラ・相関ヒートマップ・リターン/リスク統計表）— `GET /api/data/analysis`（`app/api/routes/analysis.py` / `app/schemas/analysis.py`）を配線、`app/api/route_helpers.py` の `load_price_matrix` で複数資産を外側 union 整列、未取得資産は除外して日本語警告、`frontend/src/hooks/useAnalysis.ts` + `src/api/client.ts` の `getAnalysis` と連携。リターン/リスク統計表（平均リターン・EMA リターン・年率ボラ・シャープ、`analysis.stats`）を追加
- [x] 最適化画面（手法・期間・制約の入力と結果表示）— `POST /api/optimizations` を配線。対象資産（取得済みのみ・複数選択）・手法・期待リターン（capm_return はベンチマーク非対応のため除外。**BL も除外し最適化（BL）タブへ分離**）・共分散・期間・リスクフリー金利・ウェイト上下限・年率換算係数を入力、`efficient_return`/`efficient_risk` では目標値を条件表示。結果に個別資産のリターン/リスク表（`metrics.asset_returns` / `asset_volatilities`）を表示。クライアント側検証（資産2件・ウェイト上下限・目標値必須）と結果表（clean_weights・指標・warnings）を実装。テスト `OptimizationScreen.test.tsx`（7件）付き
- [x] バックテスト画面（固定ウェイト・リバランス頻度・初期資金・コスト入力、累積資産/ドローダウン/配分推移の折れ線・評価指標・年次成績・取引一覧・免責表示）— `POST /api/backtests` を配線。対象資産は最適化と同じ multi-select ドロップダウン。リバランス頻度に年次（Y）を追加。比較一覧の保存済み最適化から**選択するだけで再最適化**（未選択＝固定ウェイト。チェックボックス廃止・選択駆動に変更）。初期資金は小数可（`step="any"`）。再最適化は各シグナル日までで最適化、失敗時は直前ウェイト継続。再最適化時は採用ウェイト表を表示。`BacktestScreen.tsx` + テスト（`BacktestScreen.test.tsx` 9件）
- [x] 比較・保存画面（複数結果の比較、JSON / CSV エクスポート）— `CompareScreen.tsx`・`compare/CompareContext.tsx`（最適化・バックテスト結果を「比較に追加」でグローバル保持、最大50件・メモリ保持）。種別ごとの指標比較（最良値強調・nullは「—」）、ラベル編集・削除、JSON / CSV エクスポート（Blob ダウンロード）。テスト `CompareScreen.test.tsx`（6件）

## 仕上げ

- [ ] E2E 確認・再現手順・サンプル設定の整備
