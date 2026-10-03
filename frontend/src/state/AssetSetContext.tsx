import React from 'react';
import type { AssetSet } from '../api/types';

/** 資産セット（モード）の表示名。 */
export const ASSET_SET_LABELS: Record<AssetSet, string> = {
  us: '米国',
  jp: '日本',
};

/** 資産セット（モード）の基準通貨。 */
export const ASSET_SET_CURRENCIES: Record<AssetSet, string> = {
  us: 'USD',
  jp: 'JPY',
};

export const ASSET_SET_DESCRIPTIONS: Record<AssetSet, string> = {
  us: '米国株式・米国債券・米国を除く株式・米国を除く債券（基準通貨 USD）',
  jp: '日本株式・日本債券・日本を除く外国株式・日本を除く外国債券（基準通貨 JPY）',
};

/** localStorage に保存するキー。 */
export const ASSET_SET_STORAGE_KEY = 'asset-allocation:assetSet';

/** localStorage から資産セットを読み出す（不正値・例外時は null）。 */
export function loadStoredAssetSet(storage: Storage | undefined): AssetSet | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(ASSET_SET_STORAGE_KEY);
    if (raw === 'us' || raw === 'jp') return raw;
    return null;
  } catch {
    // プライベートモード等で localStorage が使えない場合は既定にフォールバック
    return null;
  }
}

/** 資産セットを localStorage へ保存する（例外は握りつぶさず無視＝既定動作に影響しない）。 */
export function saveStoredAssetSet(storage: Storage | undefined, value: AssetSet): void {
  if (!storage) return;
  try {
    storage.setItem(ASSET_SET_STORAGE_KEY, value);
  } catch {
    // 保存できない環境では永続化を諦める（動作には影響しない）
  }
}

interface AssetSetContextValue {
  /** 現在の資産セット（モード）。既定は 'us'（localStorage 復元が優先）。 */
  assetSet: AssetSet;
  /** 資産セットを切り替える（localStorage にも保存する）。 */
  setAssetSet: (value: AssetSet) => void;
}

const AssetSetContext = React.createContext<AssetSetContextValue>({
  assetSet: 'us',
  setAssetSet: () => {},
});

interface AssetSetProviderProps {
  children: React.ReactNode;
  /** 初期値（テスト用に注入可能）。未指定なら localStorage の復元 → 'us'。 */
  initialAssetSet?: AssetSet;
  /** 永続化先（テストで置換可能）。未指定は window.localStorage。 */
  storage?: Storage;
}

/** 米国モード / 日本モードを全画面で共有する Provider。 */
export function AssetSetProvider({
  children,
  initialAssetSet,
  storage = typeof window === 'undefined' ? undefined : window.localStorage,
}: AssetSetProviderProps) {
  const [assetSet, setAssetSetState] = React.useState<AssetSet>(
    () => initialAssetSet ?? loadStoredAssetSet(storage) ?? 'us',
  );

  const setAssetSet = React.useCallback(
    (value: AssetSet) => {
      setAssetSetState(value);
      saveStoredAssetSet(storage, value);
    },
    [storage],
  );

  const value = React.useMemo(() => ({ assetSet, setAssetSet }), [assetSet, setAssetSet]);
  return <AssetSetContext.Provider value={value}>{children}</AssetSetContext.Provider>;
}

/** 現在の資産セットを取得するフック。Provider が無ければ 'us' を返す。 */
export function useAssetSet(): AssetSetContextValue {
  return React.useContext(AssetSetContext);
}