import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { HealthResponse } from '../api/types';

interface UseHealthResult {
  /** 現在のヘルス状態。未取得時は null。 */
  health: HealthResponse | null;
  /** 直近のエラーメッセージ。取得成功時は null。 */
  error: string | null;
  /** 読み込み中かどうか。 */
  loading: boolean;
  /** 再取得。 */
  refresh: () => Promise<void>;
}

/** ヘルスチェックを取得し、状態を保持するフック。 */
export function useHealth(): UseHealthResult {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getHealth();
      setHealth(result);
    } catch (e) {
      setHealth(null);
      setError(e instanceof Error ? e.message : 'ヘルスチェックに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { health, error, loading, refresh };
}
