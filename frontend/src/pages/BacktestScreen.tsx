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

/** リバランス頻度の選択肢。 */
const REBALANCE_OPTIONS: { value: RebalanceFrequency; label: string }[] = [
  { value: 'D', label: '日次' },
  { value: 'W', label: '週次' },
  { value: 'M', label: '月次' },
  { value: 'Y', label: '年次' },
];

/** 資産別の配色（4資産 + 折返し）。 */
const COLORS = ['#2a6e9b', '#c0573f', '#2f8f5b', '#b0882f', '#6b5fa8', '#3f9ab0'];

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
const METRIC_ROWS: { key: keyof BacktestResponse['metrics']; label: string; format: (v: number) => string }[] = [
  { key: 'cumulative_return', label: '累積リターン', format: (v) => `${(v * 100).toFixed(2)}%` },
  { key: 'annual_return', label: '年率リターン', format: (v) => `${(v * 100).toFixed(2)}%` },
  { key: 'annual_volatility', label: '年率ボラティリティ', format: (v) => `${(v * 100).toFixed(2)}%` },
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
      const response = await api.runBacktest(
        buildRequest(form, selectedOptimization?.request),
      );
      setResult(response);
    } catch (err) {
      setSubmitError(friendlyError(err));
    } finally {
      setRunning(false);
    }
  };

  const weightTotal = weightSum(form);

  return (
    <section>
      <h2>バックテスト</h2>
      <p>固定ウェイトでリバランスするバックテストを実行し、累積資産・指標・取引を表示します。</p>

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
                onChange={(e) => {
                  const next = Array.from(e.target.selectedOptions)
                    .filter((o) => o.selected)
                    .map((o) => o.value);
                  const removed = form.selectedAssetIds.filter((a) => !next.includes(a));
                  const added = next.filter((a) => !form.selectedAssetIds.includes(a));
                  const nextWeights = { ...form.weights };
                  for (const a of removed) delete nextWeights[a];
                  for (const a of added) nextWeights[a] = form.weights[a] ?? '0';
                  setForm((prev) => ({ ...prev, selectedAssetIds: next, weights: nextWeights }));
                }}
              >
                {availableAssets.map((a) => (
                  <option key={a.logical_asset} value={a.logical_asset}>
                    {assetLabel(a.logical_asset, assets?.assets)}
                  </option>
                ))}
              </select>
            </label>

            {form.selectedAssetIds.map((assetId) => (
              <label key={assetId}>
                <span>{assetLabel(assetId, assets?.assets)} ウェイト</span>
                <input
                  type="number"
                  step="0.05"
                  min={0}
                  max={1}
                  value={form.weights[assetId] ?? '0'}
                  onChange={(e) => handleWeightChange(assetId, e.target.value)}
                />
              </label>
            ))}

            {form.selectedAssetIds.length > 0 && (
              <label>
                <span>ウェイト合計</span>
                <span className={Math.abs(weightTotal - 1) > 1e-3 ? 'error-text' : 'series-meta'}>
                  {weightTotal.toFixed(3)}
                </span>
              </label>
            )}

            <label>
              <span>リバランス頻度</span>
              <select
                value={form.rebalanceFrequency}
                onChange={(e) => update('rebalanceFrequency', e.target.value as RebalanceFrequency)}
              >
                {REBALANCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>再最適化元の最適化（比較一覧）</span>
              <select
                value={form.rebalanceOptimizationId}
                onChange={(e) =>
                  update('rebalanceOptimizationId', e.target.value)
                }
              >
                <option value="">未選択（固定ウェイト）</option>
                {optimizationOptions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <span className="hint-text">
                最適化画面で「比較に追加」した結果を選ぶと、各リバランス時点まで
                （開始日またはデータ冒頭から）でそのアルゴリズムにより再最適化します。
                未選択なら固定ウェイトで実行します。再最適化に失敗した時点は直前のウェイトを継続します。
              </span>
            </label>

            <label>
              <span>初期資金</span>
              <input
                type="number"
                step="any"
                value={form.initialCapital}
                onChange={(e) => update('initialCapital', e.target.value)}
              />
              <span className="hint-text">正の数値（小数可）</span>
            </label>

            <label>
              <span>コスト率（売買両建て）</span>
              <input
                type="number"
                step="any"
                value={form.costRate}
                onChange={(e) => update('costRate', e.target.value)}
              />
              <span className="hint-text">小数（0.001 = 0.1%）</span>
            </label>

            <label>
              <span>リスクフリー金利</span>
              <input
                type="number"
                step="any"
                value={form.riskFreeRate}
                onChange={(e) => update('riskFreeRate', e.target.value)}
              />
            </label>

            <label>
              <span>開始日（任意）</span>
              <input type="date" value={form.start} onChange={(e) => update('start', e.target.value)} />
            </label>

            <label>
              <span>終了日（任意）</span>
              <input type="date" value={form.end} onChange={(e) => update('end', e.target.value)} />
            </label>

            <div className="opt-actions">
              <button type="submit" disabled={running}>
                {running ? '実行中…' : 'バックテストを実行'}
              </button>
              {formError && <span className="error-text">{formError}</span>}
            </div>
          </form>

          <p className="hint-text">
            約定はシグナル日（月次/週次なら各期間の最終観測日）の翌観測日に行われます。日次リバランス＋正のコストでは回転率・手数料が大きくなります。
          </p>

          {submitError && <p className="error-text">バックテストの実行に失敗しました: {submitError}</p>}

          {result && (
            <>
              <h3>バックテスト結果</h3>
              <div className="compare-actions">
                <button
                  type="button"
                  onClick={() => {
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
                  比較に追加
                </button>
                {added && <span className="hint-text">追加しました</span>}
              </div>
              {(result.warnings ?? []).map((w, i) => (
                <p key={i} className="warning-text">
                  {w}
                </p>
              ))}

              <h4>評価指標（年率）</h4>
              <table className="result-table">
                <tbody>
                  {METRIC_ROWS.map((row) => {
                    const v = result.metrics[row.key];
                    return (
                      <tr key={row.key}>
                        <td>{row.label}</td>
                        <td>{v === null || v === undefined ? '—' : row.format(v)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>手数料合計</td>
                    <td>{result.metrics.total_fees.toFixed(2)} {result.currency}</td>
                  </tr>
                </tbody>
              </table>

              <h4>累積資産</h4>
              {result.equity_curve.length > 0 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart
                    data={result.equity_curve.map((p) => ({ date: p.date, value: p.value }))}
                    margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
                    <YAxis domain={['auto', 'auto']} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="value" name="評価額" stroke="#2a6e9b" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="warning-text">表示できる累積資産がありません。</p>
              )}

              <h4>ドローダウン</h4>
              {result.drawdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={result.drawdown.map((p) => ({ date: p.date, value: p.value * 100 }))}
                    margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
                    <YAxis domain={['auto', 0]} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="value" name="ドローダウン(%)" stroke="#c0573f" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="warning-text">表示できるドローダウンがありません。</p>
              )}

              <h4>年次成績</h4>
              {result.yearly.length > 0 ? (
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>年</th>
                      <th>期間リターン</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.yearly.map((y) => (
                      <tr key={y.year}>
                        <td>{y.year}</td>
                        <td>{(y.period_return * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="warning-text">表示できる年次成績がありません。</p>
              )}

              <h4>配分推移（実測ウェイト）</h4>
              {result.allocation.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart
                    data={result.allocation.map((a) => ({
                      date: a.date,
                      ...a.weights,
                    }))}
                    margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(0, 7)} />
                    <YAxis domain={[0, 1]} />
                    <Tooltip />
                    <Legend />
                    {result.asset_ids.map((a, i) => (
                      <Line
                        key={a}
                        type="monotone"
                        dataKey={a}
                        name={assetLabel(a, assets?.assets)}
                        stroke={COLORS[i % COLORS.length]}
                        dot={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="warning-text">表示できる配分推移がありません。</p>
              )}

              {result.rebalance_weights && result.rebalance_weights.length > 0 && (
                <>
                  <h4>リバランス時の採用ウェイト（再最適化）</h4>
                  <table className="result-table">
                    <thead>
                      <tr>
                        <th>日付</th>
                        {result.asset_ids.map((a) => (
                          <th key={a}>{assetLabel(a, assets?.assets)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rebalance_weights.map((p) => (
                        <tr key={p.date}>
                          <td>{p.date}</td>
                          {result.asset_ids.map((a) => (
                            <td key={a}>{(p.weights[a] ?? 0).toFixed(4)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <h4>取引一覧（直近 200 件）</h4>
              {result.trades.length > 0 ? (
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>日付</th>
                      <th>資産</th>
                      <th>売買</th>
                      <th>数量</th>
                      <th>価格</th>
                      <th>約定額</th>
                      <th>手数料</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.slice(-200).map((t, i) => (
                      <tr key={i}>
                        <td>{t.date}</td>
                        <td>{assetLabel(t.asset_id, assets?.assets)}</td>
                        <td>{t.side}</td>
                        <td>{t.quantity.toFixed(4)}</td>
                        <td>{t.price.toFixed(2)}</td>
                        <td>{t.value.toFixed(2)}</td>
                        <td>{t.fee.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="warning-text">表示できる取引がありません。</p>
              )}

              <h4>パラメータ</h4>
              <p className="series-meta">
                対象: {result.asset_ids.map((a) => assetLabel(a, assets?.assets)).join('、')} /
                リバランス頻度: {result.params.rebalance_frequency} / 初期資金:{' '}
                {result.params.initial_capital.toLocaleString()} {result.currency} / コスト率:{' '}
                {result.params.cost_rate} / リスクフリー金利: {result.params.risk_free_rate}
              </p>

              <p className="hint-text">
                バックテストは過去データによる仮想シミュレーションです。将来の成果や「最適」を保証する
                ものではなく、売買コスト・税金・流動性・価格インパクト・為替を完全には再現しません。
                過学習や期間依存性に注意してください。
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}