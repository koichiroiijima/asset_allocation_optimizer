import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AssetListResponse } from '../api/types';

interface UseAssetsResult {
  /** 資産一覧（データ状態付き）。未取得時は null。 */
  assets: AssetListResponse | null;
  /** 直近のエラーメッセージ。取得成功時は null。 */
  error: string | null;
  /** 読み込み中かどうか。 */
  loading: boolean;
  /** 再取得。 */
  refresh: () => Promise<void>;
}

/** 4 資産＋データ状態の一覧を取得し、保持するフック。 */
export function useAssets(): UseAssetsResult {
  const [assets, setAssets] = useState<AssetListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAssets();
      setAssets(result);
    } catch (e) {
      setAssets(null);
      setError(e instanceof Error ? e.message : '資産一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { assets, error, loading, refresh };
}
