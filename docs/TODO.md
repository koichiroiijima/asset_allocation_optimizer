# 実装進捗（TODO）

このファイルはアセット配分最適化アプリの実装進捗を追跡する。実装状況の詳細（設計判断・決定履歴）は [`design.md`](design.md)、利用方法は [`README.md`](../README.md)、進め方の指針は [`CLAUDE.md`](../CLAUDE.md) を参照。

最終更新: 2026-08-09

## 凡例

- [x] 完了
- [~] 進行中（部分的に完了）
- [ ] 未着手

---

## 基盤

- [x] プロジェクト構造（backend / frontend / data / outputs / docs）
- [x] Pydantic Settings による設定管理（`ASSET_ALLOC__*`、.env、validate_settings）
- [x] データレコードと repository 抽象（Parquet + SQLite 索引 + スナップショットハッシュ）
- [x] FastAPI API 骨格（health / assets / series / jobs / runs）+ OpenAPI スキーマ
- [x] フロントエンド5画面の骨格 + Header / HealthCheck
- [x] テスト基盤（backend: ruff / mypy strict / pytest、frontend: ESLint / Prettier / tsc / vitest）

## データ取得（Yahoo Finance）

- [x] Yahoo Finance chart API（query2・ブラウザUA付与）採用（query1=429・stooq 辞退の比較記録）
- [x] データ取得 CLI（`app.cli fetch` / `export-csv`）
- [x] fetch → raw → normalize → processed → export-csv パイプライン
- [x] raw / processed の分離、raw スナップショットハッシュ連携
- [x] SQLite の fetch_history 記録・資産単位の失敗隔離
- [x] 4資産の既定ティッカー取得確認（VTI / BND / VXUS / BNDX、USD）
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

## データ確認 GUI（第1弾）

- [x] `GET /api/data/series` を processed Parquet へ配線（series_type / frequency / NaN 除外 / 未取得警告）
- [x] `GET /api/assets` に data_status 合成（`AssetDataStatus` / `summarize_series` / snapshot_hash）
- [x] フロントエンド データ画面（資産一覧表＋系列グラフ、series_type / frequency 選択式）
- [x] データ画面のテスト・API クライアントテスト

## 最適化（static_allocation・最適化 API 実装済み）

- [x] PyPortfolioOpt 最適化サービスと単体テスト（`static_allocation`）
- [x] 最適化 API ルート配線（`POST /api/optimizations` 同期エンドポイント＋API テスト、`OptimizationRequest` の `start`/`end` でルックアヘッド回避）
- [ ] 手法・パラメータの選択 UI（最適化画面・GUI。expected return / covariance / 制約 / リスクフリー金利の入力と結果表示）
- [ ] rebalance_allocation（リバランス最適化）の実装
- [ ] 互換性表・入力範囲・既定値のスキーマ共用

## バックテスト（未実施）

- [ ] ルックアヘッド回避のバックテストエンジン
- [ ] 評価指標（累積 / 年率リターン・ボラティリティ・Sharpe / Sortino / Calmar・最大ドローダウン・勝率・回転率・手数料）
- [ ] シグナル日と約定日の分離（次営業日約定など）
- [ ] 未来データ混入を検出するバイアス検査テスト
- [ ] 実行結果の再現可能な保存（スナップショット・設定・コードバージョン）

## 画面（分析以降）

- [x] 分析画面（価格推移・累積リターン・ローリングボラ・相関ヒートマップ）— `GET /api/data/analysis`（`app/api/routes/analysis.py` / `app/schemas/analysis.py`）を配線、`app/api/route_helpers.py` の `load_price_matrix` で複数資産を外側 union 整列、未取得資産は除外して日本語警告、`frontend/src/hooks/useAnalysis.ts` + `src/api/client.ts` の `getAnalysis` と連携
- [ ] 最適化画面（手法・期間・制約の入力と結果表示）
- [ ] バックテスト画面
- [ ] 比較・保存画面（複数結果の比較、JSON / CSV エクスポート）

## 仕上げ

- [ ] E2E 確認・再現手順・サンプル設定の整備
