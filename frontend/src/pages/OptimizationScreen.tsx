import { useMemo, useState } from 'react';
import { api } from '../api';
import { useCompare } from '../compare/CompareContext';
import { makeResultId, type StoredResult } from '../compare/types';
import { useAssets } from '../hooks/useAssets';
import type {
  Asset,
  CovarianceMethod,
  ExpectedReturnMethod,
  OptimizationMethod,
  OptimizationRequest,
  OptimizationResponse,
} from '../api/types';

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

/** 期待リターン方式の日本語ラベル。 */
const EXPECTED_RETURN_LABELS: Record<ExpectedReturnMethod, string> = {
  mean_historical_return: '平均リターン',
  capm_return: 'CAPM リターン',
  ema_historical_return: 'EMA リターン',
};

/** 最適化手法の日本語ラベル。 */
const METHOD_LABELS: Record<OptimizationMethod, string> = {
  max_sharpe: '最大シャープレシオ',
  min_volatility: '最小ボラティリティ',
  efficient_risk: '目標ボラティリティ（efficient_risk）',
  efficient_return: '目標リターン（efficient_return）',
};

/**
 * フォームの入力状態。数値系はキャレット位置・空欄入力を許容するため文字列で保持し、
 * 送信時（`_buildRequest`）に `Number()` へ変換する。
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
    <section>
      <h2>最適化</h2>
      <p>PyPortfolioOpt の手法・期間・制約を入力し、ウェイトとリスク指標を表示します。</p>

      {assetsLoading && <p>資産一覧を読み込み中…</p>}
      {assetsError && (
        <div className="error-box">
          <p>資産一覧の取得に失敗しました: {assetsError}</p>
          <button type="button" onClick={() => void refresh()}>
            再試行
          </button>
        </div>
      )}

      {!assetsLoading && !assetsError && availableAssets.length === 0 && (
        <p className="warning-text">
          取得済みの資産がありません。先にデータ取得 CLI を実行してください。
        </p>
      )}

      {availableAssets.length > 0 && (
        <>
          <form className="opt-form" onSubmit={handleSubmit}>
            <label>
              <span>対象資産（Ctrl+クリックで複数選択）</span>
              <select
                multiple
                size={4}
                value={form.selectedAssetIds}
                onChange={(e) =>
                  update(
                    'selectedAssetIds',
                    Array.from(e.target.selectedOptions).filter((o) => o.selected).map((o) => o.value),
                  )
                }
              >
                {availableAssets.map((a) => (
                  <option key={a.logical_asset} value={a.logical_asset}>
                    {assetLabel(a.logical_asset, assets?.assets)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>手法</span>
              <select
                value={form.method}
                onChange={(e) => update('method', e.target.value as OptimizationMethod)}
              >
                {METHOD_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>期待リターン</span>
              <select
                value={form.expectedReturnMethod}
                onChange={(e) =>
                  update('expectedReturnMethod', e.target.value as ExpectedReturnMethod)
                }
              >
                {EXPECTED_RETURN_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>共分散</span>
              <select
                value={form.covarianceMethod}
                onChange={(e) => update('covarianceMethod', e.target.value as CovarianceMethod)}
              >
                {COVARIANCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>開始日（任意）</span>
              <input
                type="date"
                value={form.start}
                onChange={(e) => update('start', e.target.value)}
              />
            </label>

            <label>
              <span>終了日（任意）</span>
              <input type="date" value={form.end} onChange={(e) => update('end', e.target.value)} />
            </label>

            <label>
              <span>リスクフリー金利</span>
              <input
                type="number"
                step="0.001"
                value={form.riskFreeRate}
                onChange={(e) => update('riskFreeRate', e.target.value)}
              />
              <span className="hint-text">年率・小数（例 0.02 = 2%）</span>
            </label>

            {form.method === 'efficient_return' && (
              <>
                <label>
                  <span>目標リターン（年率）</span>
                  <input
                    type="number"
                    step="0.001"
                    value={form.targetReturn}
                    onChange={(e) => update('targetReturn', e.target.value)}
                  />
                </label>
                <span className="hint-text">
                  目標リターンは、最適化に使う「{EXPECTED_RETURN_LABELS[form.expectedReturnMethod]}」で
                  期待リターンが最も高い資産の値（効率フロンティアの上限）を超えるとエラーになります。
                  限界値ちょうどでは最高リターン資産に集中し、わずかに下回ると複数資産に分散されます。
                </span>
              </>
            )}

            {form.method === 'efficient_risk' && (
              <label>
                <span>目標ボラティリティ（年率）</span>
                <input
                  type="number"
                  step="0.001"
                  value={form.targetVolatility}
                  onChange={(e) => update('targetVolatility', e.target.value)}
                />
              </label>
            )}

            <label>
              <span>ウェイト下限</span>
              <input
                type="number"
                step="0.05"
                value={form.weightLower}
                onChange={(e) => update('weightLower', e.target.value)}
              />
            </label>

            <label>
              <span>ウェイト上限</span>
              <input
                type="number"
                step="0.05"
                value={form.weightUpper}
                onChange={(e) => update('weightUpper', e.target.value)}
              />
            </label>

            <label>
              <span>年率換算係数</span>
              <input
                type="number"
                step="1"
                value={form.annualizationFactor}
                onChange={(e) => update('annualizationFactor', e.target.value)}
              />
            </label>

            <div className="opt-actions">
              <button type="submit" disabled={running}>
                {running ? '実行中…' : '最適化を実行'}
              </button>
              {formError && <span className="error-text">{formError}</span>}
            </div>
          </form>

          {submitError && <p className="error-text">最適化の実行に失敗しました: {submitError}</p>}

          <p className="hint-text">
            ウェイトは表示用に丸めた値（clean_weights）です。将来の成果や「最適」を保証するものではありません。
          </p>

          {result && (
            <>
              <h3>最適配分の結果</h3>
              <div className="compare-actions">
                <button
                  type="button"
                  onClick={() => {
                    addResult({
                      id: makeResultId(),
                      kind: 'optimization',
                      label: `最適化（${result.params.optimization_method} / ${result.params.expected_return_method}） ${formatExecutedAt()}`,
                      executedAt: new Date().toISOString(),
                      periodStart: form.start || undefined,
                      periodEnd: form.end || undefined,
                      result,
                    } satisfies StoredResult);
                    setAdded(true);
                    window.setTimeout(() => setAdded(false), 2000);
                  }}
                >
                  比較に追加
                </button>
                {added && <span className="hint-text">追加しました</span>}
              </div>
              {(result.warnings ?? []).map((w, i) => (
                <p key={i} className="warning-text">
                  {w}
                </p>
              ))}

              <h4>資産別ウェイト</h4>
              {Object.entries(result.clean_weights).length > 0 ? (
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>資産</th>
                      <th>ウェイト</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(result.clean_weights)
                      .sort(([, a], [, b]) => b - a)
                      .map(([assetId, value]) => (
                        <tr key={assetId}>
                          <td>{assetLabel(assetId, assets?.assets)}</td>
                          <td>{value.toFixed(4)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="warning-text">表示できるウェイトがありません。</p>
              )}

              <h4>指標（年率）</h4>
              <table className="result-table">
                <tbody>
                  <tr>
                    <td>期待リターン（{EXPECTED_RETURN_LABELS[result.params.expected_return_method]}）</td>
                    <td>{result.metrics.expected_annual_return.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td>手法</td>
                    <td>{METHOD_LABELS[result.params.optimization_method]}</td>
                  </tr>
                  <tr>
                    <td>ボラティリティ</td>
                    <td>{result.metrics.annual_volatility.toFixed(4)}</td>
                  </tr>
                  <tr>
                    <td>シャープレシオ</td>
                    <td>{result.metrics.sharpe_ratio.toFixed(4)}</td>
                  </tr>
                </tbody>
              </table>

              <h4>パラメータ</h4>
              <p className="series-meta">
                手法: {result.params.optimization_method} / 期待リターン:{' '}
                {result.params.expected_return_method} / 共分散: {result.params.covariance_method} /
                {' '}
                リスクフリー金利: {result.params.risk_free_rate} / 年率換算係数:{' '}
                {result.params.annualization_factor} / ウェイト上下限:{' '}
                {result.params.weight_bounds[0]}〜{result.params.weight_bounds[1]}
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}