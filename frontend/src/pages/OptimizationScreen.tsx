import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Group,
  NativeSelect,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { api } from '../api';
import { useCompare } from '../compare/CompareContext';
import { makeResultId, type StoredResult } from '../compare/types';
import { useAssets } from '../hooks/useAssets';
import { useAssetSet } from '../state/AssetSetContext';
import type {
  Asset,
  CovarianceMethod,
  ExpectedReturnMethod,
  OptimizationMethod,
  OptimizationRequest,
  OptimizationResponse,
} from '../api/types';
import { PageHeader } from '../components/ui/PageHeader';
import { OptimizationResult } from '../components/ui/OptimizationResult';
import { ErrorNotice } from '../components/ui/ErrorNotice';

/** 最適化手法の選択肢。 */
const METHOD_OPTIONS: { value: OptimizationMethod; label: string }[] = [
  { value: 'max_sharpe', label: '最大シャープレシオ' },
  { value: 'min_volatility', label: '最小ボラティリティ' },
  { value: 'efficient_risk', label: '目標ボラティリティ（efficient_risk）' },
  { value: 'efficient_return', label: '目標リターン（efficient_return）' },
];

/** 期待リターン推定の選択肢。capm_return は API 経由でベンチマークを渡せないため除外。 */
const EXPECTED_RETURN_OPTIONS: { value: ExpectedReturnMethod; label: string }[] = [
  { value: 'mean_historical_return', label: '平均歴史的リターン' },
  { value: 'ema_historical_return', label: 'EMA リターン' },
];

/** 共分散推定の選択肢。 */
const COVARIANCE_OPTIONS: { value: CovarianceMethod; label: string }[] = [
  { value: 'sample_cov', label: '標本共分散' },
  { value: 'semicovariance', label: 'セミコバリアンス' },
  { value: 'ledoit_wolf', label: 'Ledoit-Wolf 収縮' },
];

/**
 * フォームの入力状態。数値系はキャレット位置・空欄入力を許容するため文字列で保持し、
 * 送信時（`buildRequest`）に `Number()` へ変換する。
 */
interface FormState {
  selectedAssetIds: string[];
  method: OptimizationMethod;
  expectedReturnMethod: ExpectedReturnMethod;
  covarianceMethod: CovarianceMethod;
  start: string;
  end: string;
  riskFreeRate: string;
  targetReturn: string;
  targetVolatility: string;
  weightLower: string;
  weightUpper: string;
  annualizationFactor: string;
}

const INITIAL_FORM: FormState = {
  selectedAssetIds: [],
  method: 'max_sharpe',
  expectedReturnMethod: 'mean_historical_return',
  covarianceMethod: 'sample_cov',
  start: '',
  end: '',
  riskFreeRate: '0',
  targetReturn: '',
  targetVolatility: '',
  weightLower: '0',
  weightUpper: '1',
  annualizationFactor: '252',
};

/** フォーム入力を `OptimizationRequest` へ変換する。date input は既に YYYY-MM-DD 形式。 */
function buildRequest(f: FormState): OptimizationRequest {
  return {
    asset_ids: f.selectedAssetIds,
    optimization_method: f.method,
    expected_return_method: f.expectedReturnMethod,
    covariance_method: f.covarianceMethod,
    risk_free_rate: Number(f.riskFreeRate),
    annualization_factor: Math.round(Number(f.annualizationFactor)),
    weight_bounds: [Number(f.weightLower), Number(f.weightUpper)],
    start: f.start || undefined,
    end: f.end || undefined,
    ...(f.method === 'efficient_return' ? { target_return: Number(f.targetReturn) } : {}),
    ...(f.method === 'efficient_risk' ? { target_volatility: Number(f.targetVolatility) } : {}),
  };
}

/**
 * クライアント側の軽い検証。null なら問題なし、そうでなければエラーメッセージを返す。
 * サーバー 422（detail が配列で UI に出せない）に依存しないために実行前に弾く。
 */
function validateForm(f: FormState): string | null {
  if (f.selectedAssetIds.length < 2) {
    return '対象資産を2件以上選択してください';
  }
  const riskFreeRate = Number(f.riskFreeRate);
  const annualizationFactor = Number(f.annualizationFactor);
  if (Number.isNaN(riskFreeRate) || Number.isNaN(annualizationFactor)) {
    return 'リスクフリー金利・年率換算係数は数値で入力してください';
  }
  if (!Number.isInteger(annualizationFactor) || annualizationFactor < 1) {
    return '年率換算係数は1以上の整数で入力してください';
  }
  const weightLower = Number(f.weightLower);
  const weightUpper = Number(f.weightUpper);
  if (Number.isNaN(weightLower) || Number.isNaN(weightUpper)) {
    return 'ウェイト上下限は数値で入力してください';
  }
  if (weightLower < 0) {
    return 'ウェイト下限を負にはできません';
  }
  if (weightLower > weightUpper) {
    return 'ウェイト下限は上限以下にしてください';
  }
  if (f.start && f.end && f.start > f.end) {
    return '開始日は終了日以前にしてください';
  }
  if (f.method === 'efficient_return' && !f.targetReturn.trim()) {
    return 'efficient_return には target_return（目標リターン）が必要です';
  }
  if (f.method === 'efficient_risk' && !f.targetVolatility.trim()) {
    return 'efficient_risk には target_volatility（目標ボラティリティ）が必要です';
  }
  return null;
}

