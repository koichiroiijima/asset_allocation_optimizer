import { describe, expect, it } from 'vitest';
import type { BacktestResponse, OptimizationResponse } from '../src/api/types';
import {
  getColumns,
  isBacktestResult,
  isOptimizationResult,
  weightAssetIdsFor,
} from '../src/compare/indicators';
import type { StoredResult } from '../src/compare/types';

/** 最小限の最適化結果を組み立てる。 */
function optimization(
  id: string,
  cleanWeights: Record<string, number>,
): StoredResult {
  const result = {
    method: 'max_sharpe',
    weights: cleanWeights,
    clean_weights: cleanWeights,
    metrics: {
      expected_annual_return: 0.1,
      annual_volatility: 0.05,
      sharpe_ratio: 2.0,
      asset_returns: {},
      asset_volatilities: {},
    },
    params: {
      optimization_method: 'max_sharpe',
      expected_return_method: 'mean_historical_return',
      covariance_method: 'sample_cov',
      risk_free_rate: 0,
      annualization_factor: 252,
      weight_bounds: [0, 1] as [number, number],
    },
    base_currency: 'JPY',
    warnings: [],
  } as unknown as OptimizationResponse;
  return { id, kind: 'optimization', label: id, executedAt: '2026-09-27T00:00:00Z', result };
}

/** 最小限のバックテスト結果を組み立てる。 */
function backtest(id: string, assetIds: string[]): StoredResult {
  const result = {
    asset_ids: assetIds,
    params: {
      weights: Object.fromEntries(assetIds.map((a) => [a, 1 / assetIds.length])),
      rebalance_frequency: 'M',
      initial_capital: 1_000_000,
      cost_rate: 0,
      risk_free_rate: 0,
      annualization_factor: 252,
      lookback: 252,
    },
    currency: 'JPY',
    metrics: {},
    equity_curve: [],
    drawdown: [],
    yearly: [],
    allocation: [],
    trades: [],
    warnings: [],
  } as unknown as BacktestResponse;
  return { id, kind: 'backtest', label: id, executedAt: '2026-09-27T00:00:00Z', result };
}

describe('compare/indicators', () => {
  it('isBacktestResult / isOptimizationResult が種別を判別する', () => {
    const opt = optimization('o1', { jp_equity: 1 });
    const bt = backtest('b1', ['jp_equity']);
    expect(isOptimizationResult(opt.result)).toBe(true);
    expect(isBacktestResult(opt.result)).toBe(false);
    expect(isBacktestResult(bt.result)).toBe(true);
    expect(isOptimizationResult(bt.result)).toBe(false);
  });

  it('weightAssetIdsFor(optimization) は clean_weights の和集合を初出順で返す', () => {
    const results = [
      optimization('o1', { jp_equity: 0.6, jp_bond: 0.4 }),
      optimization('o2', { us_equity: 0.5, jp_equity: 0.5 }),
    ];
    expect(weightAssetIdsFor('optimization', results)).toEqual(['jp_equity', 'jp_bond', 'us_equity']);
  });

  it('weightAssetIdsFor(backtest) は asset_ids の和集合を初出順で返す', () => {
    const results = [backtest('b1', ['jp_equity', 'jp_bond']), backtest('b2', ['jp_bond', 'ex_jp_equity'])];
    expect(weightAssetIdsFor('backtest', results)).toEqual(['jp_equity', 'jp_bond', 'ex_jp_equity']);
  });

  it('weightAssetIdsFor は他種別の結果を無視する', () => {
    const results = [backtest('b1', ['jp_equity'])];
    expect(weightAssetIdsFor('optimization', results)).toEqual([]);
  });

  it('getColumns は渡した資産IDの重み列を生成し、extract がパーセントを返す', () => {
    const columns = getColumns('optimization', ['jp_equity', 'jp_bond']);
    const keys = columns.map((c) => c.key);
    expect(keys).toContain('weight_jp_equity');
    expect(keys).toContain('weight_jp_bond');
    expect(keys).not.toContain('weight_us_equity');

    const weightCol = columns.find((c) => c.key === 'weight_jp_equity')!;
    const extracted = weightCol.extract(optimization('o1', { jp_equity: 0.6, jp_bond: 0.4 }));
    expect(extracted).toBe('60.00%');
  });

  it('getColumns の既定は us/jp 両モードの重み列を持つ', () => {
    const keys = getColumns('optimization').map((c) => c.key);
    for (const id of ['us_equity', 'jp_equity', 'ex_jp_bond']) {
      expect(keys).toContain(`weight_${id}`);
    }
  });

  it('getColumns(backtest) は重み列を含まない', () => {
    const keys = getColumns('backtest').map((c) => c.key);
    expect(keys).not.toContain('weight_jp_equity');
    expect(keys).toContain('cumulative_return');
  });
});
