# GUI 刷新 実装計画（ハンドオーバー）

最終更新: 2026-10-10
ブランチ: `new_gui`（`main` から分岐）
対象: `frontend/`（バックエンドは不変）

**状態: 実装完了**（2026-10-10）。frontend 57 件・backend 224 件のテスト全 green・`npm run build` 成功。
§11 の決定は「①モード切替＝`SegmentedControl`（radio inputs ベース・テストを `radio` checked に更新）」「②数値入力＝**全字段で `TextInput type="number"`**（`NumberInput`（react-number-format）を回避し `step="any"` を含む属性と `user.type` 挙動を維持）」として確定・実装済み。`NumberInput` は未使用。
未実施: 開発サーバー実機でのブラウザ目視確認（実行環境に Chrome が無くダウンロードも失敗。テスト・ビルドで検証済み）。

この文書は「GUI を刷新する」タスクの**実装計画**。別モデル／別セッションへそのまま引き継げるよう、
現状・確定事項・依存追加・ファイル別作業・テスト契約の移行・ドキュメント同期・検証手順を記す。

> 前提: 表示文言は**日本語**（`CLAUDE.md` 規約）。数値フォーマット（`toFixed`・`%` 精度）は**一切変更しない**。

---

## 0. ゴールと確定事項

- **機能・API・フック・数値ロジックは不変**。見た目と操作感のみ改善する。
- 確定事項:
  - UI ライブラリ: **Mantine 8**（`@mantine/core` + `@mantine/hooks`）を導入。
  - レイアウト: **サイドバー型**（`AppShell`）へ再構成。上部ヘッダーにタイトル・モード切替・基準通貨・接続状態。
  - テーマ: **ライト専用**（`color-scheme: light dark` の不整合を解消、`MantineProvider` を light 固定）。
  - スコープ: **本格刷新（共有部品化）**。
  - グラフ: **Recharts 継続**（グリッド・ツールチップ・軸の `%` 表記のみ整える）。
  - 資産選択: multi-select を**チェックボックス式（`Checkbox.Group`）**へ変更。未取得は disabled＋「（未取得）」を維持。

## 1. 技術スタックと現状

- React 18.3 + TypeScript（strict）+ Vite 5 + Vitest 2 + Testing Library。グラフは Recharts 2.12。
- **追加 UI 依存なし・プレーン CSS**（`src/index.css` 375 行）。
- ルーティングは state ベースのタブ切替（`src/App.tsx:30-32`、`SCREENS` は `App.tsx:21-28`）。
- 画面6つ: データ / 分析 / 最適化 / 最適化（BL）/ バックテスト / 比較・保存。
- テスト 57 件（frontend）が **DOM 契約**に依存 → §8 で全対応を列挙。

## 2. 現状ファイル一覧（行数・役割）

```
src/
  App.tsx(47)                       # SCREENS 定義＋タブ state
  main.tsx(10)                      # createRoot + index.css
  index.css(375)                    # 全スタイル（トークン無し・未定義 .health-error・color-scheme 不整合）
  components/Header.tsx(65)         # タイトル・モード切替・通貨・nav（nav に CSS 無し）
  components/HealthCheck.tsx(27)    # data-testid="health"
  state/AssetSetContext.tsx(92)     # localStorage 永続化・ラベル/通貨/説明
  compare/CompareContext.tsx(63)
  compare/export.ts(60)
  compare/indicators.ts(186)
  compare/types.ts(59)
  hooks/useHealth.ts(41)
  hooks/useAssets.ts(46)
  hooks/useSeries.ts(46)
  hooks/useAnalysis.ts(45)
  api/client.ts(103)
  api/types.ts(321)
  api/index.ts(39)
  pages/DataScreen.tsx(215)
  pages/AnalysisScreen.tsx(316)
  pages/OptimizationScreen.tsx(531)
  pages/BlOptimizationScreen.tsx(865)
  pages/BacktestScreen.tsx(611)
  pages/CompareScreen.tsx(222)
tests/
  setup.ts(1)
  api.test.ts(101)
  assetSet.test.tsx(179)
  indicators.test.ts(118)
```

