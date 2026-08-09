/** バックエンド API の型定義。スキーマは backend の OpenAPI と整合させる。 */

export type HealthStatus = 'ok' | 'error';

export interface HealthResponse {
  status: HealthStatus;
  app: string;
  version: string;
  app_env: string;
}

export type LogicalAsset = 'us_equity' | 'us_bond' | 'ex_us_equity' | 'ex_us_bond';

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

export interface AnalysisResponse {
  currency: string;
  assets_used: string[];
  window: number;
  prices: AssetSeries[];
  cumulative: AssetSeries[];
  rolling_volatility: AssetSeries[];
  correlation: CorrelationMatrixResponse;
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
  | 'ema_historical_return';
export type CovarianceMethod = 'sample_cov' | 'semicovariance' | 'ledoit_wolf';

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
}

export interface OptimizationMetrics {
  expected_annual_return: number;
  annual_volatility: number;
  sharpe_ratio: number;
}

export interface OptimizationResponse {
  method: OptimizationMethod;
  /** 丸め前の生ウェイト。合計 1 に正規化済み。 */
  weights: Record<string, number>;
  /** 表示用に丸めたウェイト。 */
  clean_weights: Record<string, number>;
  metrics: OptimizationMetrics;
  params: {
    optimization_method: OptimizationMethod;
    expected_return_method: ExpectedReturnMethod;
    covariance_method: CovarianceMethod;
    risk_free_rate: number;
    annualization_factor: number;
    weight_bounds: [number, number];
  };
  warnings: string[];
}
