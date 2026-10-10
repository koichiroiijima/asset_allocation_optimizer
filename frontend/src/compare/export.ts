/** JSON / CSV エクスポートの実装。結果を Blob にしてダウンロードする。 */

import type { StoredResult } from './types';

/** Blob をダウンロードさせる共通処理。 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 実行日時のファイル名用表記（YYYYMMDD_HHMMSS）。 */
function timestampForFile(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 実行結果一式を JSON でエクスポートする。 */
export function exportJson(results: StoredResult[]): void {
  const payload = {
    exported_at: new Date().toISOString(),
    results,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlob(`compare_results_${timestampForFile()}.json`, blob);
}

/** CSV 1 セルをエスケープする（引用符を二重化し、区切り・改行を含む場合は引用符で囲む）。 */
function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV ヘッダ行と各行（両方とも既に CSV セル化済み）を受け取り、文字列化する。
 * rows は「全行のセルが揃った二次元配列」を想定する。
 */
function toCsv(cells: string[][]): string {
  return cells.map((row) => row.map((c) => csvCell(c)).join(',')).join('\r\n');
}

/**
 * 比較表（行 = 結果、列 = 指標・属性）を横持ち CSV 化する。
 * cells は「ヘッダ行 + 各結果行」の二次元配列（値は表示用文字列）。
 */
export function exportCsv(cells: string[][]): void {
  const blob = new Blob(['﻿' + toCsv(cells)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(`compare_results_${timestampForFile()}.csv`, blob);
}
