import { useMemo } from 'react';
import { Box, Button, Group, ScrollArea, Table, Text, TextInput, Title } from '@mantine/core';
import { exportCsv, exportJson } from '../compare/export';
import { getColumns, weightAssetIdsFor, type MetricColumn } from '../compare/indicators';
import { useCompare } from '../compare/CompareContext';
import { KIND_LABELS, type StoredResult, type StoredResultKind } from '../compare/types';
import { ASSET_SET_LABELS } from '../state/AssetSetContext';
import { PageHeader } from '../components/ui/PageHeader';

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
      <>
        <PageHeader
          title="比較・保存"
          intro="最適化・バックテストの実行結果を比較し、JSON / CSV エクスポートします。"
        />
        <Text size="sm" c="yellow.8">
          比較に追加した結果がありません。最適化・バックテスト画面の「比較に追加」から結果を保存できます。
        </Text>
        <Text size="sm" c="dimmed">
          保存された結果はこのブラウザ内にのみ保持され、ページを閉じると消えます。
        </Text>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="比較・保存"
        intro="最適化・バックテストの実行結果を比較し、JSON / CSV エクスポートします。"
      />

      <Group gap="sm" mb="md" wrap="wrap">
        <Button variant="default" size="xs" onClick={() => exportJson(results)}>
          JSON エクスポート
        </Button>
        <Button variant="default" size="xs" onClick={() => exportCsv(csvCells)}>
          CSV エクスポート
        </Button>
        <Button variant="default" color="red" size="xs" onClick={clearAll}>
          全削除
        </Button>
        <Text size="sm" c="dimmed">
          JSON は実行結果一式、CSV は指標比較表を保存します。
        </Text>
      </Group>

      <Title order={3}>保存一覧</Title>
      <Table striped highlightOnHover mb="md">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>ラベル</Table.Th>
            <Table.Th>種別</Table.Th>
            <Table.Th>モード</Table.Th>
            <Table.Th>実行日時</Table.Th>
            <Table.Th>期間</Table.Th>
            <Table.Th>操作</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {results.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                <TextInput
                  size="xs"
                  value={r.label}
                  onChange={(e) => renameResult(r.id, e.target.value)}
                  aria-label={`ラベル（${r.label}）`}
                />
              </Table.Td>
              <Table.Td>{KIND_LABELS[r.kind]}</Table.Td>
              <Table.Td>{r.assetSet ? ASSET_SET_LABELS[r.assetSet] : '—'}</Table.Td>
              <Table.Td>{formatExecutedAt(r.executedAt)}</Table.Td>
              <Table.Td>{periodLabel(r)}</Table.Td>
              <Table.Td>
                <Button
                  size="compact-xs"
                  variant="light"
                  color="red"
                  onClick={() => removeResult(r.id)}
                >
                  削除
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Title order={3}>指標比較</Title>
      {(['optimization', 'backtest'] as const).map((kind) => {
        const group = groups.get(kind);
        if (!group || group.length === 0) return null;
        const columns = getColumns(kind, weightAssetIdsFor(kind, results));
        return (
          <Box key={kind} mb="md">
            <Title order={4}>{KIND_LABELS[kind]}の比較</Title>
            <ScrollArea>
              <Table striped highlightOnHover style={{ minWidth: '56rem' }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>結果</Table.Th>
                    {columns.map((c) => (
                      <Table.Th key={c.key} title={c.label}>
                        {c.label}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {group.map(({ result, values }) => (
                    <Table.Tr key={result.id}>
                      <Table.Td fw={600}>{result.label}</Table.Td>
                      {values.map((value, colIndex) => {
                        const isBest = isBestCell(
                          columns[colIndex],
                          value,
                          group.map((r) => r.values[colIndex]),
                        );
                        return (
                          <Table.Td
                            key={columns[colIndex].key}
                            bg={isBest ? 'green.0' : undefined}
                            fw={isBest ? 600 : undefined}
                          >
                            {value ?? '—'}
                          </Table.Td>
                        );
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Box>
        );
      })}

      <Text size="sm" c="dimmed">
        過去の実績・最適化結果であり、将来の成果を保証するものではありません。過学習や期間依存性に
        注意してください。
      </Text>
      <Text size="sm" c="dimmed">
        保存された結果はこのブラウザ内にのみ保持され、ページを閉じると消えます。
      </Text>
    </>
  );
}
