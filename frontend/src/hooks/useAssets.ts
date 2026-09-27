import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { AssetListResponse } from '../api/types';
import { useAssetSet } from '../state/AssetSetContext';

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

/**
 * 現在の資産セット（モード）の資産＋データ状態一覧を取得し、保持するフック。
 * モード切替（AssetSetContext）に追従して再取得する。
 */
export function useAssets(): UseAssetsResult {
  const { assetSet } = useAssetSet();
  const [assets, setAssets] = useState<AssetListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAssets(assetSet);
      setAssets(result);
    } catch (e) {
      setAssets(null);
      setError(e instanceof Error ? e.message : '資産一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [assetSet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { assets, error, loading, refresh };
}
