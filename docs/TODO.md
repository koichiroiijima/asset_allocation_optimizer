# 実装進捗（TODO）

このファイルはアセット配分最適化アプリの実装進捗を追跡する。実装状況の詳細（設計判断・決定履歴）は [`design.md`](design.md)、利用方法は [`README.md`](../README.md)、進め方の指針は [`CLAUDE.md`](../CLAUDE.md) を参照。

最終更新: 2026-10-10

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

## 資産セット（米国モード / 日本モード・円ベース）

- [x] 資産セット（モード）基盤 — `us`（USD基準）/ `jp`（JPY基準）。`AssetId` を8値に拡張、`AssetDefinition.asset_set`、`ASSET_SET_BASE_CURRENCY` を追加
- [x] 設定ファイル分割 — `assets.default.json`（us）/ `assets.jp.json`（jp・全銘柄円建て）。`Settings.asset_mapping_files`（dict）+ `default_asset_set`
- [x] データ取得切替 — CLI `fetch --set us|jp`（`--asset` のみでモード自動判定・混在/不整合はエラー）、`export-csv` は processed 横断
- [x] `GET /api/assets?set={us|jp}`（既定 us・未知名400・`data_status` 合成）
- [x] 円ベース通貨の配線 — 基準通貨を選択資産から導出し、series/analysis/backtests/optimizations（`base_currency`）へ反映
- [x] 分配金補正付き `adjusted_close` の使用保証（最適化・バックテスト・分析）。`distribution` は別途保存、`raw_close` は表示専用
- [x] Yahoo provider の `calendar` 判定（jp/us）
- [x] BL の JP 仮既定市場ウェイト（`DEFAULT_MARKET_WEIGHTS_JP`・仮値警告付き）とフロントの set別既定
- [x] 最小のモード切替 GUI（`AssetSetContext` + Header トグル、`useAssets` の `?set=` 追従、切替時リセット、比較のウェイト列動的化）
- [x] モード切替の永続化・UI 改善 — モードを localStorage に保存し再マウントで復元（不正値・例外時は既定 `us` にフォールバック、`storage` はテスト注入可）。ヘッダーに基準通貨バッジ（USD/JPY）とモード説明文を表示、セグメント型スイッチのスタイル追加（`AssetSetContext.tsx` / `Header.tsx` / `index.css`）
- [x] 実データ取得（`fetch --set jp`）— processed Parquet 取得済み（2017-12〜。E2E の目視確認は継続課題）
- [ ] 汎用 FX 換算レイヤ（外貨建て→基準通貨。今回は対象外）
- [ ] JPモードの資産数を増やす / ユーザー定義資産セット
- [ ] BL の JP 市場ウェイトを実値へ（現状は仮値 `DEFAULT_MARKET_WEIGHTS_JP`・警告表示あり）
- [ ] 共通履歴の扱い改善 — 最適化/バックテストの既定（`start` 未指定）は全履歴の外側 union のため、資産ごとの履歴開始差（JP 共通開始=2017-12-06）が混ざる。**資産別の履歴開始と共通開始の差を UI に明示し、既定 `start` を共通開始に合わせる／共通開始より前の期間なら日本語警告する**改善が未実装

## GUI 刷新（Mantine・サイドバー型・2026-10-10）

- [x] Mantine 8 の導入（`@mantine/core` / `@mantine/hooks` / `@tabler/icons-react`・ライト固定テーマ `src/theme.ts`）
- [x] レイアウトを `AppShell` のサイドバー型へ再構成（`AppShellLayout` / `NavMenu` / `HeaderBar` / `HealthBadge`・6タブは `NavLink component="button"` で button role を維持）
- [x] 共有 UI 部品化（`ui/PageHeader` / `SectionCard` / `ResultCard` / `StatusBadge` / `ErrorNotice` / `OptimizationResult`＝最適化と BL の結果表を共用化、`charts/theme.ts` で系列パレットを一元化）
- [x] 対象資産の複数選択を multi-select から **`Checkbox.Group`（チェックボックス式）** へ変更（未取得は disabled＋「（未取得）」維持）
- [x] 単一選択を `NativeSelect`・数値入力を `TextInput type="number"`（`step="any"` 維持）・日付を `TextInput type="date"` に統一
- [x] `index.css` の最小化（`color-scheme: light dark` の不整合・未定義 `.health-error` の解消）と `.prettierignore`（`dist/`）追加
- [x] テスト基盤（`tests/setup.ts` に Mantine 用 jsdom モック・`tests/test-utils.tsx` の MantineProvider 付き render）と全テストを新契約へ更新（frontend 57 件 green）
- [ ] 開発サーバー実機でのブラウザ目視確認（環境に Chrome 無し・テストとビルドで検証済み）