- チャートの系列パレット `COLORS` は `AnalysisScreen.tsx:24` と `BacktestScreen.tsx:35` に**重複定義**。
- `index.css` の既知の問題: `.app-header nav button` の規則が無い（タブが未装飾）／`.health-error` が使われるが未定義／`color-scheme: light dark` とライト配色が矛盾。

## 3. 導入する依存

```jsonc
// dependencies に追加（バージョンは package-lock.json で固定）
"@mantine/core": "^8.3.14",
"@mantine/hooks": "^8.3.14"
// 任意（アイコンを使う場合）
// "@tabler/icons-react": "^3.x"
// 任意（Mantine 推奨 PostCSS。mixins を使う場合のみ）
// devDependencies: "postcss-preset-mantine": "^1.x", "postcss-simple-vars": "^7.x"
```

- `main.tsx` 先頭で `import '@mantine/core/styles.css';`。
- PostCSS を使う場合は `postcss.config.cjs` を追加。アイコンを使わなければ `@tabler/*` は不要。

## 4. テーマ / レイアウト / 共有部品（新規）

### 4.1 `src/theme.ts`
- `createTheme({ ... })` を返す。**ライト固定**（`MantineProvider` に `forceColorScheme="light"`）。
- 主要トークン: `primaryColor`（落ち着いた青。旧 `#2a6e9b` 相当のカスタム 10 段カラースケール）、
  `fontFamily`（system-ui, 'Hiragino Sans', 'Noto Sans JP' 等）、`defaultRadius: 'md'`、`headings.fontWeight`。
- `components` 既定: `Card`/`Paper` の shadow、`Button` の size、`Table` の `highlightOnHover` 等。

### 4.2 レイアウト
- `src/components/layout/AppShellLayout.tsx`
  - `AppShell`（`header={{ height: 56 }}`, `navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}`, `padding="md"`）。
  - `AppShell.Header`: タイトル＋モード切替＋基準通貨バッジ＋`HealthBadge`＋`Burger`（`hiddenFrom="sm"`）。
  - `AppShell.Navbar`: `NavMenu`。
  - `AppShell.Main`: ページ本体。
- `src/components/NavMenu.tsx`
  - 6 `NavLink`。**`component="button"`** を指定し `role=button` を維持（テスト互換）。
  - 現在タブをハイライト。`leftSection` にアイコン（任意）。
- `src/App.tsx`
  - `<AppShellLayout active={active} onNavigate={setActive} screens={SCREENS}>` で `<activeScreen.Component />` を描画。
  - Provider 順序: `AssetSetProvider` → `CompareProvider` →（`MantineProvider` は `main.tsx` でも可）。
  - `ScreenKey`/`SCREENS` のラベルは不変。

### 4.3 共有 UI
- `src/components/ui/SectionCard.tsx`: 見出し（`Title order`）＋`children` を `Card`/`Stack` で提供。
  各画面の `<section><h2>…` を置換。**h2 は維持**（`Title order={2}` は `<h2>` を描画）。
- `src/components/ui/ResultCard.tsx`: 結果見出し＋基準通貨＋「比較に追加」＋警告の定型。
- `src/components/ui/StatusBadge.tsx`: `取得済み`(green)/`未取得`(yellow) の `Badge`。
- `src/components/ui/ErrorNotice.tsx`: `Alert color="red"`＋再試行 `Button`（`再試行` ラベル維持）。
- `src/components/HealthBadge.tsx`: `HealthCheck` を Mantine 化。**`data-testid="health"` を必ず維持**。
- `src/charts/theme.ts`: パレット `SERIES_COLORS = ['#2a6e9b','#c0573f','#2f8f5b','#b0882f','#6b5fa8','#3f9ab0']`、
  共通 `CartesianGrid`、`Tooltip` の `formatter`（`%`/桁）、軸 `tickFormatter`。

## 5. 画面別リファクタ（機能不変・マークアップは Mantine 化）

