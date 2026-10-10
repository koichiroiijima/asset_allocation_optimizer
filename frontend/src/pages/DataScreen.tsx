import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, Group, NativeSelect, Table, Text } from '@mantine/core';
import type { Asset } from '../api';
import { useAssets } from '../hooks/useAssets';
import { useSeries } from '../hooks/useSeries';
import type { Frequency, SeriesSpec, SeriesType } from '../api/types';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { CHART_MARGIN, seriesColor } from '../charts/theme';

/** 系列種別の選択肢（adjusted_close 必須 ＋ return / cumulative）。 */
const SERIES_TYPE_OPTIONS: { value: SeriesType; label: string }[] = [
  { value: 'adjusted_close', label: '調整済み終値 (adjusted close)' },
  { value: 'return', label: '単純リターン' },
  { value: 'cumulative', label: '累積リターン' },
];

/** 頻度の選択肢。 */
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'D', label: '日次' },
  { value: 'W', label: '週次' },
  { value: 'M', label: '月次' },
];

const ASSET_CLASS_LABEL: Record<string, string> = {
  equity: '株式',
  bond: '債券',
};

function formatDate(dateText: string): string {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  return d.toLocaleDateString('ja-JP');
}

function formatRetrieved(asset: Asset): string {
  const iso = asset.data_status?.retrieved_at;
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP');
}

/** データ画面（候補・データソース・期間・欠損・取得日時・系列グラフ）。 */
export function DataScreen() {
  const { assets, error: assetsError, loading: assetsLoading, refresh } = useAssets();

  const [assetId, setAssetId] = useState<string>('');
  const [seriesType, setSeriesType] = useState<SeriesType>('adjusted_close');
  const [frequency, setFrequency] = useState<Frequency>('D');

  // インライン生成では毎レンダーで spec の同一性が変わり再取得ループになるため useMemo で固定する
  const spec = useMemo<SeriesSpec | null>(
    () => (assetId ? { asset_id: assetId, frequency, series_type: seriesType } : null),
    [assetId, frequency, seriesType],
  );

  const { series, error: seriesError, loading: seriesLoading } = useSeries(spec);

  const selectedAsset = assets?.assets.find((a) => a.logical_asset === assetId);

  return (
    <>
      <PageHeader
        title="データ"
        intro="4資産の候補・データソース・期間・欠損・取得日時・価格種別を確認します。"
      />

      {assetsLoading && <Text>読み込み中…</Text>}
      {assetsError && (
        <ErrorNotice
          message={`資産一覧の取得に失敗しました: ${assetsError}`}
          onRetry={() => void refresh()}
        />
      )}

      {assets && (
        <>
          <SectionCard title="資産一覧">
            <Box style={{ overflowX: 'auto' }}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>資産</Table.Th>
                    <Table.Th>ティッカー</Table.Th>
                    <Table.Th>資産クラス</Table.Th>
                    <Table.Th>通貨</Table.Th>
                    <Table.Th>出所</Table.Th>
                    <Table.Th>期間</Table.Th>
                    <Table.Th>欠損</Table.Th>
                    <Table.Th>取得日時</Table.Th>
                    <Table.Th>状態</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {assets.assets.map((a) => {
                    const ds = a.data_status;
                    const available = ds?.available ?? false;
                    return (
                      <Table.Tr key={a.logical_asset}>
                        <Table.Td>{a.display_name}</Table.Td>
                        <Table.Td>{a.default_ticker}</Table.Td>
                        <Table.Td>{ASSET_CLASS_LABEL[a.asset_class] ?? a.asset_class}</Table.Td>
                        <Table.Td>{a.currency}</Table.Td>
                        <Table.Td>{ds?.source ?? '—'}</Table.Td>
                        <Table.Td>
                          {available && ds?.start
                            ? `${formatDate(ds.start)} ～ ${formatDate(ds.end ?? '')}`
                            : '—'}
                        </Table.Td>
                        <Table.Td>{available ? `${ds?.missing ?? 0} 行` : '—'}</Table.Td>
                        <Table.Td>{available ? formatRetrieved(a) : '—'}</Table.Td>
                        <Table.Td>
                          <StatusBadge available={available} />
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Box>
          </SectionCard>

          <SectionCard title="系列グラフ">
            <Group gap="md" align="flex-end" mb="sm" wrap="wrap">
              <NativeSelect
                label="資産"
                w={280}
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                data={[
                  { value: '', label: '選択してください' },
                  ...assets.assets.map((a) => ({
                    value: a.logical_asset,
                    label: `${a.display_name}（${a.default_ticker}）`,
                  })),
                ]}
              />
              <NativeSelect
                label="系列種別"
                w={280}
                value={seriesType}
                onChange={(e) => setSeriesType(e.target.value as SeriesType)}
                data={SERIES_TYPE_OPTIONS}
              />
              <NativeSelect
                label="頻度"
                w={160}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                data={FREQUENCY_OPTIONS}
              />
            </Group>

            {selectedAsset && (
              <>
                <Text size="sm" c="dimmed">
                  {selectedAsset.display_name} / {seriesType} / {frequency}
                </Text>
                {seriesLoading && <Text>系列を読み込み中…</Text>}
                {seriesError && (
                  <Text size="sm" c="red">
                    系列の取得に失敗しました: {seriesError}
                  </Text>
                )}
                {series && (
                  <>
                    {(series.warnings ?? []).map((w, i) => (
                      <Text key={i} size="sm" c="yellow.8">
                        {w}
                      </Text>
                    ))}
                    {series.points.length > 0 ? (
                      <ResponsiveContainer width="100%" height={320}>
                        <LineChart
                          data={series.points.map((p) => ({
                            date: formatDate(p.date),
                            value: p.value,
                          }))}
                          margin={CHART_MARGIN}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" />
                          <YAxis domain={['auto', 'auto']} />
                          <Tooltip />
                          <Line
                            type="monotone"
                            dataKey="value"
                            name="値"
                            stroke={seriesColor(0)}
                            dot={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <Text size="sm" c="yellow.8">
                        表示できる系列データがありません。
                      </Text>
                    )}
                    <Text size="sm" c="dimmed">
                      通貨: {series.currency}
                    </Text>
                  </>
                )}
              </>
            )}
          </SectionCard>
        </>
      )}
    </>
  );
}
