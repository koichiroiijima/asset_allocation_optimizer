/** 比較・保存画面で使う指標の定義と型ガード。 */

import type {
  BacktestMetrics,
  BacktestResponse,
  OptimizationResponse,
} from '../api/types';
import type { StoredResult, StoredResultKind } from './types';

/** 種別を判別する型ガード。 */
export function isBacktestResult(
  result: OptimizationResponse | BacktestResponse,
): result is BacktestResponse {
  return 'metrics' in result && 'equity_curve' in result;
}

/** 種別を判別する型ガード（補集合）。 */
export function isOptimizationResult(
  result: OptimizationResponse | BacktestResponse,
): result is OptimizationResponse {
  return !isBacktestResult(result);
}

/** 数値の百分率表記（null は undefined）。 */
function percent(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return undefined;
  return `${(value * 100).toFixed(2)}%`;
}

/** 数値の小数表記（null は undefined）。 */
function decimal(value: number | null | undefined, digits = 4): string | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return undefined;
  return value.toFixed(digits);
}

/** 数値の通貨表記（null は undefined）。 */
function currency(value: number | null | undefined): string | undefined {
  if (value === null || value === undefined || Number.isNaN(value)) return undefined;
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** 比較対象となり得る全資産の論理 ID（us / jp 両モード）。 */
const ALL_ASSET_IDS = [
  'us_equity',
  'us_bond',
  'ex_us_equity',
  'ex_us_bond',
  'jp_equity',
  'jp_bond',
  'ex_jp_equity',
  'ex_jp_bond',
] as const;

/**
 * 比較・保存画面・CSV で共通の列定義。
 * kind はどの結果種別の列かを示し、CSV 生成時に値の埋め込み判定に使う。
 */
export interface MetricColumn {
  key: string;
  kind: StoredResultKind;
  label: string;
  /** 値が大きいほど良い場合は true（最良値判定に使う。null は対象外）。 */
  isHigherBetter: boolean;
  /** 表示用文字列（undefined は「—」）。 */
  extract: (r: StoredResult) => string | undefined;
  /** CSV 用生値（undefined → 空文字）。 */
  csvRaw: (r: StoredResult) => number | string | null | undefined;
}

/** 最適化結果の列定義。`assetIds` は重み列に使う資産ID（結果から収集した和集合）。 */
function optimizationColumns(assetIds: readonly string[] = ALL_ASSET_IDS): MetricColumn[] {
  return [
    {
      key: 'expected_annual_return',
      kind: 'optimization',
      label: '期待リターン（年率）',
      isHigherBetter: true,
      extract: (r) =>
        isOptimizationResult(r.result) ? percent(r.result.metrics.expected_annual_return) : undefined,
      csvRaw: (r) =>
        isOptimizationResult(r.result) ? r.result.metrics.expected_annual_return : undefined,
    },
    {
      key: 'annual_volatility',
      kind: 'optimization',
      label: 'ボラティリティ（年率）',
      isHigherBetter: false,
      extract: (r) =>
        isOptimizationResult(r.result) ? percent(r.result.metrics.annual_volatility) : undefined,
      csvRaw: (r) =>
        isOptimizationResult(r.result) ? r.result.metrics.annual_volatility : undefined,
    },
    {
      key: 'sharpe_ratio',
      kind: 'optimization',
      label: 'シャープレシオ',
      isHigherBetter: true,
      extract: (r) =>
        isOptimizationResult(r.result) ? decimal(r.result.metrics.sharpe_ratio, 2) : undefined,
      csvRaw: (r) => (isOptimizationResult(r.result) ? r.result.metrics.sharpe_ratio : undefined),
    },
    // 各資産のウェイトを列化する（資産IDは結果から収集した和集合）
    ...assetIds.map(
      (assetId): MetricColumn => ({
        key: `weight_${assetId}`,
        kind: 'optimization',
        label: `ウェイト（${assetId}）`,
        isHigherBetter: false,
        extract: (r) => {
          if (!isOptimizationResult(r.result)) return undefined;
          const value = r.result.clean_weights[assetId];
          return value === undefined ? undefined : percent(value);
        },
        csvRaw: (r) =>
          isOptimizationResult(r.result) ? r.result.clean_weights[assetId] ?? null : undefined,
      }),
    ),
  ];
}

/** バックテスト結果の列定義。 */
function backtestColumns(): MetricColumn[] {
  const metricsOf = (r: StoredResult): BacktestMetrics | null =>
    isBacktestResult(r.result) ? r.result.metrics : null;

  const metricCol = (
    key: keyof BacktestMetrics,
    label: string,
    isHigherBetter: boolean,
    format: (v: number) => string | undefined,
  ): MetricColumn => ({
    key,
    kind: 'backtest',
    label,
    isHigherBetter,
    extract: (r) => {
      const m = metricsOf(r);
      return m && m[key] !== null && m[key] !== undefined ? format(m[key]!) : undefined;
    },
    csvRaw: (r) => {
      const m = metricsOf(r);
      return m ? (m[key] as number | null) ?? null : undefined;
    },
  });

  return [
    metricCol('cumulative_return', '累積リターン', true, percent),
    metricCol('annual_return', '年率リターン', true, percent),
    metricCol('annual_volatility', '年率ボラティリティ', false, percent),
    metricCol('sharpe_ratio', 'シャープレシオ', true, (v) => decimal(v, 2)),
    metricCol('sortino_ratio', 'ソルティノレシオ', true, (v) => decimal(v, 2)),
    metricCol('calmar_ratio', 'カルマーレシオ', true, (v) => decimal(v, 2)),
    metricCol('max_drawdown', '最大ドローダウン', false, percent),
    metricCol('win_rate', '勝率（日次）', true, percent),
    metricCol('turnover', '年率回転率', false, percent),
    metricCol('total_fees', '手数料合計', false, currency),
  ];
}

/**
 * 結果集合に含まれるウェイト列用の資産ID（順序は初出順の和集合）。
 * us / jp 両モードが混在しても、各結果に存在する資産だけを列にする。
 */
export function weightAssetIdsFor(
  kind: StoredResultKind,
  results: StoredResult[],
): string[] {
  const ids = new Set<string>();
  for (const r of results) {
    if (r.kind !== kind) continue;
    if (kind === 'optimization' && isOptimizationResult(r.result)) {
      for (const id of Object.keys(r.result.clean_weights)) ids.add(id);
    } else if (kind === 'backtest' && isBacktestResult(r.result)) {
      for (const id of r.result.asset_ids) ids.add(id);
    }
  }
  return [...ids];
}

/** 結果種別ごとの列定義を返す。 */
export function getColumns(
  kind: StoredResultKind,
  assetIds: readonly string[] = ALL_ASSET_IDS,
): MetricColumn[] {
  return kind === 'optimization' ? optimizationColumns(assetIds) : backtestColumns();
}