# CLAUDE.md

米国株式・米国債券・米国を除く株式・米国を除く債券の4資産を対象に、データ収集・ポートフォリオ最適化・バックテスト・可視化を行う研究用Webアプリケーション。

- **詳細設計**（技術構成・データモデル・最適化／バックテスト要件・API・GUI・品質管理・決定履歴）: [`docs/design.md`](docs/design.md)
- **実装進捗**（完了／進行中／未着手）: [`docs/TODO.md`](docs/TODO.md)
- **セットアップ・起動・標準コマンド・データ取得 CLI・実装状態・既知の制限**: [`README.md`](README.md)（バックエンドは `backend/README.md`）

## 開発方針

- まず動く最小構成を作り、その後にデータソース、最適化手法、画面を拡張する。
- 数値計算ロジックはUIから分離し、Pythonの純粋なサービス／ドメイン層としてテスト可能にする。
- 外部データは必ず出所、取得日時、対象期間、タイムゾーン、通貨、データ種別、欠損処理を記録する。
- 取得したデータをそのまま信頼せず、重複日付、欠損、異常値、配当・分割の扱い、営業日ずれを検証する。
- 実装上の仮定（期待リターン、リスクフリー金利、取引コスト、税金、為替の扱いなど）はコードとUIの両方で明示する。
- 既存のユーザー作業ファイルや個人情報を変更・削除しない。生成物は専用のデータ／出力ディレクトリに保存する。

## Claude Codeへの指示

- ユーザーが明示していない大規模な依存関係変更、外部サービス契約、課金APIへの移行は行わない。
- 実データ取得先が未確定の場合は、まずプロバイダー抽象化とローカルCSV／Parquetアダプターを作る。ただしMVPの既定データソースと4資産の初期マッピングはREADMEに明記する。
- データプロバイダーの選定前に、利用規約、商用・再配布可否、Adjusted Closeと分配金の定義、履歴長、更新遅延、APIキー要件を比較表に記録する。
- 金融データの値や定義を推測で補完しない。取得できない場合は、エラー、警告、代替案を返す。
- バックテストの高い成績を「最適」や「将来も有効」と表現しない。過学習、推定誤差、期間依存性、実装コストをUIとドキュメントで説明する。
- 変更前後に関連ファイルを読み、既存の未コミット変更を上書きしない。
- コードを書く前に、対象ファイル、採用する仮定、検証方法を短く提示する。完了時には変更ファイル、実行したテスト、残る既知の制約を報告する。
- 例外を握りつぶさず、ユーザーに理解可能なメッセージと内部ログを分ける。
- このファイルは実装上の作業規範を扱い、詳細な金融モデル仕様は`docs/design.md`等に分離する。両者が矛盾する場合は、ユーザーの最新指示を優先し、設計メモを更新する。

## 実装状況サマリ（2026-08-22時点）

実装済み（進捗詳細は [`docs/TODO.md`](docs/TODO.md)）：

- **データ取得**: Yahoo Finance chart API（query2）→ `app.cli fetch` / `export-csv` パイプライン（raw / processed Parquet、スナップショットハッシュ、SQLite fetch_history）。4資産は VTI / AGG / VXUS / IAGG。日次取得（`period1`/`period2` 明示で Yahoo の月足ダウンサンプリングを回避）。IAGG は2015年設立のため履歴は BNDX より短い（2015-11〜）。AGG: 2003-09〜。
- **リターン計算**: `app/domain/returns.py`（単純／対数／累積リターン・年率換算・頻度リサンプリング・`rolling_volatility`・`correlation_matrix`・`return_stats`/`ema_annual_return`/`sharpe_ratio`）。欠損は補完しない。
- **GUI**: データ画面（系列グラフ）・分析画面（価格推移・累積リターン・ローリングボラ・相関ヒートマップ・**リターン/リスク統計表**）・**最適化画面（手法タブ）と最適化（BL）タブ**（ヘッダーナビ6タブ化。手法タブは BL を除外した通常手法、最適化（BL）タブは BL 専用フォームで期待リターン固定）・バックテスト画面（固定ウェイトリバランス＋再最適化・累積資産/ドローワウン/配分推移・指標・取引一覧）・比較・保存画面（複数結果比較・JSON/CSV エクスポート）を実装。バックテストの対象資産は最適化と同じ multi-select。BL 結果も `kind:'optimization'` で保存されバックテストの再最適化元に選択可。
- **最適化**: `app/optimization/service.py` の `static_allocation`（PyPortfolioOpt）＋ `POST /api/optimizations`（同期・`start`/`end` でルックアヘッド回避）。結果に個別資産の年率リターン/ボラ（`asset_returns`/`asset_volatilities`）を含む。`rebalance_allocation`（再最適化リバランス）も実装。**Black-Litterman**（`expected_return_method="black_litterman"`）: `_compute_black_litterman` で先行情報 Π=δ·Σ·w_mkt+rf（リスク回避度は市場ポートフォリオのリターンから逆算可能）と絶対ビュー（年率期待リターン（r_f込み）の水準）を合成して事後 μ/Σ を算出。**市場ポートフォリオはユーザーがウェイトで設定可能**（既定値: 米国株式 22.88% / 米国債券 21.40% / 除く株式 23.73% / 除く債券 31.98%）。ω=default/idzorek・τ（既定0.05）・リスク回避度を指定可能。ビューなしは市場均衡に一致。**`omega="default"` では τ は結果に影響しない**（PyPortfolioOpt 仕様、テストで検証）。
- **バックテスト**: `app/backtest/engine.py` の `run_backtest`（固定ウェイト・**次営業日約定でルックアヘッド回避**）＋ `POST /api/backtests`。リバランス頻度に年次（Y）を追加。**リバランス時再最適化**（`reoptimize`/`optimization_params`、各シグナル日まで `prices.loc[:sig]` で最適化、失敗時は直前ウェイト継続＋警告）。採用ウェイト（`rebalance_weights`）を結果に含む。評価指標（累積/年率リターン・ボラ・Sharpe/Sortino/Calmar・最大DD・勝率・回転率・手数料）は未定義を null で返す。バイアス検知テストで未来データ混入を検出（再最適化時も）。BL を再最適化にも利用可能（market weights/views は全時点で固定）。
- **比較・保存**: `frontend/src/compare/`（`CompareContext`・`export.ts`・`indicators.ts`）＋ `CompareScreen.tsx`。最適化・バックテスト結果を「比較に追加」でブラウザ内（メモリ・最大50件）にグローバル保持し、種別ごとの指標比較（最良値強調・null は「—」）と JSON / CSV エクスポートを行う。最適化の保存には再現用 `OptimizationRequest`（`StoredResult.request`）を含め、バックテストの再最適化で呼び出せる。保存はブラウザ内のみ（ページ再読込で消失）と免責を UI に明示。BL の `optimization_params` も保存され reoptimize でそのまま使える。

未実装（後続工程）：バックテスト実行結果の再現可能な保存（スナップショット・コードバージョン、runs/jobs 配線含む）、`/api/jobs` からの data_fetch 配線、Black-Litterman の**相対ビュー（P/Q 行列）**・`omega="manual"`・市場時価総額（AUM）入力。

内部仕様・設計判断は [`docs/design.md`](docs/design.md)、API の使い方・ユーザー向け操作は [`README.md`](README.md) に記載。