### DataScreen
- 資産一覧を `Table`＋`Badge`（状態）＋通貨列維持。
- グラフ制御は `NativeSelect`（資産/系列種別/頻度／§8 の理由）。系列グラフを `SectionCard` 化。
- `ResponsiveContainer` は継続。

### AnalysisScreen
- `SectionCard`×（価格推移 / 統計 / 累積 / ローリングボラ / 相関）。
- 統計表は `Table`。相関ヒートマップは**現行の `style={{ backgroundColor }}` 方式を維持**（`corrColor`/`corrColorClass` 不変）。
- 系列名は現状 `asset_id` の Line `name` → **表示名へ**（任意改善。テストは値のみ検証のため安全）。
- 相関・統計の日本語見出しは不変。

### OptimizationScreen / BlOptimizationScreen
- フォームを `SimpleGrid cols={3}`＋`Fieldset` 群。資産選択は **`Checkbox.Group`**（未取得は `Checkbox disabled`＋ラベル末尾「（未取得）」）。
- 単一選択は `NativeSelect`（手法/期待リターン/共分散）。数値は `NumberInput`。日付は `TextInput type="date"`。
- BL 画面の市場ウェイト/ビュー/確信度は **`Fieldset legend`＋資産ごとの `NumberInput`（`label={assetLabel}`）**。
  DOM 契約は §8 に従い `aria-label` で安定化。
- `実行中…`・`最適化を実行`・`比較に追加`・`追加しました`・`基準通貨: {cur}` は不変。
- 結果表（`資産別ウェイト` / `個別資産のリターン・リスク（年率）` / `指標（年率）` / `パラメータ`）は `Table`。

### BacktestScreen
- 資産選択は `Checkbox.Group`。資産別ウェイトは `NumberInput label={`${assetLabel} ウェイト`}`。
- `ウェイト合計` 読み取り表示は維持（合計≠1 で赤）。
- `リバランス頻度`・`再最適化元の最適化（比較一覧）` は `NativeSelect`。
- 初期資金/コスト率/リスクフリー金利は numeric（§8 の注記参照）。日付 `TextInput type="date"`。
- 結果: 指標表/累積資産/ドローダウン/年次成績/配分推移/採用ウェイト/取引一覧を `SectionCard`。`比較に追加` 等の文言不変。

### CompareScreen
- ツールバー `Button`（`JSON エクスポート`/`CSV エクスポート`/`全削除`）、
  保存一覧は `Table`＋`TextInput aria-label={`ラベル（${r.label}）`}`＋`削除` `Button`。
- 指標比較 `Table`、最良値強調は `.better-cell` クラスを残して最小差分で再現。エクスポート処理は不変。

## 6. スタイル

- `src/index.css` を**最小化**（`html, body, #root` の高さ/背景、`box-sizing` 程度）。
  ハードコード配色・`.health-error`・`color-scheme: light dark` を撤去。
- グラフ内の色は `src/charts/theme.ts` に集約。

## 7. テスト基盤の変更

- `tests/setup.ts` に追加（Mantine 必須）: `matchMedia`・`ResizeObserver`・`HTMLElement.prototype.scrollIntoView` のモック（§9）。
- `tests/test-utils.tsx` を新設: `MantineProvider(theme)` で包む `render` を公開。各テストは `@testing-library/react` の `render` を**これに差し替え**。
- 既存の各テスト内 `ResizeObserver` スタブは残して可（setup と二重でも問題なし）。

## 8. DOM 契約の移行マップ（**最重要・漏れ厳禁**）

