import React from 'react';
import type { AssetSet } from '../api/types';

/** 資産セット（モード）の表示名。 */
export const ASSET_SET_LABELS: Record<AssetSet, string> = {
  us: '米国',
  jp: '日本',
};

export const ASSET_SET_DESCRIPTIONS: Record<AssetSet, string> = {
  us: '米国株式・米国債券・米国を除く株式・米国を除く債券（基準通貨 USD）',
  jp: '日本株式・日本債券・日本を除く外国株式・日本を除く外国債券（基準通貨 JPY）',
};

interface AssetSetContextValue {
  /** 現在の資産セット（モード）。既定は 'us'。 */
  assetSet: AssetSet;
  /** 資産セットを切り替える。 */
  setAssetSet: (value: AssetSet) => void;
}

const AssetSetContext = React.createContext<AssetSetContextValue>({
  assetSet: 'us',
  setAssetSet: () => {},
});

interface AssetSetProviderProps {
  children: React.ReactNode;
  /** 初期値（テスト用に注入可能）。 */
  initialAssetSet?: AssetSet;
}

/** 米国モード / 日本モードを全画面で共有する Provider。 */
export function AssetSetProvider({ children, initialAssetSet = 'us' }: AssetSetProviderProps) {
  const [assetSet, setAssetSet] = React.useState<AssetSet>(initialAssetSet);
  const value = React.useMemo(() => ({ assetSet, setAssetSet }), [assetSet]);
  return <AssetSetContext.Provider value={value}>{children}</AssetSetContext.Provider>;
}

/** 現在の資産セットを取得するフック。Provider が無ければ 'us' を返す。 */
export function useAssetSet(): AssetSetContextValue {
  return React.useContext(AssetSetContext);
}
