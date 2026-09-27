/** バックエンド API の型定義。スキーマは backend の OpenAPI と整合させる。 */

export type HealthStatus = 'ok' | 'error';

export interface HealthResponse {
  status: HealthStatus;
  app: string;
  version: string;
  app_env: string;
}

/** 資産セット（モード）。us=米国モード（USD基準）/ jp=日本モード（JPY基準）。 */
export type AssetSet = 'us' | 'jp';

export type LogicalAsset =
  | 'us_equity'
  | 'us_bond'
  | 'ex_us_equity'
  | 'ex_us_bond'
  | 'jp_equity'
  | 'jp_bond'
  | 'ex_jp_equity'
  | 'ex_jp_bond';

/** processed データの状態（assets エンドポイントが合成）。 */
export interface AssetDataStatus {
  logical_asset: LogicalAsset;
  available: boolean;
  start: string | null;
  end: string | null;
  rows: number;
  /** adjusted_close の NaN 行数。 */
  missing: number;
  source: string | null;
  price_type: string | null;
  retrieved_at: string | null;
  snapshot_hash: string | null;
}

export interface Asset {
  logical_asset: LogicalAsset;
  asset_set: AssetSet;
  display_name: string;
  default_ticker: string;
  underlying: string | null;
  asset_class: 'equity' | 'bond';
  currency: string;
  fx_hedged: boolean;
  dividend_policy: 'reinvest' | 'cash';
  history_start: string | null;
  note: string;
  data_status: AssetDataStatus | null;
}

export interface AssetListResponse {
  assets: Asset[];
}

/** `GET /api/data/series` の系列種別と頻度。 */
export type SeriesType = 'price' | 'adjusted_close' | 'return' | 'cumulative';
export type Frequency = 'D' | 'W' | 'M';

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface SeriesResponse {
  asset_id: string;
  currency: string;
  series_type: SeriesType;
  points: SeriesPoint[];
  warnings: string[];
}

export interface SeriesSpec {
  asset_id: string;
  start?: string;
  end?: string;
  frequency?: Frequency;
  series_type?: SeriesType;
}

