import type { ExpectedReturnMethod, OptimizationMethod } from '../../api/types';

/** 最適化手法の日本語ラベル。 */
export const METHOD_LABELS: Record<OptimizationMethod, string> = {
  max_sharpe: '最大シャープレシオ',
  min_volatility: '最小ボラティリティ',
  efficient_risk: '目標ボラティリティ（efficient_risk）',
  efficient_return: '目標リターン（efficient_return）',
};

/** 期待リターン方式の日本語ラベル。 */
export const EXPECTED_RETURN_LABELS: Record<ExpectedReturnMethod, string> = {
  mean_historical_return: '平均リターン',
  capm_return: 'CAPM リターン',
  ema_historical_return: 'EMA リターン',
  black_litterman: 'Black-Litterman',
};
