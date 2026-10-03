import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { assetSetOfResult } from './types';
import type { StoredResult } from './types';

/** このブラウザ内で保持する結果数の上限。超えた分は古いものから破棄する。 */
export const MAX_RESULTS = 50;

interface CompareContextValue {
  /** 比較に蓄積された実行結果（新しい順）。 */
  results: StoredResult[];
  /** 結果を追加する。上限を超えた場合は古いものを破棄する。 */
  addResult: (result: StoredResult) => void;
  /** 結果を削除する。 */
  removeResult: (id: string) => void;
  /** ラベルを更新する。 */
  renameResult: (id: string, label: string) => void;
  /** 全ての結果を削除する。 */
  clearAll: () => void;
}

const CompareContext = createContext<CompareContextValue | null>(null);

/** 比較機能の Provider。App 直下で画面全体を包むことで、画面切替後も結果を保持する。 */
export function CompareProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<StoredResult[]>([]);

  const addResult = useCallback((result: StoredResult) => {
    // モード（資産セット）は結果の基準通貨から導出して保存する（比較表のモード列用）。
    const stored: StoredResult = {
      ...result,
      assetSet: result.assetSet ?? assetSetOfResult(result.result),
    };
    setResults((prev) => [stored, ...prev].slice(0, MAX_RESULTS));
  }, []);

  const removeResult = useCallback((id: string) => {
    setResults((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const renameResult = useCallback((id: string, label: string) => {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }, []);

  const clearAll = useCallback(() => {
    setResults([]);
  }, []);

  const value = useMemo(
    () => ({ results, addResult, removeResult, renameResult, clearAll }),
    [results, addResult, removeResult, renameResult, clearAll],
  );

  return <CompareContext.Provider value={value}>{children}</CompareContext.Provider>;
}

/** 比較機能を利用するフック。Provider の外で呼ぶとエラーにする。 */
export function useCompare(): CompareContextValue {
  const ctx = useContext(CompareContext);
  if (!ctx) {
    throw new Error('useCompare は CompareProvider の内側で利用してください');
  }
  return ctx;
}