export type JobType = 'data_fetch' | 'optimization' | 'backtest';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobSummary {
  job_id: string;
  type: JobType;
  status: JobStatus;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface ApiError {
  detail: string;
}

/** `GET /api/data/analysis` のレスポンス。複数資産をまとめて分析画面へ返す。 */
export interface AssetSeries {
  asset_id: string;
  points: SeriesPoint[];
}

export interface CorrelationMatrixResponse {
  assets: string[];
  /** 要素が assets x assets。欠損セルは null。 */
  matrix: (number | null)[][];
}

/** 単一資産のリターン統計（分析画面の統計表用）。未定義は null。 */
export interface AssetStats {
  asset_id: string;
  mean_annual_return: number | null;
  ema_annual_return: number | null;
  annual_volatility: number | null;
  sharpe_ratio: number | null;
}

export interface AnalysisResponse {
  currency: string;
  assets_used: string[];
  window: number;
  prices: AssetSeries[];
  cumulative: AssetSeries[];
  rolling_volatility: AssetSeries[];
  correlation: CorrelationMatrixResponse;
  stats: AssetStats[];
  warnings: string[];
}

export interface AnalysisSpec {
  asset_ids: string[];
  start?: string;
  end?: string;
  frequency?: Frequency;
  window?: number;
}

/** `POST /api/optimizations` のリクエスト/レスポンス。 */
export type OptimizationMethod =
  | 'max_sharpe'
  | 'min_volatility'
  | 'efficient_risk'
  | 'efficient_return';
export type ExpectedReturnMethod =
  | 'mean_historical_return'
  | 'capm_return'
  | 'ema_historical_return'
  | 'black_litterman';
export type CovarianceMethod = 'sample_cov' | 'semicovariance' | 'ledoit_wolf';
export type BlOmegaMethod = 'default' | 'idzorek';

/**
 * 既定の市場ポートフォリオウェイト（BL）を資産セット別に持つ。
 * us: 米国株式/債券と除く株式/債券の時価総額から合成した4資産比率。
 * jp: 日本モードの**仮値**（研究用。日本株/日本債券/外国株/外国債）。後で調整可能。
 */
export const BL_DEFAULT_MARKET_WEIGHTS: Record<string, number> = {
  us_equity: 0.2288,
  us_bond: 0.214,
  ex_us_equity: 0.2373,
  ex_us_bond: 0.3198,
};

export const BL_DEFAULT_MARKET_WEIGHTS_JP: Record<string, number> = {
  jp_equity: 0.25,
  jp_bond: 0.35,
  ex_jp_equity: 0.25,
  ex_jp_bond: 0.15,
};

export const BL_DEFAULT_MARKET_WEIGHTS_BY_SET: Record<AssetSet, Record<string, number>> = {
  us: BL_DEFAULT_MARKET_WEIGHTS,
  jp: BL_DEFAULT_MARKET_WEIGHTS_JP,
};

export interface OptimizationRequest {
  asset_ids: string[];
  start?: string;
  end?: string;
  optimization_method: OptimizationMethod;
  expected_return_method: ExpectedReturnMethod;
  covariance_method: CovarianceMethod;
  risk_free_rate: number;
  annualization_factor: number;
  weight_bounds: [number, number];
  target_return?: number;
  target_volatility?: number;
  /** Black-Litterman 用（expected_return_method='black_litterman' のときのみ意味を持つ）。 */
  bl_market_weights?: Record<string, number>;
  /** 絶対ビュー（年率超過リターン。資産ID→率）。 */
  bl_views?: Record<string, number>;
  /** ビューの確信度（0-1）。omega=idzorek のとき必須。 */
  bl_view_confidences?: Record<string, number>;
  bl_omega_method?: BlOmegaMethod;
  bl_tau?: number;
  /** リスク回避度。省略時は市場ポートフォリオのリターンから逆算。 */
  bl_risk_aversion?: number;
}

export interface OptimizationMetrics {
  expected_annual_return: number;
  annual_volatility: number;
  sharpe_ratio: number;
  /** 個別資産ごとの年率リターン（最適化に使った期待リターン推定）。 */
  asset_returns: Record<string, number>;
  /** 個別資産ごとの年率ボラ（最適化に使った共分散の対角）。 */
  asset_volatilities: Record<string, number>;
}

export interface OptimizationResponse {
  method: OptimizationMethod;
  /** 丸め前の生ウェイト。合計 1 に正規化済み。 */
  weights: Record<string, number>;
  /** 表示用に丸めたウェイト。 */
  clean_weights: Record<string, number>;
  metrics: OptimizationMetrics;
  /** 基準通貨（us=USD / jp=JPY）。 */
  base_currency?: string;
  params: {
    optimization_method: OptimizationMethod;
    expected_return_method: ExpectedReturnMethod;
    covariance_method: CovarianceMethod;
    risk_free_rate: number;
    annualization_factor: number;
    weight_bounds: [number, number];
    bl_market_weights?: Record<string, number>;
    bl_views?: Record<string, number>;
    bl_view_confidences?: Record<string, number>;
    bl_omega_method?: BlOmegaMethod;
    bl_tau?: number;
    bl_risk_aversion?: number;
  };
  warnings: string[];
}

/** `POST /api/backtests` のリクエスト/レスポンス。 */
export type RebalanceFrequency = 'D' | 'W' | 'M' | 'Y';

export interface BacktestRequest {
  asset_ids: string[];
  weights: Record<string, number>;
  rebalance_frequency: RebalanceFrequency;
  initial_capital: number;
  cost_rate: number;
  risk_free_rate: number;
  annualization_factor: number;
  lookback: number;
  /** リバランス時に再最適化するか。 */
  reoptimize?: boolean;
  /** 再最適化に使う最適化パラメータ（保存済み最適化の再現）。 */
  optimization_params?: OptimizationRequest;
  start?: string;
  end?: string;
}

/** 未定義の指標は null（Pydantic の float | None）。 */
export interface BacktestMetrics {
  cumulative_return: number | null;
  annual_return: number | null;
  annual_volatility: number | null;
  sharpe_ratio: number | null;
  sortino_ratio: number | null;
  calmar_ratio: number | null;
  max_drawdown: number | null;
  win_rate: number | null;
  turnover: number | null;
  total_fees: number;
}

export interface EquityPoint {
  date: string;
  value: number;
}

export interface BacktestTrade {
  date: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  value: number;
  fee: number;
}

export interface AllocationPoint {
  date: string;
  weights: Record<string, number>;
}

export interface YearlyPerformance {
  year: number;
  period_return: number;
}

export interface BacktestResponse {
  asset_ids: string[];
  params: {
    weights: Record<string, number>;
    rebalance_frequency: RebalanceFrequency;
    initial_capital: number;
    cost_rate: number;
    risk_free_rate: number;
    annualization_factor: number;
    lookback: number;
    reoptimize?: boolean;
    optimization_params?: OptimizationRequest;
  };
  currency: string;
  metrics: BacktestMetrics;
  equity_curve: EquityPoint[];
  drawdown: EquityPoint[];
  yearly: YearlyPerformance[];
  allocation: AllocationPoint[];
  trades: BacktestTrade[];
  /** リバランス時に採用したターゲットウェイト（再最適化時のみ）。 */
  rebalance_weights?: AllocationPoint[] | null;
  warnings: string[];
}
