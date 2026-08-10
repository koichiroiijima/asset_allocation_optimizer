/** 比較・保存機能の型定義。実行結果（最適化・バックテスト）を蓄積し、比較・エクスポートする。 */

import type { BacktestResponse, OptimizationResponse } from '../api/types';

/** 比較に保存する結果の種別。 */
export type StoredResultKind = 'optimization' | 'backtest';

/** 種別の日本語ラベル。 */
export const KIND_LABELS: Record<StoredResultKind, string> = {
  optimization: '最適化',
  backtest: 'バックテスト',
};

/** 比較・保存画面に蓄積する実行結果 1 件。 */
export interface StoredResult {
  /** 汎用一意識別子。 */
  id: string;
  kind: StoredResultKind;
  /** 表示・エクスポートに使うラベル（ユーザーが編集可）。 */
  label: string;
  /** 実行日時（ISO 8601）。表示用。 */
  executedAt: string;
  /** 実行時に指定した開始日（任意）。未指定は undefined（全体期間）。 */
  periodStart?: string;
  /** 実行時に指定した終了日（任意）。未指定は undefined（全体期間）。 */
  periodEnd?: string;
  /** 実行結果の全内容。 */
  result: OptimizationResponse | BacktestResponse;
}

/** 実行結果を一意に識別するための ID（UUID）。テストでは置換可能にする。 */
export function makeResultId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random()}`;
}