| 対象 | 現行テスト | 変更内容 |
| --- | --- | --- |
| タブ | `getByRole('button',{name:'最適化'})`（App.test:37,44） | `NavLink component="button"` で**そのまま通す** |
| 見出し | `getByRole('heading',{name:'最適化'})` | `Title order={2}`＝`<h2>` で**そのまま通す** |
| health | `getByTestId('health')`（App.test:30） | `HealthBadge` に `data-testid="health"` を**必ず付与** |
| モード切替 | `getByRole('button',{name:'日本'})`＋`aria-pressed`＋`getByLabelText('基準通貨')`（assetSet.test:161-177, App.test:70-73） | `SegmentedControl` 採用なら `getByRole('radio')`＋`toBeChecked` へ**更新**。通貨は `Badge aria-label="基準通貨"` 維持。★§11 で決定 |
| 資産複数選択 | `getByRole('listbox',{name:/対象資産/})`＋`option.disabled`（Opt:164-173, BL:159, BT:240-247） | `Checkbox.Group`＋`Checkbox`。`getByRole('checkbox',{name:/米国株式（VTI）/})`＋`toBeDisabled()`/`toBeChecked()` へ**更新**。「（未取得）」表記は維持 |
| 目標値 | `getByRole('spinbutton',{name:/目標リターン/})` `.toBeDisabled/Enabled`（Opt:205-221） | `NumberInput label="目標リターン（年率）"` で**そのまま通す**（常時表示・`disabled` 切替はロジック不変） |
| 手法 combobox | `getByRole('combobox',{name:/手法/})`＋`user.selectOptions`（Opt:210, BT:331,377） | **`NativeSelect`** 採用で**そのまま通す** |
| 資産ウェイト | `getByLabelText(/米国株式.*ウェイト/)`（BT:204-209,301-305） | `NumberInput label={`${assetLabel} ウェイト`}` で**そのまま通す** |
| 初期資金 step | `capitalInput.getAttribute('step')==='any'`（BT:279） | `NumberInput` は `step="any"` を保証しにくい → **`TextInput type="number" step="any"`** を使うか、テストを「小数が送信される」検証へ**更新**（§11 で決定） |
| submit | `getByRole('button',{name:'バックテストを実行'}).closest('form')`＋`fireEvent.submit`（BT:215-218） | 実 `<form onSubmit>` を維持し**そのまま通す** |
| BL 行 | `getByText(/市場ポートフォリオのウェイト/).closest('label')!.querySelectorAll('input')`（BL:186-192,229-232,259-264,291-294,316-319） | 構造が変わるため**`aria-label` 方式へ更新**。各 `NumberInput` に `aria-label={`市場ウェイト（${displayName}）`}` / `ビュー（${displayName}）` / `確信度（${displayName}）` を付与し、テストは `getAllByLabelText(/市場ウェイト/)` 等へ。**入力順は `.sort()` した assetId 順**を維持（値 `48.33/51.67`、`41.67/58.33` の期待値が依存） |
| ω select | `getByRole('combobox',{name:/ω（ビュー不確実性）/})`（BL:238,266,289） | `NativeSelect` で**そのまま通す**（value `default`/`idzorek`、自動切替ロジック不変） |
| 統計・見出し文言 | `'リターン・リスク統計（年率）'`,`'平均リターン'`,`'EMA リターン'`,`'年率ボラティリティ（リスク）'`,`'シャープレシオ'` | **文言不変** |
| 数値 | `'0.4000'`,`'0.3000'`,`'12.00%'`,`'30.00%'`,`'8.00%'`,`'25.00%'` 等 | **フォーマット不変** |
| 比較画面 | `getByDisplayValue('…')`,`getByRole('button',{name:'削除'/'全削除'/'JSON エクスポート'/'CSV エクスポート'})`,`getByRole('columnheader',{name:'通貨'})` | Mantine `Table`/`Button`/`TextInput` で**そのまま通す**（アクセシブルネーム維持） |
| Data 画面 combobox | `getByRole('combobox',{name:/資産/})`,`/系列種別/`,`/頻度/`＋`selectOptions`（Data:118,131,141） | **`NativeSelect`** で**そのまま通す** |
| 再試行 | `getByRole('button',{name:'再試行'})`（Data:158 他） | `ErrorNotice` で**維持** |

> **方針**: 単一選択系は **`NativeSelect`**（ネイティブ `<select>` を描画し `role=combobox`＋`selectOptions` 互換、Mantine でスタイルされる）を使って**テスト改修を最小化**。複数選択のみ §5 の通り Checkbox 化しテストを更新。

## 9. テスト setup スニペット（Mantine 公式）

