# 引き継ぎドキュメント（handover）

最終更新: 2026-10-03
ブランチ: `opencode/work`（`origin/opencode/work` より数コミット先行・**未 push**）

このドキュメントは**セッション引き継ぎ用のエントリポイント**。次のセッションはこのファイルから読み始めること。

---

## 1. まず読む順序

1. 本ファイル（現状・次タスク・検証コマンド）
2. [`CLAUDE.md`](CLAUDE.md) — 作業規範と実装状況サマリ（2026-10-03 時点）
3. [`docs/TODO.md`](docs/TODO.md) — タスク別の進捗（[x]/[~]/[ ]）
4. [`docs/design.md`](docs/design.md) — 詳細設計と **§12 決定履歴**（過去の判断はここで確認）
5. [`README.md`](README.md) / [`backend/README.md`](backend/README.md) — セットアップ・起動・API の使い方

---

## 2. プロジェクトの現状

**研究用 Web アプリ**: 4資産のデータ取得（Yahoo Finance）→ 最適化（PyPortfolioOpt＋Black-Litterman）→ バックテスト → 可視化/比較。

### 実装済みの主要機能

- **データ取得 CLI**: `uv run python -m app.cli fetch [--set us|jp] [--asset ...]` / `export-csv`。raw / processed Parquet、スナップショットハッシュ、SQLite `fetch_history`。日次（`period1`/`period2` 明示）。
- **資産セット（モード）**: `us`（USD 基準・VTI/AGG/VXUS/IAGG）/ `jp`（JPY 基準・円建て ETF 1306.T/2510.T/1550.T/2511.T）。JP 共通履歴は概ね 2017-12〜。`fetch --set jp` での実データ取得は確認済み。
- **リターン計算**: `backend/app/domain/returns.py`（単純/対数/累積・年率換算・リサンプリング・ローリングボラ・相関・統計）。欠損は補完しない。
- **最適化**: `backend/app/optimization/service.py` の `static_allocation` ＋ `POST /api/optimizations`（同期・`start`/`end` でルックアヘッド回避）。Black-Litterman は**絶対ビュー**対応（`omega="default"/"idzorek"`・τ・リスク回避度・市場ウェイト設定可）。`omega="default"` では τ は結果に影響しない（PyPortfolioOpt 仕様・テスト済み）。
- **バックテスト**: `backend/app/backtest/engine.py` ＋ `POST /api/backtests`。次営業日約定でルックアヘッド回避、リバランス頻度 D/W/M/Y、**リバランス時再最適化**（`reoptimize`/`optimization_params`、失敗時は直前ウェイト継続＋警告）。BL も再最適化に使用可。
- **フロントエンド 6 画面**: データ / 分析 / 最適化 / 最適化（BL）/ バックテスト / 比較・保存（Recharts・`frontend/src/pages/`）。モード切替はヘッダー（基準通貨バッジ付き）で **localStorage に永続化**。未取得資産は選択肢に残して disabled 表示。目標値入力は常時表示＋disabled 切替。BL 確信度は**常に入力可能**で、入力すると ω を Idzorek へ自動切替（ω=default では未使用）。結果見出しに基準通貨、データ画面に通貨列、比較画面にモード列。
- **開発サーバー**: `make start` / `make stop`（`scripts/start.sh` / `scripts/stop.sh`・バックグラウンド・ログは `logs/`、PID は `.run/`）。`make dev` はフォアグラウンド並列起動。`start.sh` は起動前にポート空きを確認し、起動後に `GET /api/health`（backend）と `/`（frontend）の応答を検証（失敗時は起動済みを停止して非ゼロ終了・ログ末尾を表示）。`stop.sh` は SIGTERM 不応答時に最大5秒後に SIGKILL へエスカレートし、呼び出し元シェルを巻き込まないよう祖先 PID を除外する。

### テスト数（実測）

- backend: **224 件**（pytest・ruff・mypy strict 全緑）
- frontend: **57 件**（vitest・eslint・tsc 全緑）

### 直近の変更（このセッション）

- `523cfa1` feat: モード切替の永続化・UI 改善と基準通貨の表示（フロント only・15ファイル）
- `ceaddf6` test: Header のモード切替テスト完成・`makeMemoryStorage` の型エラー修正
- `768de97` test: 日本モードのテスト拡充 / `da38791` feat: 円ベース4資産（日本モード）とモード切替を追加
- `105c92d` chore: 開発サーバー起動・停止スクリプト追加

---

## 3. 検証コマンド（全緑が現状の基準）

