import type {
  AnalysisResponse,
  AnalysisSpec,
  AssetListResponse,
  BacktestRequest,
  BacktestResponse,
  HealthResponse,
  OptimizationRequest,
  OptimizationResponse,
  SeriesResponse,
  SeriesSpec,
} from './types';

/**
 * バックエンド API の小さな fetch ラッパー。
 * 環境変数 ASSET_ALLOC_API_BASE で基点を上書きできる（既定は同オリジンの /api）。
 */
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';

async function getJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    let message = `${resp.status} ${resp.statusText}`;
    try {
      const body = (await resp.json()) as { detail?: unknown };
      if (body && typeof body.detail === 'string') message = body.detail;
    } catch {
      // 本文が JSON でない場合はステータスのみで返す
    }
    throw new Error(message);
  }
  return (await resp.json()) as T;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let message = `${resp.status} ${resp.statusText}`;
    try {
      const data = (await resp.json()) as { detail?: unknown };
      if (data && typeof data.detail === 'string') message = data.detail;
    } catch {
      // 本文が JSON でない場合はステータスのみで返す
    }
    throw new Error(message);
  }
  return (await resp.json()) as T;
}

/** SeriesSpec をクエリ文字列に変換する。未指定の項目は省略。 */
function seriesQuery(spec: SeriesSpec): string {
  const params = new URLSearchParams({ asset_id: spec.asset_id });
  if (spec.start) params.set('start', spec.start);
  if (spec.end) params.set('end', spec.end);
  if (spec.frequency) params.set('frequency', spec.frequency);
  if (spec.series_type) params.set('series_type', spec.series_type);
  return params.toString();
}

/** AnalysisSpec をクエリ文字列に変換する。asset_ids は繰り返し指定。 */
function analysisQuery(spec: AnalysisSpec): string {
  const params = new URLSearchParams();
  for (const asset_id of spec.asset_ids) params.append('asset_ids', asset_id);
  if (spec.start) params.set('start', spec.start);
  if (spec.end) params.set('end', spec.end);
  if (spec.frequency) params.set('frequency', spec.frequency);
  if (spec.window !== undefined) params.set('window', String(spec.window));
  return params.toString();
}

export interface ApiClient {
  getHealth: () => Promise<HealthResponse>;
  getAssets: (assetSet?: string) => Promise<AssetListResponse>;
  getSeries: (spec: SeriesSpec) => Promise<SeriesResponse>;
  getAnalysis: (spec: AnalysisSpec) => Promise<AnalysisResponse>;
  optimize: (payload: OptimizationRequest) => Promise<OptimizationResponse>;
  runBacktest: (payload: BacktestRequest) => Promise<BacktestResponse>;
}

export function createApiClient(): ApiClient {
  return {
    getHealth: () => getJson<HealthResponse>('/health'),
    getAssets: (assetSet?: string) =>
      getJson<AssetListResponse>(
        assetSet ? `/assets?set=${encodeURIComponent(assetSet)}` : '/assets',
      ),
    getSeries: (spec: SeriesSpec) => getJson<SeriesResponse>(`/data/series?${seriesQuery(spec)}`),
    getAnalysis: (spec: AnalysisSpec) =>
      getJson<AnalysisResponse>(`/data/analysis?${analysisQuery(spec)}`),
    optimize: (payload: OptimizationRequest) =>
      postJson<OptimizationResponse>('/optimizations', payload),
    runBacktest: (payload: BacktestRequest) => postJson<BacktestResponse>('/backtests', payload),
  };
}

export const api = createApiClient();
