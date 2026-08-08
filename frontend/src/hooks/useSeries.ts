import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { SeriesResponse, SeriesSpec } from '../api/types';

interface UseSeriesResult {
  /** 取得した系列。未取得時は null。 */
  series: SeriesResponse | null;
  /** 直近のエラーメッセージ。取得成功時は null。 */
  error: string | null;
  /** 読み込み中かどうか。 */
  loading: boolean;
  /** 指定 spec で再取得。 */
  refresh: () => Promise<void>;
}

/** 系列仕様に応じた正規化済み系列を取得し、spec 変更時に再取得するフック。 */
export function useSeries(spec: SeriesSpec | null): UseSeriesResult {
  const [series, setSeries] = useState<SeriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!spec) {
      setSeries(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.getSeries(spec);
      setSeries(result);
    } catch (e) {
      setSeries(null);
      setError(e instanceof Error ? e.message : '系列の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [spec]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { series, error, loading, refresh };
}
