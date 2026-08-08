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
