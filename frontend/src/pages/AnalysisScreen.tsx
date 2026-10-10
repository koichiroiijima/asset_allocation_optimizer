import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Box, NativeSelect, Table, Text } from '@mantine/core';
import { useAssets } from '../hooks/useAssets';
import type { AnalysisSpec, Asset, Frequency } from '../api/types';
import { useAnalysis } from '../hooks/useAnalysis';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { CHART_MARGIN, percentTick, seriesColor } from '../charts/theme';

/** 頻度の選択肢。 */
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'D', label: '日次' },
  { value: 'W', label: '週次' },
  { value: 'M', label: '月次' },
];

function formatDate(dateText: string): string {
  const d = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateText;
  return d.toLocaleDateString('ja-JP');
}

function assetLabel(assetId: string, assets: Asset[] | undefined): string {
  const asset = assets?.find((a) => a.logical_asset === assetId);
  return asset ? asset.display_name : assetId;
}

/** 1つの資産系列を折れ線にする。dataKey は縦持ち行の資産ID列名（row[assetId]）。 */
function seriesLine(assetId: string, displayName: string, color: string) {
  return (
    <Line
      key={assetId}
      type="monotone"
      dataKey={assetId}
      name={displayName}
      stroke={color}
      dot={false}
      connectNulls={false}
    />
  );
}

/**
 * 価格推移グラフ。複数資産を横軸=日付で並べるため、観測日ごとに
 * `{ date, [assetId]: value }` へ縦持ちにする。値はその資産の観測日の値（他資産は undefined）。
 */
function longestXSeries(
  seriesList: { asset_id: string; points: { date: string; value: number }[] }[],
) {
  let best = seriesList[0] ?? { asset_id: '', points: [] };
  for (const s of seriesList) {
    if (s.points.length > best.points.length) best = s;
  }
  return best.points.map((p) => p.date);
}

/** ローリングボラティリティ・累積リターン：共通の日付ソート済み縦持ちデータ。 */
function seriesMatrix(
  seriesList: { asset_id: string; points: { date: string; value: number }[] }[],
) {
  const xDates = longestXSeries(seriesList);
  return {
    xDates,
    rows: xDates.map((date) => {
      const row: Record<string, string | number | undefined> = { date: formatDate(date) };
      for (const s of seriesList) {
        const point = s.points.find((p) => p.date === date);
        row[s.asset_id] = point?.value;
      }
      return row;
    }),
  };
}

/** 相関表のセル背景（絶対値→彩度）。R から G への連続グラデーション。 */
function corrColor(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '#eef0f3';
  const v = Math.abs(value);
  const t = Math.min(1, v);
  const r = Math.round(238 + t * 17);
  const g = Math.round(240 - t * 215);
  const b = Math.round(243 - t * 233);
  return `rgb(${r}, ${g}, ${b})`;
}

/** 相関表のセル文字色（値が小さいうちは暗い文字で可読性を保つ）。 */
function corrTextColor(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '#1f2430';
  return Math.abs(value) < 0.15 ? '#1f2430' : '#fff';
}

