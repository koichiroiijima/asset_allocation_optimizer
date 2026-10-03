import { useMemo } from 'react';
import { exportCsv, exportJson } from '../compare/export';
import { getColumns, weightAssetIdsFor, type MetricColumn } from '../compare/indicators';
import { useCompare } from '../compare/CompareContext';
import { KIND_LABELS, type StoredResult, type StoredResultKind } from '../compare/types';
import { ASSET_SET_LABELS } from '../state/AssetSetContext';

/** 実行日時（ISO）をローカル表記へ。 */
function formatExecutedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 結果ごとに指定した期間。未指定は「全体」。 */
function periodLabel(r: StoredResult): string {
  if (r.periodStart || r.periodEnd) {
    return `${r.periodStart ?? '（先頭）'} 〜 ${r.periodEnd ?? '（最新）'}`;
  }
  return '全体';
}

/** 各セルの抽出値を列ごとにまとめる。 */
interface RowView {
  result: StoredResult;
  /** getColumns(kind) と同じ順序。 */
  values: (string | undefined)[];
}

/** 種別ごとに結果をまとめ、表示セル値を列ごとに引き出す。 */
function groupByKind(results: StoredResult[]): Map<StoredResultKind, RowView[]> {
  const map = new Map<StoredResultKind, RowView[]>();
  // 表示する資産は結果に存在するものだけ（us / jp の混在に対応）。
  const assetIds = weightAssetIdsFor('optimization', results);
  for (const result of results) {
    const columns = getColumns(result.kind, assetIds);
    const values = columns.map((c) => c.extract(result));
    const group = map.get(result.kind) ?? [];
    group.push({ result, values });
    map.set(result.kind, group);
  }
  return map;
}

/** CSV 用のヘッダ・セル（種別ごとの列を並べる）。CSV は生値（csvRaw）を使う。 */
function buildCsvCells(results: StoredResult[]): string[][] {
  const header = ['ラベル', '種別', 'モード', '実行日時', '期間'];
  // 列は「全種別の列」を種別順に並べる（重複ラベルも列が分かるよう残す）
  const kinds: StoredResultKind[] = ['optimization', 'backtest'];
  const allColumns: MetricColumn[] = kinds.flatMap((k) =>
    getColumns(k, weightAssetIdsFor('optimization', results)),
  );
  header.push(...allColumns.map((c) => c.label));
  const lines = results.map((r) => {
    const values = allColumns.map((c) => {
      const raw = c.csvRaw(r);
      return raw === null || raw === undefined ? '' : String(raw);
    });
    return [
      r.label,
      KIND_LABELS[r.kind],
      r.assetSet ? ASSET_SET_LABELS[r.assetSet] : '',
      r.executedAt,
      periodLabel(r),
      ...values,
    ];
  });
  return [header, ...lines];
}

/** 列値を数値へ戻す（%・カンマ・空白を除去）。変換不可は null。 */
function parseNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const n = Number(text.replace(/[%,、\s]/g, ''));
  return Number.isNaN(n) ? null : n;
}

/** 列の中で最良値（数値扱いできるもの限定）かどうか。 */
function isBestCell(
  column: MetricColumn,
  value: string | undefined,
  sameColumnValues: (string | undefined)[],
): boolean {
  const nums = sameColumnValues.map(parseNumber).filter((n): n is number => n !== null);
  if (nums.length === 0 || parseNumber(value) === null) {
    return false;
  }
  if (column.isHigherBetter) {
    return parseNumber(value) === Math.max(...nums);
  }
  return parseNumber(value) === Math.min(...nums);
}

/** 比較・保存画面（複数結果の比較と JSON/CSV エクスポート）。 */
export function CompareScreen() {
  const { results, removeResult, renameResult, clearAll } = useCompare();

  const groups = useMemo(() => groupByKind(results), [results]);
  const csvCells = useMemo(() => buildCsvCells(results), [results]);

  if (results.length === 0) {
    return (
      <section>
        <h2>比較・保存</h2>
        <p className="warning-text">
          比較に追加した結果がありません。最適化・バックテスト画面の「比較に追加」から結果を保存できます。
        </p>
        <p className="hint-text">
          保存された結果はこのブラウザ内にのみ保持され、ページを閉じると消えます。
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2>比較・保存</h2>
      <p>最適化・バックテストの実行結果を比較し、JSON / CSV エクスポートします。</p>

      <div className="compare-toolbar">
        <button type="button" onClick={() => exportJson(results)}>
          JSON エクスポート
        </button>
        <button type="button" onClick={() => exportCsv(csvCells)}>
          CSV エクスポート
        </button>
        <button type="button" onClick={clearAll}>
          全削除
        </button>
        <span className="hint-text">JSON は実行結果一式、CSV は指標比較表を保存します。</span>
      </div>

      <h3>保存一覧</h3>
      <table className="result-table">
        <thead>
          <tr>
            <th>ラベル</th>
            <th>種別</th>
            <th>モード</th>
            <th>実行日時</th>
            <th>期間</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id}>
              <td>
                <input
                  value={r.label}
                  onChange={(e) => renameResult(r.id, e.target.value)}
                  aria-label={`ラベル（${r.label}）`}
                />
              </td>
              <td>{KIND_LABELS[r.kind]}</td>
              <td>{r.assetSet ? ASSET_SET_LABELS[r.assetSet] : '—'}</td>
              <td>{formatExecutedAt(r.executedAt)}</td>
              <td>{periodLabel(r)}</td>
              <td>
                <button type="button" onClick={() => removeResult(r.id)}>
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>指標比較</h3>
      {(['optimization', 'backtest'] as const).map((kind) => {
        const group = groups.get(kind);
        if (!group || group.length === 0) return null;
        const columns = getColumns(kind, weightAssetIdsFor(kind, results));
        return (
          <div key={kind}>
            <h4>{KIND_LABELS[kind]}の比較</h4>
            <div className="compare-scroll">
              <table className="result-table">
                <thead>
                  <tr>
                    <th className="row-header">結果</th>
                    {columns.map((c) => (
                      <th key={c.key} title={c.label}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.map(({ result, values }) => (
                    <tr key={result.id}>
                      <td className="row-header">{result.label}</td>
                      {values.map((value, colIndex) => {
                        const isBest = isBestCell(columns[colIndex], value, group.map((r) => r.values[colIndex]));
                        return (
                          <td key={columns[colIndex].key} className={isBest ? 'better-cell' : undefined}>
                            {value ?? '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <p className="hint-text">
        過去の実績・最適化結果であり、将来の成果を保証するものではありません。過学習や期間依存性に
        注意してください。
      </p>
      <p className="hint-text">
        保存された結果はこのブラウザ内にのみ保持され、ページを閉じると消えます。
      </p>
    </section>
  );
}