## データ取得（Yahoo Finance）

- [x] Yahoo Finance chart API（query2・ブラウザUA付与）採用（query1=429・stooq 辞退の比較記録）
- [x] データ取得 CLI（`app.cli fetch` / `export-csv`）
- [x] fetch → raw → normalize → processed → export-csv パイプライン
- [x] raw / processed の分離、raw スナップショットハッシュ連携
- [x] SQLite の fetch_history 記録・資産単位の失敗隔離
- [x] 4資産の既定ティッカー取得確認（VTI / AGG / VXUS / IAGG、USD）
- [ ] `price_max_staleness_days`（陳腐化更新の警告・取引停止）— 設定値のみ定義、適用は未実装
- [ ] `/api/jobs` からの data_fetch 配線（GUI/API からの取得は未接続、CLI のみ）
- [ ] レート制限対応・取得失敗時の再試行
- [x] 価格異常値の検出・除外（`app/data/quality.py::detect_price_anomalies`）— ローリング中央値（窓21・`center=True`）から既定「2倍超 / 0.5倍未満」に乖離する**一時的なスパイク**を検出し、`load_price_matrix` が該当日の行を価格行列から除外＋日本語警告（分析・最適化・バックテスト共通）。恒久的な分割段差は追従して誤検出しない（jp_equity 2015-01-05 で確認）。テスト6件。**しきい値の設定項目化・分割補正そのものは未実装**
- [x] 未調整の株式分割の検出と分割前除外（2026-10-03・ユーザー決定「分割前データを除外」）— Yahoo が `1306.T` の2015-01-05の10:1分割を `adjusted_close` に反映していない問題に対し、`detect_splits(raw_close)`（前日比が共通分割比率に近く水準が持続）と `latest_split_cutoff` を追加。`load_price_matrix` と `/api/data/series` が当該資産のみ分割前の観測を除外（値は変更しない・日本語警告）。COVID急落を誤検出しないことを確認。テスト6件。**背調整は行わない。2015-07-10の配当調整異常は残課題**

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
- [x] 最適化タブ分割（**最適化** / **最適化（BL）**）— ヘッダーナビを6タブ化。**最適化タブ**は BL 機能を削除（`OptimizationScreen.tsx`、期待リターン選択肢から black_litterman を除外）。**最適化（BL）タブ**は BL 専用フォーム（`BlOptimizationScreen.tsx`、期待リターンは black_litterman 固定・共分散は選択可能）。BL 結果も `kind:'optimization'` で保存されバックテストの再最適化元に選択可。テスト `BlOptimizationScreen.test.tsx`（8件）・`App.test.tsx`（タブ切替）追加。
- [x] `rebalance_allocation`（リバランス最適化）の実装 — `app/optimization/service.py`。各リバランスシグナル日まで `prices.loc[:sig]` にスライスして `static_allocation` を実行（ルックアヘッド回避）。失敗時は直前ウェイト継続＋日本語警告。バックテスト API の `reoptimize` / `optimization_params` から呼び出し
- [x] 個別資産のリターン・リスク（最適化結果）— `OptimizationMetrics` に `asset_returns` / `asset_volatilities`（最適化に使った `mu`・`sqrt(diag(sigma))` から算出）を追加、最適化画面に資産別統計表を表示
- [x] ウェイト上下限の保証（2026-10-03 不具合修正）— PyPortfolioOpt `max_sharpe` の数値誤差で上下限を僅かに外れる問題（実測 `1.000577` / `-0.000255`）を `_enforce_weight_bounds` でクリップ→合計1へ再正規化して解消（実施時は日本語警告）。`_portfolio_performance` で最終ウェイトから年率リターン/ボラ/Sharpe を再計算、`clean_weights` は PyPortfolioOpt 同等（`cutoff=1e-4`・5桁丸め）。テスト3件。日本モード max_sharpe＋EMA の 100%超・負値が解消
- [x] BL 確信度入力を常時編集可能に（2026-10-03 UX 修正）— 「最適化（BL）」画面の確信度欄が placeholder「必須」なのに ω=default で disabled だった不具合を解消。常に入力可とし、**値の入力で ω を Idzorek へ自動切替**（ω=default では確信度が未使用のため）。ラベル/placeholder を修正しヒントを明示。テスト `BlOptimizationScreen.test.tsx` を新挙動へ更新
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

  API・GUI 配線: `POST /api/backtests`（`app/api/routes/backtests.py`・スキーマ `app/schemas/backtest.py`）・バックテスト画面（`BacktestScreen.tsx`、累積資産/ドローダウン/配分推移折れ線・指標表・年次成績・取引一覧・免責表示・リバランス時再最適化で採用ウェイト）。対象資産は最適化と同じ multi-select ドロップダウン。テスト `test_backtests_api.py`（14件）・`BacktestScreen.test.tsx`（9件）。

