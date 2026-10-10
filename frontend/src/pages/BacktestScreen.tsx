import { useEffect, useMemo, useState } from 'react';
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
import {
  Box,
  Button,
  Checkbox,
  Group,
  NativeSelect,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { api } from '../api';
import { useCompare } from '../compare/CompareContext';
import { makeResultId, type StoredResult } from '../compare/types';
import { useAssets } from '../hooks/useAssets';
import { useAssetSet } from '../state/AssetSetContext';
import { isOptimizationResult } from '../compare/indicators';
import type {
  Asset,
  BacktestRequest,
  BacktestResponse,
  OptimizationRequest,
  RebalanceFrequency,
} from '../api/types';
import { PageHeader } from '../components/ui/PageHeader';
import { SectionCard } from '../components/ui/SectionCard';
import { ResultCard } from '../components/ui/ResultCard';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { CHART_MARGIN, monthTick, percentTick, seriesColor } from '../charts/theme';

/** リバランス頻度の選択肢。 */
const REBALANCE_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'D', label: '日次' },
  { value: 'W', label: '週次' },
  { value: 'M', label: '月次' },
  { value: 'Y', label: '年次' },
];

/** フォームの入力状態。数値系は文字列で保持し、送信時に Number() 変換する。 */
interface FormState {
  selectedAssetIds: string[];
  weights: Record<string, string>;
  rebalanceFrequency: RebalanceFrequency;
  initialCapital: string;
  costRate: string;
  riskFreeRate: string;
  start: string;
  end: string;
  /** 再最適化元に選んだ最適化結果の id（比較一覧から）。空文字なら未選択＝固定ウェイト。 */
  rebalanceOptimizationId: string;
}

const INITIAL_CAPITAL = '1000000';
const COST_RATE = '0';

/** フォーム入力を BacktestRequest へ変換する。 */
function buildRequest(f: FormState, optimization?: OptimizationRequest): BacktestRequest {
  const weights: Record<string, number> = {};
  for (const a of f.selectedAssetIds) {
    weights[a] = Number(f.weights[a] ?? 0);
  }
  return {
    asset_ids: f.selectedAssetIds,
    weights,
    rebalance_frequency: f.rebalanceFrequency,
    initial_capital: Number(f.initialCapital),
    cost_rate: Number(f.costRate),
    risk_free_rate: Number(f.riskFreeRate),
    annualization_factor: 252,
    lookback: 252,
    // 再最適化元の選択有無で再最適化を切り替える（未選択＝固定ウェイト）。
    reoptimize: optimization != null,
    optimization_params: optimization,
    start: f.start || undefined,
    end: f.end || undefined,
  };
}

/** ウェイトの合計（選択資産分）。 */
function weightSum(f: FormState): number {
  return f.selectedAssetIds.reduce((sum, a) => sum + Number(f.weights[a] ?? 0), 0);
}

/** クライアント側の軽い検証（サーバー 422 に依存しない）。 */
function validateForm(f: FormState): string | null {
  if (f.selectedAssetIds.length < 1) {
    return '対象資産を1件以上選択してください';
  }
  for (const a of f.selectedAssetIds) {
    const w = Number(f.weights[a]);
    if (Number.isNaN(w)) return `資産 ${a} のウェイトは数値で入力してください`;
    if (w < 0 || w > 1) return `資産 ${a} のウェイトは 0〜1 で入力してください`;
  }
  const total = weightSum(f);
  if (Math.abs(total - 1) > 1e-3) {
    return `ウェイトの合計が 1 になっていません（現在: ${total.toFixed(3)}）`;
  }
  if (f.start && f.end && f.start > f.end) {
    return '開始日は終了日以前にしてください';
  }
  const capital = Number(f.initialCapital);
  if (Number.isNaN(capital) || capital <= 0) {
    return '初期資金は正の数値で入力してください';
  }
  return null;
}

/** エラーをユーザー向け日本語へ整形する。 */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'バックテストの実行に失敗しました';
  if (message.includes('422')) {
    return '入力パラメータに問題があります（422）。ウェイトの合計・範囲などを確認してください。';
  }
  return message;
}

