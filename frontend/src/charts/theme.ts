/**
 * Recharts グラフの共通設定。系列パレットは旧実装（AnalysisScreen / BacktestScreen）から
 * 集約したもの。色と数値フォーマットの既定は変えない。
 */
export const SERIES_COLORS = ['#2a6e9b', '#c0573f', '#2f8f5b', '#b0882f', '#6b5fa8', '#3f9ab0'];

/** 系列色を index で返す（資産数がパレット長を超えたら折り返す）。 */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

/** 全グラフ共通の余白。 */
export const CHART_MARGIN = { top: 8, right: 16, bottom: 8, left: 8 } as const;

/** 月単位のラベルへ整形（Backtest の日付軸で使用・旧実装と同じ）。 */
export function monthTick(date: string): string {
  return date.slice(0, 7);
}

/** 軸を % 表示へ整形（tick 用・小数 0 桁）。 */
export function percentTick(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}
