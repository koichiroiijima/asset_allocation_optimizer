import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AnalysisResponse, AnalysisSpec } from '../api/types';

interface UseAnalysisResult {
  /** 取得した分析データ。未取得時は null。 */
  analysis: AnalysisResponse | null;
  /** 直近のエラーメッセージ。取得成功時は null。 */
  error: string | null;
  /** 読み込み中かどうか。 */
  loading: boolean;
  /** 指定 spec で再取得。 */
  refresh: () => Promise<void>;
}

/** 指定仕様で分析データを取得し、spec 変更時に再取得するフック。 */
export function useAnalysis(spec: AnalysisSpec | null): UseAnalysisResult {
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    if (!spec) {
      setAnalysis(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAnalysis(spec);
      setAnalysis(result);
    } catch (e) {
      setAnalysis(null);
      setError(e instanceof Error ? e.message : '分析データの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [spec]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { analysis, error, loading, refresh };
}