/** 分析画面（価格推移・累積リターン・ローリングボラ・相関ヒートマップ）。 */
export function AnalysisScreen() {
  const [frequency, setFrequency] = useState<Frequency>('D');

  // 資産一覧（データ状態付き）を取得し、取得済み資産だけを対象にする。
  const { assets, error: assetsError, loading: assetsLoading } = useAssets();

  const availableAssets = useMemo(
    () =>
      (assets?.assets ?? []).filter((a) => (a.data_status?.available ?? false) === true) as Asset[],
    [assets],
  );

  const spec = useMemo<AnalysisSpec | null>(
    () =>
      availableAssets.length > 0
        ? { asset_ids: availableAssets.map((a) => a.logical_asset), frequency }
        : null,
    [availableAssets, frequency],
  );

  const { analysis, error: analysisError, loading: analysisLoading, refresh } = useAnalysis(spec);

  return (
    <>
      <PageHeader
        title="分析"
        intro="取得済み資産の価格推移・累積リターン・ローリングボラティリティ・相関を表示します。"
      />

      {assetsLoading && <Text>資産一覧を読み込み中…</Text>}
      {assetsError && (
        <ErrorNotice
          message={`資産一覧の取得に失敗しました: ${assetsError}`}
          onRetry={() => void refresh()}
        />
      )}

      {spec && (
        <Box mb="sm">
          <NativeSelect
            label="頻度"
            w={160}
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
            data={FREQUENCY_OPTIONS}
          />
        </Box>
      )}

      {analysisError && (
        <Text size="sm" c="red">
          分析データの取得に失敗しました: {analysisError}
        </Text>
      )}
      {analysisLoading && <Text>分析データを読み込み中…</Text>}

      {analysis && (
        <>
          {(analysis.warnings ?? []).map((w, i) => (
            <Text key={i} size="sm" c="yellow.8">
              {w}
            </Text>
          ))}

          {analysis.assets_used.length === 0 ? (
            <Text size="sm" c="yellow.8">
              取得済みの資産がありません。先にデータ取得 CLI を実行してください。
            </Text>
          ) : (
            <>
              <Text size="sm" c="dimmed" mb="sm">
                対象資産:{' '}
                {analysis.assets_used.map((a) => assetLabel(a, assets?.assets)).join('、')}
                {' / '}通貨: {analysis.currency}
              </Text>

              <SectionCard title="価格推移">
                {(() => {
                  const { rows } = seriesMatrix(analysis.prices);
                  return rows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={rows} margin={CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={['auto', 'auto']} />
                        <Tooltip />
                        <Legend />
                        {analysis.prices.map((s, i) =>
                          seriesLine(
                            s.asset_id,
                            assetLabel(s.asset_id, assets?.assets),
                            seriesColor(i),
                          ),
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <Text size="sm" c="yellow.8">
                      表示できる価格データがありません。
                    </Text>
                  );
                })()}
              </SectionCard>

              <SectionCard title="リターン・リスク統計（年率）">
                {analysis.stats.length > 0 ? (
                  <>
                    <Table striped highlightOnHover maw={720}>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>資産</Table.Th>
                          <Table.Th>平均リターン</Table.Th>
                          <Table.Th>EMA リターン</Table.Th>
                          <Table.Th>年率ボラティリティ（リスク）</Table.Th>
                          <Table.Th>シャープレシオ</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {analysis.stats.map((s) => {
                          const fmtPct = (v: number | null) =>
                            v === null || v === undefined ? '—' : `${(v * 100).toFixed(2)}%`;
                          const fmtRatio = (v: number | null) =>
                            v === null || v === undefined ? '—' : v.toFixed(2);
                          return (
                            <Table.Tr key={s.asset_id}>
                              <Table.Td fw={600}>{assetLabel(s.asset_id, assets?.assets)}</Table.Td>
                              <Table.Td>{fmtPct(s.mean_annual_return)}</Table.Td>
                              <Table.Td>{fmtPct(s.ema_annual_return)}</Table.Td>
                              <Table.Td>{fmtPct(s.annual_volatility)}</Table.Td>
                              <Table.Td>{fmtRatio(s.sharpe_ratio)}</Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                    <Text size="sm" c="dimmed">
                      平均リターンは観測期間の幾何加重平均、EMA
                      リターンは直近を重視した指数加重平均（500日）の年率値です。 リスクフリー金利は
                      0%
                      としてシャープレシオを計算しています。将来の成果を保証するものではありません。
                    </Text>
                  </>
                ) : (
                  <Text size="sm" c="yellow.8">
                    表示できるリターン統計がありません。
                  </Text>
                )}
              </SectionCard>

              <SectionCard title="累積リターン">
                {(() => {
                  const { rows } = seriesMatrix(analysis.cumulative);
                  return rows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={rows} margin={CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={['auto', 'auto']} tickFormatter={percentTick} />
                        <Tooltip />
                        <Legend />
                        {analysis.cumulative.map((s, i) =>
                          seriesLine(
                            s.asset_id,
                            assetLabel(s.asset_id, assets?.assets),
                            seriesColor(i),
                          ),
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <Text size="sm" c="yellow.8">
                      表示できる累積リターンがありません。
                    </Text>
                  );
                })()}
              </SectionCard>

              <SectionCard title={`ローリングボラティリティ（窓 ${analysis.window} 日・年率）`}>
                {(() => {
                  const { rows } = seriesMatrix(analysis.rolling_volatility);
                  return rows.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={rows} margin={CHART_MARGIN}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={['auto', 'auto']} tickFormatter={percentTick} />
                        <Tooltip />
                        <Legend />
                        {analysis.rolling_volatility.map((s, i) =>
                          seriesLine(
                            s.asset_id,
                            assetLabel(s.asset_id, assets?.assets),
                            seriesColor(i),
                          ),
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <Text size="sm" c="yellow.8">
                      表示できるローリングボラティリティがありません。
                    </Text>
                  );
                })()}
              </SectionCard>

              <SectionCard title={`相関（${analysis.assets_used.length}資産）`}>
                {analysis.correlation.assets.length > 0 ? (
                  <Box style={{ overflowX: 'auto' }} maw={760}>
                    <Table withTableBorder horizontalSpacing="xs" verticalSpacing="xs">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th />
                          {analysis.correlation.assets.map((a) => (
                            <Table.Th key={a} style={{ whiteSpace: 'nowrap' }}>
                              {assetLabel(a, assets?.assets)}
                            </Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {analysis.correlation.assets.map((rowAsset, i) => (
                          <Table.Tr key={rowAsset}>
                            <Table.Th style={{ whiteSpace: 'nowrap' }}>
                              {assetLabel(rowAsset, assets?.assets)}
                            </Table.Th>
                            {analysis.correlation.matrix[i]?.map((v, j) => (
                              <Table.Td
                                key={`${rowAsset}-${analysis.correlation.assets[j] ?? j}`}
                                style={{
                                  backgroundColor: corrColor(v),
                                  color: corrTextColor(v),
                                  fontWeight: 600,
                                  textAlign: 'center',
                                  minWidth: '5rem',
                                }}
                                title={v === null ? '欠損' : v.toFixed(3)}
                              >
                                {v === null ? '—' : v.toFixed(2)}
                              </Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Box>
                ) : (
                  <Text size="sm" c="yellow.8">
                    相関の表示データがありません。
                  </Text>
                )}
                <Text size="sm" c="dimmed">
                  相関は各資産のリターン系列から計算します。欠損セルは計算に使える共通データがないことを示します。
                </Text>
              </SectionCard>
            </>
          )}
        </>
      )}
    </>
  );
}
