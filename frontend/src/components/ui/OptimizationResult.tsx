import { Stack, Table, Text, Title } from '@mantine/core';
import type { OptimizationResponse } from '../../api/types';
import { ResultCard } from './ResultCard';
import { EXPECTED_RETURN_LABELS, METHOD_LABELS } from './optimizationLabels';

interface OptimizationResultProps {
  result: OptimizationResponse;
  /** 資産ID → 表示ラベル（例: 米国株式（VTI））。 */
  assetLabel: (assetId: string) => string;
  /** 「比較に追加」のハンドラ（実行時のリクエスト付き保存は呼び出し側で行う）。 */
  onAdd: () => void;
  added: boolean;
}

/** 最適化結果の表示（最適化 / 最適化（BL）の両画面で共用）。文言・数値フォーマットは旧 UI から不変。 */
export function OptimizationResult({ result, assetLabel, onAdd, added }: OptimizationResultProps) {
  return (
    <ResultCard
      title="最適配分の結果"
      baseCurrency={result.base_currency ?? undefined}
      warnings={result.warnings}
      added={added}
      onAddToCompare={onAdd}
    >
      <Stack gap="xs" mt="xs">
        <Title order={4}>資産別ウェイト</Title>
        {Object.entries(result.clean_weights).length > 0 ? (
          <Table striped highlightOnHover maw={480}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>資産</Table.Th>
                <Table.Th>ウェイト</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(result.clean_weights)
                .sort(([, a], [, b]) => b - a)
                .map(([assetId, value]) => (
                  <Table.Tr key={assetId}>
                    <Table.Td fw={600}>{assetLabel(assetId)}</Table.Td>
                    <Table.Td>{value.toFixed(4)}</Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="yellow.8">
            表示できるウェイトがありません。
          </Text>
        )}

        <Title order={4}>個別資産のリターン・リスク（年率）</Title>
        {Object.keys(result.metrics.asset_returns ?? {}).length > 0 ? (
          <Table striped highlightOnHover maw={720}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>資産</Table.Th>
                <Table.Th>年率リターン（期待）</Table.Th>
                <Table.Th>年率ボラティリティ（リスク）</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.keys(result.metrics.asset_returns)
                .sort()
                .map((assetId) => (
                  <Table.Tr key={assetId}>
                    <Table.Td fw={600}>{assetLabel(assetId)}</Table.Td>
                    <Table.Td>{(result.metrics.asset_returns[assetId] * 100).toFixed(2)}%</Table.Td>
                    <Table.Td>
                      {(result.metrics.asset_volatilities[assetId] * 100).toFixed(2)}%
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="yellow.8">
            表示できる個別資産の統計がありません。
          </Text>
        )}

        <Title order={4}>指標（年率）</Title>
        <Table striped highlightOnHover maw={560}>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td fw={600}>
                期待リターン（{EXPECTED_RETURN_LABELS[result.params.expected_return_method]}）
              </Table.Td>
              <Table.Td>{result.metrics.expected_annual_return.toFixed(4)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td fw={600}>手法</Table.Td>
              <Table.Td>{METHOD_LABELS[result.params.optimization_method]}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td fw={600}>ボラティリティ</Table.Td>
              <Table.Td>{result.metrics.annual_volatility.toFixed(4)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td fw={600}>シャープレシオ</Table.Td>
              <Table.Td>{result.metrics.sharpe_ratio.toFixed(4)}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>

        <Title order={4}>パラメータ</Title>
        <Text size="sm" c="dimmed">
          手法: {result.params.optimization_method} / 期待リターン:{' '}
          {result.params.expected_return_method} / 共分散: {result.params.covariance_method} /{' '}
          リスクフリー金利: {result.params.risk_free_rate} / 年率換算係数:{' '}
          {result.params.annualization_factor} / ウェイト上下限: {result.params.weight_bounds[0]}〜
          {result.params.weight_bounds[1]}
        </Text>
      </Stack>
    </ResultCard>
  );
}
