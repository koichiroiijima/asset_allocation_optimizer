import type { AssetListResponse, HealthResponse, SeriesResponse, SeriesSpec } from './types';

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

/** SeriesSpec をクエリ文字列に変換する。未指定の項目は省略。 */
function seriesQuery(spec: SeriesSpec): string {
  const params = new URLSearchParams({ asset_id: spec.asset_id });
  if (spec.start) params.set('start', spec.start);
  if (spec.end) params.set('end', spec.end);
  if (spec.frequency) params.set('frequency', spec.frequency);
  if (spec.series_type) params.set('series_type', spec.series_type);
  return params.toString();
}

export interface ApiClient {
  getHealth: () => Promise<HealthResponse>;
  getAssets: () => Promise<AssetListResponse>;
  getSeries: (spec: SeriesSpec) => Promise<SeriesResponse>;
}

export function createApiClient(): ApiClient {
  return {
    getHealth: () => getJson<HealthResponse>('/health'),
    getAssets: () => getJson<AssetListResponse>('/assets'),
    getSeries: (spec: SeriesSpec) => getJson<SeriesResponse>(`/data/series?${seriesQuery(spec)}`),
  };
}

export const api = createApiClient();