```ts
// tests/setup.ts
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

const { getComputedStyle } = window;
window.getComputedStyle = (el) => getComputedStyle(el);
window.HTMLElement.prototype.scrollIntoView = () => {};

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = ResizeObserver as unknown as typeof ResizeObserver;
```

## 10. 実行フェーズ（推奨順）

1. **依存追加＋基盤**: `package.json`、`postcss.config.cjs`、`main.tsx`（`MantineProvider`＋styles）、`theme.ts`、`tests/setup.ts`、`tests/test-utils.tsx`。
2. **シェル**: `AppShellLayout`、`NavMenu`、`HeaderBar`、`HealthBadge`、`App.tsx` 差し替え → `App.test.tsx`/`assetSet.test.tsx` を新契約へ更新して green を確認。
3. **共有 UI**: `SectionCard`/`ResultCard`/`StatusBadge`/`ErrorNotice`/`charts/theme.ts`。
4. **画面を1つずつ**: Data → 分析 → 最適化 → BL → バックテスト → 比較。各画面のテストを §8 に従い同時更新。
5. **CSS 整理**: `index.css` 最小化、`color-scheme` 撤去。
6. **ドキュメント同期**（§12）。
7. **検証**（§13）＋ ブラウザ目視。
8. **コミット**（日本語・Conventional Commits。push はユーザー確認）。

## 11. 要決定 → 実装で確定した内容

1. **モード切替**: **`SegmentedControl` を採用**（Mantine は radio inputs ベース。テストは `getByRole('radio')`＋`toBeChecked` へ更新済み・通貨は `Badge aria-label="基準通貨"` を維持）。
2. **初期資金の `step="any"`**: **`TextInput type="number" step="any"` を採用**（属性維持・テスト無改修）。あわせて全数値入力を `TextInput type="number"` に統一し、`NumberInput`（react-number-format）の `step`/`user.type` 挙動リスクを回避した。

## 12. ドキュメント同期（同時修正・line 番号は現状）

- `docs/design.md`
  - §9（332-341）をサイドバー型＋Mantine へ、§3.2（88-92）・§10（346）更新。
  - **§12（364-397）に決定履歴を追記**。
  - 不一致修正: `:298` `test_optimizations_api.py` 14→**17件**、`:321` `test_backtests_api.py` 13→**14件** / `BacktestScreen.test.tsx` 14→**9件**、`:64` fixtures に `yahoo_jp_sample.json` 追記。
- `docs/TODO.md`
  - GUI 刷新タスク追加・完了化。
  - `:79` BL `7件`→**8件**、`:97` `13件/14件/9件`→**14件/9件**、`:36` 実データ取得を `[x]` へ（handover.md:27 と整合）。
- `README.md`: 構成表（16）・「現在の実装状態」（299-313）・GUI 記述を Mantine/サイドバーへ。機能説明は不変。
- `CLAUDE.md`: 「実装状況サマリ」の GUI 節を更新。
- `handover.md`: `:4` ブランチ（`new_gui`・`main` マージ済み）、`:39`「未 push」を解消、GUI 刷新を反映。

## 13. 検証コマンド

```bash
cd frontend && npm install
npm run typecheck && npm run lint && npm run format:check
npm run test          # 57件前後が green
npm run build         # 追跡 dist/ を再生成（生成物はコミットしない方針）
# 統合
cd .. && make test-backend   # 224件 不変
make start && curl -s localhost:8000/api/health && make stop
# ブラウザ目視: サイドバー6画面・モード切替・各フォーム送信・異常系表示
```

## 14. リスク / 注意

- **工数の大半はテスト改修**。§8 を機械的に適用し、**検証内容・日本語ラベルは変えない**。
- `NumberInput` は内部で `react-number-format` を使い、`step`/`user.type` 挙動が素の input と異なる（§8・§11）。単一選択は `NativeSelect` で回避。
- Mantine 追加でバンドル増（許容）。
- `dist/` は追跡外か要確認。生成物・`node_modules` をコミットしない。
- `AssetSetContext.tsx` / `compare/*` / `api/*` / `hooks/*` / 数値表示は**触らない**（リファクタ対象外）。