/** エラーをユーザー向け日本語メッセージへ整形する。 */
function friendlyError(err: unknown): string {
  const message = err instanceof Error ? err.message : '最適化の実行に失敗しました';
  if (message.includes('422')) {
    return '入力パラメータに問題があります（422）。値・期間・範囲を確認して再実行してください。';
  }
  return message;
}

function assetLabel(assetId: string, assets: Asset[] | undefined): string {
  const asset = assets?.find((a) => a.logical_asset === assetId);
  return asset ? `${asset.display_name}（${asset.default_ticker}）` : assetId;
}

/** 実行日時をローカル表記で返す（例: 2026-08-09 10:30）。 */
function formatExecutedAt(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 最適化画面（手法・期間・制約の入力と結果表示）。 */
export function OptimizationScreen() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OptimizationResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const { assets, error: assetsError, loading: assetsLoading, refresh } = useAssets();
  const { addResult } = useCompare();
  const { assetSet } = useAssetSet();

  // モード切替時は前モードの選択・結果を初期化する。
  useEffect(() => {
    setForm({ ...INITIAL_FORM });
    setResult(null);
  }, [assetSet]);

  // 取得済み資産のみを対象にする（分析画面と同様の絞り込み）。
  const availableAssets = useMemo(
    () =>
      (assets?.assets ?? []).filter((a) => (a.data_status?.available ?? false) === true) as Asset[],
    [assets],
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      const response = await api.optimize(buildRequest(form));
      setResult(response);
    } catch (err) {
      setSubmitError(friendlyError(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHeader
        title="最適化"
        intro="PyPortfolioOpt の手法・期間・制約を入力し、ウェイトとリスク指標を表示します。"
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
                onChange={(value) => update('selectedAssetIds', [...value])}
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

              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" verticalSpacing="md">
                <NativeSelect
                  label="手法"
                  value={form.method}
                  onChange={(e) => update('method', e.target.value as OptimizationMethod)}
                  data={METHOD_OPTIONS}
                />
                <NativeSelect
                  label="期待リターン"
                  value={form.expectedReturnMethod}
                  onChange={(e) =>
                    update('expectedReturnMethod', e.target.value as ExpectedReturnMethod)
                  }
                  data={EXPECTED_RETURN_OPTIONS}
                />
                <NativeSelect
                  label="共分散"
                  value={form.covarianceMethod}
                  onChange={(e) => update('covarianceMethod', e.target.value as CovarianceMethod)}
                  data={COVARIANCE_OPTIONS}
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
                <TextInput
                  type="number"
                  step="0.001"
                  label="リスクフリー金利"
                  description="年率・小数（例 0.02 = 2%）"
                  value={form.riskFreeRate}
                  onChange={(e) => update('riskFreeRate', e.target.value)}
                />
                <TextInput
                  type="number"
                  step="0.001"
                  label="目標リターン（年率）"
                  description="efficient_return のときのみ有効"
                  disabled={form.method !== 'efficient_return'}
                  value={form.targetReturn}
                  onChange={(e) => update('targetReturn', e.target.value)}
                />
                <TextInput
                  type="number"
                  step="0.001"
                  label="目標ボラティリティ（年率）"
                  description="efficient_risk のときのみ有効"
                  disabled={form.method !== 'efficient_risk'}
                  value={form.targetVolatility}
                  onChange={(e) => update('targetVolatility', e.target.value)}
                />
                <TextInput
                  type="number"
                  step="0.05"
                  label="ウェイト下限"
                  value={form.weightLower}
                  onChange={(e) => update('weightLower', e.target.value)}
                />
                <TextInput
                  type="number"
                  step="0.05"
                  label="ウェイト上限"
                  value={form.weightUpper}
                  onChange={(e) => update('weightUpper', e.target.value)}
                />
                <TextInput
                  type="number"
                  step="1"
                  label="年率換算係数"
                  value={form.annualizationFactor}
                  onChange={(e) => update('annualizationFactor', e.target.value)}
                />
              </SimpleGrid>

              <Group gap="sm">
                <Button type="submit" disabled={running}>
                  {running ? '実行中…' : '最適化を実行'}
                </Button>
                {formError && (
                  <Text size="sm" c="red">
                    {formError}
                  </Text>
                )}
              </Group>
            </Stack>
          </form>

          {submitError && (
            <Text size="sm" c="red">
              最適化の実行に失敗しました: {submitError}
            </Text>
          )}

          <Text size="sm" c="dimmed" my="sm">
            ウェイトは表示用に丸めた値（clean_weights）です。将来の成果や「最適」を保証するものではありません。
          </Text>

          {result && (
            <OptimizationResult
              result={result}
              assetLabel={(id) => assetLabel(id, assets?.assets)}
              added={added}
              onAdd={() => {
                addResult({
                  id: makeResultId(),
                  kind: 'optimization',
                  label: `最適化（${result.params.optimization_method} / ${result.params.expected_return_method}） ${formatExecutedAt()}`,
                  executedAt: new Date().toISOString(),
                  periodStart: form.start || undefined,
                  periodEnd: form.end || undefined,
                  result,
                  // バックテストの再最適化で再現するためのリクエストを保持する。
                  request: buildRequest(form),
                } satisfies StoredResult);
                setAdded(true);
                window.setTimeout(() => setAdded(false), 2000);
              }}
            />
          )}
        </>
      )}
    </>
  );
}