## 画面（分析以降）

- [x] 分析画面（価格推移・累積リターン・ローリングボラ・相関ヒートマップ・リターン/リスク統計表）— `GET /api/data/analysis`（`app/api/routes/analysis.py` / `app/schemas/analysis.py`）を配線、`app/api/route_helpers.py` の `load_price_matrix` で複数資産を外側 union 整列、未取得資産は除外して日本語警告、`frontend/src/hooks/useAnalysis.ts` + `src/api/client.ts` の `getAnalysis` と連携。リターン/リスク統計表（平均リターン・EMA リターン・年率ボラ・シャープ、`analysis.stats`）を追加
- [x] 最適化画面（手法・期間・制約の入力と結果表示）— `POST /api/optimizations` を配線。対象資産（**未取得は disabled で表示・複数選択**）・手法・期待リターン（capm_return はベンチマーク非対応のため除外。**BL も除外し最適化（BL）タブへ分離**）・共分散・期間・リスクフリー金利・ウェイト上下限・年率換算係数を入力、`efficient_return`/`efficient_risk` の目標値は**常時表示で入力可否を切替**（非表示にしない）。結果見出しに基準通貨を表示。結果に個別資産のリターン/リスク表（`metrics.asset_returns` / `asset_volatilities`）を表示。クライアント側検証（資産2件・ウェイト上下限・目標値必須）と結果表（clean_weights・指標・warnings）を実装。テスト `OptimizationScreen.test.tsx` 付き
- [x] バックテスト画面（固定ウェイト・リバランス頻度・初期資金・コスト入力、累積資産/ドローダウン/配分推移の折れ線・評価指標・年次成績・取引一覧・免責表示）— `POST /api/backtests` を配線。対象資産は最適化と同じ multi-select ドロップダウン。リバランス頻度に年次（Y）を追加。比較一覧の保存済み最適化から**選択するだけで再最適化**（未選択＝固定ウェイト。チェックボックス廃止・選択駆動に変更）。初期資金は小数可（`step="any"`）。再最適化は各シグナル日までで最適化、失敗時は直前ウェイト継続。再最適化時は採用ウェイト表を表示。`BacktestScreen.tsx` + テスト（`BacktestScreen.test.tsx` 9件）
- [x] 比較・保存画面（複数結果の比較、JSON / CSV エクスポート）— `CompareScreen.tsx`・`compare/CompareContext.tsx`（最適化・バックテスト結果を「比較に追加」でグローバル保持、最大50件・メモリ保持）。種別ごとの指標比較（最良値強調・nullは「—」）、**モード列（結果の基準通貨から導出・CSV ヘッダにも含む）**、ラベル編集・削除、JSON / CSV エクスポート（Blob ダウンロード）。テスト `CompareScreen.test.tsx`（6件）
- [x] UI 細部改善（2026-10-03）— 未取得資産を選択肢から消さず disabled＋「（未取得）」表示（最適化 / BL / バックテスト3画面・全資産未取得でもフォームを描画）、データ画面の資産一覧表に通貨列、比較画面にモード列、`opt-form` を固定3列化（画面幅による入力欄の列間移動を防止）

## 仕上げ

- [ ] E2E 確認・再現手順・サンプル設定の整備