/** 実行日時をローカル表記で返す（例: 2026-08-09 10:30）。 */
function formatExecutedAt(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function assetLabel(assetId: string, assets: Asset[] | undefined): string {
  const asset = assets?.find((a) => a.logical_asset === assetId);
  return asset ? `${asset.display_name}（${asset.default_ticker}）` : assetId;
}

/** metrics の表示定義（null は「—」）。 */
const METRIC_ROWS: {
  key: keyof BacktestResponse['metrics'];
  label: string;
  format: (v: number) => string;
}[] = [
  { key: 'cumulative_return', label: '累積リターン', format: (v) => `${(v * 100).toFixed(2)}%` },
  { key: 'annual_return', label: '年率リターン', format: (v) => `${(v * 100).toFixed(2)}%` },
  {
    key: 'annual_volatility',
    label: '年率ボラティリティ',
    format: (v) => `${(v * 100).toFixed(2)}%`,
  },
  { key: 'sharpe_ratio', label: 'シャープレシオ', format: (v) => v.toFixed(2) },
  { key: 'sortino_ratio', label: 'ソルティノレシオ', format: (v) => v.toFixed(2) },
  { key: 'calmar_ratio', label: 'カルマーレシオ', format: (v) => v.toFixed(2) },
  { key: 'max_drawdown', label: '最大ドローダウン', format: (v) => `${(v * 100).toFixed(2)}%` },
  { key: 'win_rate', label: '勝率（日次）', format: (v) => `${(v * 100).toFixed(1)}%` },
  { key: 'turnover', label: '年率回転率', format: (v) => `${(v * 100).toFixed(1)}%` },
];

/** バックテスト画面（固定ウェイト・リバランスのシミュレーション）。 */
export function BacktestScreen() {
  const [form, setForm] = useState<FormState>({
    selectedAssetIds: [],
    weights: {},
    rebalanceFrequency: 'M',
    initialCapital: INITIAL_CAPITAL,
    costRate: COST_RATE,
    riskFreeRate: '0',
    start: '',
    end: '',
    rebalanceOptimizationId: '',
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const { assets, error: assetsError, loading: assetsLoading, refresh } = useAssets();
  const { results: savedResults, addResult } = useCompare();
  const { assetSet } = useAssetSet();

  // モード切替時は前モードの資産選択・ウェイト・再最適化元・結果を初期化する。
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      selectedAssetIds: [],
      weights: {},
      rebalanceOptimizationId: '',
    }));
    setResult(null);
  }, [assetSet]);

  // 再最適化元に選べる最適化結果一覧（比較・保存に蓄積された最適化のみ）。
  const optimizationOptions = useMemo(
    () => savedResults.filter((r) => r.kind === 'optimization'),
    [savedResults],
  );

  const selectedOptimization = useMemo(() => {
    const found = optimizationOptions.find((r) => r.id === form.rebalanceOptimizationId);
    return found && isOptimizationResult(found.result) ? found : undefined;
  }, [optimizationOptions, form.rebalanceOptimizationId]);

  const availableAssets = useMemo(
    () =>
      (assets?.assets ?? []).filter((a) => (a.data_status?.available ?? false) === true) as Asset[],
    [assets],
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleWeightChange = (assetId: string, value: string) => {
    setForm((prev) => ({ ...prev, weights: { ...prev.weights, [assetId]: value } }));
  };

  /** 資産選択の変更に合わせてウェイト入力を同期する（外すと削除・加えると 0 で初期化）。 */
  const handleAssetsChange = (next: string[]) => {
    setForm((prev) => {
      const removed = prev.selectedAssetIds.filter((a) => !next.includes(a));
      const addedIds = next.filter((a) => !prev.selectedAssetIds.includes(a));
      const nextWeights = { ...prev.weights };
      for (const a of removed) delete nextWeights[a];
      for (const a of addedIds) nextWeights[a] = prev.weights[a] ?? '0';
      return { ...prev, selectedAssetIds: next, weights: nextWeights };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validateForm(form);
    if (validationError) {
      setSubmitError(null);
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setSubmitError(null);
    setResult(null);
    setRunning(true);
    try {
      const response = await api.runBacktest(buildRequest(form, selectedOptimization?.request));
      setResult(response);
    } catch (err) {
      setSubmitError(friendlyError(err));
    } finally {
      setRunning(false);
    }
  };

  const weightTotal = weightSum(form);

  return (
    <>
      <PageHeader
        title="バックテスト"
        intro="固定ウェイトでリバランスするバックテストを実行し、累積資産・指標・取引を表示します。"
      />

      {assetsLoading && <Text>資産一覧を読み込み中…</Text>}
      {assetsError && (
        <ErrorNotice
          message={`資産一覧の取得に失敗しました: ${assetsError}`}
          onRetry={() => void refresh()}
        />
      )}

      {!assetsLoading && !assetsError && availableAssets.length === 0 && (
        <Text size="sm" c="yellow.8">
          取得済みの資産がありません。先にデータ取得 CLI を実行してください。
        </Text>
      )}

      {assets && assets.assets.length > 0 && (
        <>
          <form onSubmit={handleSubmit}>
            <Stack gap="md" maw={980}>
              <Checkbox.Group
                label="対象資産（複数選択可）"
                value={form.selectedAssetIds}
                onChange={handleAssetsChange}
              >
                <Group mt="xs" gap="md" wrap="wrap">
                  {/* 未取得資産は選択肢から消さず、入力不可（disabled）で表示する */}
                  {assets.assets.map((a) => {
                    const available = (a.data_status?.available ?? false) === true;
                    return (
                      <Checkbox
                        key={a.logical_asset}
                        value={a.logical_asset}
                        label={`${assetLabel(a.logical_asset, assets.assets)}${available ? '' : '（未取得）'}`}
                        disabled={!available}
                      />
                    );
                  })}
                </Group>
              </Checkbox.Group>

              {form.selectedAssetIds.length > 0 && (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
                  {form.selectedAssetIds.map((assetId) => (
                    <TextInput
                      key={assetId}
                      type="number"
                      step="0.05"
                      min={0}
                      max={1}
                      label={`${assetLabel(assetId, assets?.assets)} ウェイト`}
                      value={form.weights[assetId] ?? '0'}
                      onChange={(e) => handleWeightChange(assetId, e.target.value)}
                    />
                  ))}
                  <Box>
                    <Text size="sm" c="dimmed">
                      ウェイト合計
                    </Text>
                    <Text
                      size="sm"
                      fw={600}
                      c={Math.abs(weightTotal - 1) > 1e-3 ? 'red' : 'dimmed'}
                    >
                      {weightTotal.toFixed(3)}
                    </Text>
                  </Box>
                </SimpleGrid>
              )}

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
                <NativeSelect
                  label="リバランス頻度"
                  value={form.rebalanceFrequency}
                  onChange={(e) =>
                    update('rebalanceFrequency', e.target.value as RebalanceFrequency)
                  }
                  data={REBALANCE_OPTIONS}
                />
                <NativeSelect
                  label="再最適化元の最適化（比較一覧）"
                  value={form.rebalanceOptimizationId}
                  onChange={(e) => update('rebalanceOptimizationId', e.target.value)}
                  data={[
                    { value: '', label: '未選択（固定ウェイト）' },
                    ...optimizationOptions.map((r) => ({ value: r.id, label: r.label })),
                  ]}
                />
                <TextInput
                  type="number"
                  step="any"
                  label="初期資金"
                  description="正の数値（小数可）"
                  value={form.initialCapital}
                  onChange={(e) => update('initialCapital', e.target.value)}
                />
                <TextInput
                  type="number"
                  step="any"
                  label="コスト率（売買両建て）"
                  description="小数（0.001 = 0.1%）"
                  value={form.costRate}
                  onChange={(e) => update('costRate', e.target.value)}
                />
                <TextInput
                  type="number"
                  step="any"
                  label="リスクフリー金利"
                  value={form.riskFreeRate}
                  onChange={(e) => update('riskFreeRate', e.target.value)}
                />
                <TextInput
                  type="date"
                  label="開始日（任意）"
                  value={form.start}
                  onChange={(e) => update('start', e.target.value)}
                />
                <TextInput
                  type="date"
                  label="終了日（任意）"
                  value={form.end}
                  onChange={(e) => update('end', e.target.value)}
                />
              </SimpleGrid>

              <Group gap="sm">
                <Button type="submit" disabled={running}>
                  {running ? '実行中…' : 'バックテストを実行'}
                </Button>
                {formError && (
                  <Text size="sm" c="red">
                    {formError}
                  </Text>
                )}
              </Group>
            </Stack>
          </form>

          <Text size="sm" c="dimmed" my="sm">
            最適化画面で「比較に追加」した結果を選ぶと、各リバランス時点まで
            （開始日またはデータ冒頭から）でそのアルゴリズムにより再最適化します。
            未選択なら固定ウェイトで実行します。再最適化に失敗した時点は直前のウェイトを継続します。
          </Text>
          <Text size="sm" c="dimmed" my="sm">
            約定はシグナル日（月次/週次なら各期間の最終観測日）の翌観測日に行われます。日次リバランス＋正のコストでは回転率・手数料が大きくなります。
          </Text>

          {submitError && (
            <Text size="sm" c="red">
              バックテストの実行に失敗しました: {submitError}
            </Text>
          )}

          {result && (
            <ResultCard
              title="バックテスト結果"
              warnings={result.warnings}
              added={added}
              onAddToCompare={() => {
                addResult({
                  id: makeResultId(),
                  kind: 'backtest',
                  label: `バックテスト（${result.params.rebalance_frequency} / ${result.params.initial_capital}） ${formatExecutedAt()}`,
                  executedAt: new Date().toISOString(),
                  periodStart: form.start || undefined,
                  periodEnd: form.end || undefined,
                  result,
                } satisfies StoredResult);
                setAdded(true);
                window.setTimeout(() => setAdded(false), 2000);
              }}
            >
              <SectionCard title="評価指標（年率）" titleOrder={4}>
                <Table striped highlightOnHover maw={640}>
                  <Table.Tbody>
                    {METRIC_ROWS.map((row) => {
                      const v = result.metrics[row.key];
                      return (
                        <Table.Tr key={row.key}>
                          <Table.Td fw={600}>{row.label}</Table.Td>
                          <Table.Td>{v === null || v === undefined ? '—' : row.format(v)}</Table.Td>
                        </Table.Tr>
                      );
                    })}
                    <Table.Tr>
                      <Table.Td fw={600}>手数料合計</Table.Td>
                      <Table.Td>
                        {result.metrics.total_fees.toFixed(2)} {result.currency}
                      </Table.Td>
                    </Table.Tr>
                  </Table.Tbody>
                </Table>
              </SectionCard>

              <SectionCard title="累積資産" titleOrder={4}>
                {result.equity_curve.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart
                      data={result.equity_curve.map((p) => ({ date: p.date, value: p.value }))}
                      margin={CHART_MARGIN}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={monthTick} />
                      <YAxis domain={['auto', 'auto']} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name="評価額"
                        stroke={seriesColor(0)}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Text size="sm" c="yellow.8">
                    表示できる累積資産がありません。
                  </Text>
                )}
              </SectionCard>

              <SectionCard title="ドローダウン" titleOrder={4}>
                {result.drawdown.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart
                      data={result.drawdown.map((p) => ({ date: p.date, value: p.value * 100 }))}
                      margin={CHART_MARGIN}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={monthTick} />
                      <YAxis domain={['auto', 0]} tickFormatter={percentTick} />
                      <Tooltip />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="value"
                        name="ドローダウン(%)"
                        stroke={seriesColor(1)}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Text size="sm" c="yellow.8">
                    表示できるドローダウンがありません。
                  </Text>
                )}
              </SectionCard>

              <SectionCard title="年次成績" titleOrder={4}>
                {result.yearly.length > 0 ? (
                  <Table striped highlightOnHover maw={360}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>年</Table.Th>
                        <Table.Th>期間リターン</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {result.yearly.map((y) => (
                        <Table.Tr key={y.year}>
                          <Table.Td>{y.year}</Table.Td>
                          <Table.Td>{(y.period_return * 100).toFixed(2)}%</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                ) : (
                  <Text size="sm" c="yellow.8">
                    表示できる年次成績がありません。
                  </Text>
                )}
              </SectionCard>

              <SectionCard title="配分推移（実測ウェイト）" titleOrder={4}>
                {result.allocation.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart
                      data={result.allocation.map((a) => ({
                        date: a.date,
                        ...a.weights,
                      }))}
                      margin={CHART_MARGIN}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" tickFormatter={monthTick} />
                      <YAxis domain={[0, 1]} tickFormatter={percentTick} />
                      <Tooltip />
                      <Legend />
                      {result.asset_ids.map((a, i) => (
                        <Line
                          key={a}
                          type="monotone"
                          dataKey={a}
                          name={assetLabel(a, assets?.assets)}
                          stroke={seriesColor(i)}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <Text size="sm" c="yellow.8">
                    表示できる配分推移がありません。
                  </Text>
                )}
              </SectionCard>

              {result.rebalance_weights && result.rebalance_weights.length > 0 && (
                <SectionCard title="リバランス時の採用ウェイト（再最適化）" titleOrder={4}>
                  <Box style={{ overflowX: 'auto' }}>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>日付</Table.Th>
                          {result.asset_ids.map((a) => (
                            <Table.Th key={a}>{assetLabel(a, assets?.assets)}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {result.rebalance_weights.map((p) => (
                          <Table.Tr key={p.date}>
                            <Table.Td>{p.date}</Table.Td>
                            {result.asset_ids.map((a) => (
                              <Table.Td key={a}>{(p.weights[a] ?? 0).toFixed(4)}</Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Box>
                </SectionCard>
              )}

              <SectionCard title="取引一覧（直近 200 件）" titleOrder={4}>
                {result.trades.length > 0 ? (
                  <Box style={{ overflowX: 'auto' }}>
                    <Table striped highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>日付</Table.Th>
                          <Table.Th>資産</Table.Th>
                          <Table.Th>売買</Table.Th>
                          <Table.Th>数量</Table.Th>
                          <Table.Th>価格</Table.Th>
                          <Table.Th>約定額</Table.Th>
                          <Table.Th>手数料</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {result.trades.slice(-200).map((t, i) => (
                          <Table.Tr key={i}>
                            <Table.Td>{t.date}</Table.Td>
                            <Table.Td>{assetLabel(t.asset_id, assets?.assets)}</Table.Td>
                            <Table.Td>{t.side}</Table.Td>
                            <Table.Td>{t.quantity.toFixed(4)}</Table.Td>
                            <Table.Td>{t.price.toFixed(2)}</Table.Td>
                            <Table.Td>{t.value.toFixed(2)}</Table.Td>
                            <Table.Td>{t.fee.toFixed(4)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Box>
                ) : (
                  <Text size="sm" c="yellow.8">
                    表示できる取引がありません。
                  </Text>
                )}
              </SectionCard>

              <Title order={4}>パラメータ</Title>
              <Text size="sm" c="dimmed">
                対象: {result.asset_ids.map((a) => assetLabel(a, assets?.assets)).join('、')} /
                リバランス頻度: {result.params.rebalance_frequency} / 初期資金:{' '}
                {result.params.initial_capital.toLocaleString()} {result.currency} / コスト率:{' '}
                {result.params.cost_rate} / リスクフリー金利: {result.params.risk_free_rate}
              </Text>

              <Text size="sm" c="dimmed">
                バックテストは過去データによる仮想シミュレーションです。将来の成果や「最適」を保証する
                ものではなく、売買コスト・税金・流動性・価格インパクト・為替を完全には再現しません。
                過学習や期間依存性に注意してください。
              </Text>
            </ResultCard>
          )}
        </>
      )}
    </>
  );
}