```bash
make test          # backend (pytest) + frontend (vitest)
make lint          # backend (ruff) + frontend (eslint)
make typecheck     # backend (mypy strict) + frontend (tsc --noEmit)

make start         # 開発サーバー起動（http://localhost:8000 / :5173）
curl http://localhost:8000/api/health   # {"status":"ok",...} で成功
make stop
```

---

## 4. 既知の制約・注意点

- **保存はブラウザ内のみ**: 比較・保存はメモリ（最大50件・再読込で消失）。モード切替だけ localStorage。
- **データ取得は CLI のみ**: `/api/jobs` の data_fetch は未配線。GUI/API からの取得不可。
- **BL の JP 既定市場ウェイトは仮値**（`DEFAULT_MARKET_WEIGHTS_JP`: 日本株25%/日本債券35%/外国株25%/外国債15%・警告表示あり）。
- **JP モードは FX 換算なし**（全銘柄円建て ETF 前提）。外貨建て→基準通貨の汎用 FX レイヤは意図的に未実装。
- **`price_max_staleness_days`**（既定5日）は設定のみで未適用（判定式は design.md §6）。
- **価格異常値**: `app/data/quality.py` が一時的なスパイク（ローリング中央値から2倍超/0.5倍未満）を検出し、`load_price_matrix` が該当日を除外＋警告（分析・最適化・バックテスト共通）。しきい値は未設定項目（固定）。**Yahoo は `1306.T` の `2026-03-30/31` に約1/10の異常値を返す（分割イベントは無し・再取得でも同一）ため、この自動除外が効いている**。恒久的な分割段差（同 `1306.T` の 2015-01-05）は除外されない（分割補正は未実装）。データ原本（processed Parquet）自体は未修正。
- **未調整の株式分割**: Yahoo が `1306.T` の 2015-01-05 の10:1分割を `adjusted_close` に反映していない。`detect_splits`（`raw_close` から検出）＋`latest_split_cutoff` により、`load_price_matrix`・`/api/data/series` が**当該資産の分割前データを除外**（値は変更しない・警告あり）。ユーザー決定で背調整はしない。**`1306.T` の 2015-07-10 の配当調整異常（+16.7%スパイク）は残課題**（JP共通履歴 2017-12〜には影響なし）。`ex_jp_equity`(1550.T)・`ex_us_equity`(VXUS) は2014年前後も正常。
- **ウェイト上下限**: `_enforce_weight_bounds` が上下限へ射影・再正規化して保証（`max_sharpe` の数値誤差対策）。`weights` が 100%超・負にならない。補正時は警告。
- **再最適化の学習期間**は「開始日（またはデータ冒頭）〜各リバランス日」固定（`lookback` は echo 用の予約パラメータ）。
- **最適化の400**: 未取得資産・期間外・達成不能な目標値は 400＋日本語。スキーマ違反は 422。
- Yahoo Finance データは非商用・研究目的限定・再配布禁止。`query1` は 429 のため `query2` を使用。
- `ex_us_bond`（IAGG）は 2015-11〜のため、4資産を揃えた分析は 2015 年以降に限定。
- バックテストの成績を「最適」「将来も有効」と表現しない（UI・docs の免責を維持）。

---

## 5. 未着手（次タスク候補・優先度順）

1. **バックテスト実行結果の再現可能な保存** — スナップショット・設定・コードバージョンの永続化。`/api/runs` 配線含む（TODO.md「バックテスト」節末尾参照）。
2. **BL の拡張** — 相対ビュー（P/Q 行列）・`omega="manual"`・市場時価総額（AUM）入力。
3. **`/api/jobs` からの data_fetch 配線** — GUI/API からのデータ取得（レート制限対応・再試行も）。
4. **JP モードの資産追加 / ユーザー定義資産セット**、**BL の JP 市場ウェイトを実値へ**。
5. **`price_max_staleness_days` の適用**（警告の顕在化→将来の取引停止）。
6. **E2E 確認・再現手順・サンプル設定の整備**（TODO.md「仕上げ」）。
7. **push 未実施**: `git push` はユーザーに確認してから実行すること（CLAUDE.md 規約）。

---

## 6. 作業時の規約（要点・詳細は CLAUDE.md）

- 表示文言・コミットメッセージは**日本語**。Conventional Commits。
- 数値計算ロジックは UI から分離（backend の純粋な service/domain 層）。
- 金融データの値を推測で補完しない。欠損は補完しない。
- ルックアヘッド回避を厳守（最適化: `start`/`end`・バックテスト: 次営業日約定・再最適化: `prices.loc[:sig]` スライス）。
- 新しい実装決定は design.md §12 決定履歴に追記し、TODO.md・README・handover.md を同期させる。
- コミットはタスク完了後に実施、push とブランチ操作はユーザー確認。
