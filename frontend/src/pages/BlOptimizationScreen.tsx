import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useCompare } from '../compare/CompareContext';
import { makeResultId, type StoredResult } from '../compare/types';
import { useAnalysis } from '../hooks/useAnalysis';
import { useAssets } from '../hooks/useAssets';
import {
  BL_DEFAULT_MARKET_WEIGHTS,
  type AnalysisSpec,
  type Asset,
  type BlOmegaMethod,
  type CovarianceMethod,
  type OptimizationMethod,
  type OptimizationRequest,
  type OptimizationResponse,
} from '../api/types';

/** 最適化手法の選択肢。 */
const METHOD_OPTIONS: { value: OptimizationMethod; label: string }[] = [
  { value: 'max_sharpe', label: '最大シャープレシオ' },
  { value: 'min_volatility', label: '最小ボラティリティ' },
  { value: 'efficient_risk', label: '目標ボラティリティ（efficient_risk）' },
  { value: 'efficient_return', label: '目標リターン（efficient_return）' },
];

/** 共分散推定の選択肢。 */
const COVARIANCE_OPTIONS: { value: CovarianceMethod; label: string }[] = [
  { value: 'sample_cov', label: '標本共分散' },
  { value: 'semicovariance', label: 'セミコバリアンス' },
  { value: 'ledoit_wolf', label: 'Ledoit-Wolf 収縮' },
];

/** 期待リターン方式の日本語ラベル（本画面は Black-Litterman 固定）。 */
const EXPECTED_RETURN_LABELS: Record<'black_litterman', string> = {
  black_litterman: 'Black-Litterman',
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
  /** 本画面（Black-Litterman 専用）では固定。buildRequest でもこの値を送る。 */
  expectedReturnMethod: 'black_litterman';
  covarianceMethod: CovarianceMethod;
  start: string;
  end: string;
  riskFreeRate: string;
  targetReturn: string;
  targetVolatility: string;
  weightLower: string;
  weightUpper: string;
  annualizationFactor: string;
  // Black-Litterman 用（expectedReturnMethod='black_litterman' のときのみ使用）
  blMarketWeights: Record<string, string>;
  blViews: Record<string, string>;
  blViewConfidences: Record<string, string>;
  blOmegaMethod: BlOmegaMethod;
  blTau: string;
  blRiskAversion: string;
}

/**
 * 選択資産のデフォルト市場ポートフォリオウェイト（% 表記）を初期化する。
 * 既定の4資産ウェイトを持つ資産のみを対象に、比率を保ったまま合計100%へ正規化する
 * （既定値を持たない資産には 0% を設定。ユーザーが明示的に埋める）。
 */
function defaultMarketWeightPct(assetIds: string[]): Record<string, string> {
  const known = assetIds.filter((a) => BL_DEFAULT_MARKET_WEIGHTS[a] != null);
  const knownTotal = known.reduce(
    (acc, a) => acc + (BL_DEFAULT_MARKET_WEIGHTS[a] ?? 0),
    0,
  );
  const out: Record<string, string> = {};
  if (knownTotal > 0) {
    const scaler = 100 / knownTotal;
    for (const a of known) {
      out[a] = ((BL_DEFAULT_MARKET_WEIGHTS[a] ?? 0) * scaler).toFixed(2);
    }
  }
  for (const a of assetIds) {
    if (out[a] == null) out[a] = '0';
  }
  return out;
}

export const INITIAL_FORM: FormState = {
  selectedAssetIds: [],
  method: 'max_sharpe',
  expectedReturnMethod: 'black_litterman',
  covarianceMethod: 'sample_cov',
  start: '',
  end: '',
  riskFreeRate: '0',
  targetReturn: '',
  targetVolatility: '',
  weightLower: '0',
  weightUpper: '1',
  annualizationFactor: '252',
  blMarketWeights: {},
  blViews: {},
  blViewConfidences: {},
  blOmegaMethod: 'default',
  blTau: '0.05',
  blRiskAversion: '',
};

/** BL のフォーム入力を `Record<資産ID, number>` へ変換する（空欄・無効値を除外）。 */
function blRecordFromForm(rec: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(rec)
      .map(([k, v]) => [k, Number(v)])
      .filter(([, v]) => !Number.isNaN(v) && v !== 0),
  );
}

/** 0 も含めて数値化する（bootstrap: 空欄・NaN のみ除外）。市場ウェイトの重量用。 */
function blRecordKeepZero(rec: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(rec)
      .map(([k, v]) => [k, Number(v)])
      .filter(([, v]) => !Number.isNaN(v)),
  );
}

/** % 表記（合計100）を比率（合計1）へ変換する。ビュー用（0は無効値として除外）。 */
function blPctToRatio(rec: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(blRecordFromForm(rec)).map(([k, v]) => [k, v / 100]),
  );
}

/** 市場ポートフォリオのウェイト（% 合計100 → 比率合計1、0% は維持）。 */
function blMarketToRatio(rec: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(blRecordKeepZero(rec)).map(([k, v]) => [k, v / 100]),
  );
}

/**
 * 確信度（0-1）をそのまま比率として送る（% ではない）。
 * 空欄・NaN のみ除外し、0 は「かなり弱いビュー」として有効な値として送る。
 */
function blConfidenceOut(rec: Record<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) {
    const trimmed = v.trim();
    if (trimmed === '') continue; // 空欄は送らない
    const n = Number(trimmed);
    if (Number.isNaN(n)) continue;
    out[k] = n;
  }
  return out;
}

/** フォーム入力を `OptimizationRequest` へ変換する。date input は既に YYYY-MM-DD 形式。 */
function buildRequest(f: FormState): OptimizationRequest {
  const isBL = f.expectedReturnMethod === 'black_litterman';
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
    // Black-Litterman 用フィールド（選択時のみ送る）
    // 市場ウェイトが空（未入力）ならフィールド自体を省略し、サービスの既定値
    // （DEFAULT_MARKET_WEIGHTS）を使わせる。
    ...(isBL && Object.keys(f.blMarketWeights).length > 0
      ? { bl_market_weights: blMarketToRatio(f.blMarketWeights) }
      : {}),
    ...(isBL && Object.keys(blPctToRatio(f.blViews)).length > 0
      ? { bl_views: blPctToRatio(f.blViews) }
      : {}),
    ...(isBL ? { bl_omega_method: f.blOmegaMethod, bl_tau: Number(f.blTau || '0.05') } : {}),
    ...(isBL && f.blRiskAversion.trim() !== ''
      ? { bl_risk_aversion: Number(f.blRiskAversion) }
      : {}),
    ...(isBL && f.blOmegaMethod === 'idzorek' && Object.keys(blConfidenceOut(f.blViewConfidences)).length > 0
      ? { bl_view_confidences: blConfidenceOut(f.blViewConfidences) }
      : {}),
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

  // Black-Litterman の軽い検証（サーバー 422 に依存しない）
  if (f.expectedReturnMethod === 'black_litterman') {
    const tau = Number(f.blTau);
    if (Number.isNaN(tau) || tau <= 0 || tau > 1) {
      return 'BL の τ（ビュー信頼係数）は 0 より大きく 1 以下で入力してください';
    }
    if (f.blRiskAversion.trim() !== '' && Number(f.blRiskAversion) <= 0) {
      return 'BL のリスク回避度は正の値で入力してください（未入力なら自動算出）';
    }
    // 市場ポートフォリオの合計が 100%（±許容誤差）
    const mkt = blRecordFromForm(f.blMarketWeights);
    const total = Object.values(mkt).reduce((a, b) => a + b, 0);
    if (f.selectedAssetIds.length > 0 && Math.abs(total - 100) > 0.5) {
      return `市場ポートフォリオのウェイトの合計を 100% にしてください（現在: ${total.toFixed(1)}%）`;
    }
    if (f.blOmegaMethod === 'idzorek') {
      // ビューのある資産全てに確信度の入力が必要（0 は弱いビューとして許容、空欄は不可）
      const viewAssets = Object.keys(f.blViews).filter((a) => f.blViews[a].trim() !== '');
      const missingConf = viewAssets.filter(
        (a) => !(f.blViewConfidences[a] && f.blViewConfidences[a].trim() !== ''),
      );
      if (missingConf.length > 0) {
        return `BL の ω=idzorek では、ビューのある資産すべてに確信度（0〜1）の入力が必要です（未入力: ${missingConf.join('、')}）`;
      }
      const invalidConf = viewAssets.filter((a) => {
        const c = Number(f.blViewConfidences[a]);
        return Number.isNaN(c) || c < 0 || c > 1;
      });
      if (invalidConf.length > 0) {
        return 'BL の確信度は 0〜1 の範囲で入力してください';
      }
    }
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
export function BlOptimizationScreen() {
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

  // ビュー入力の参考情報として、選択資産の EMA 年率リターンを取得する。
  // 資産未選択の間は spec を null にして取得しない。
  const analysisSpec = useMemo<AnalysisSpec | null>(
    () =>
      form.selectedAssetIds.length > 0
        ? { asset_ids: form.selectedAssetIds, frequency: 'D' }
        : null,
    [form.selectedAssetIds],
  );
  const { analysis } = useAnalysis(analysisSpec);

  // 資産ID → EMA 年率リターン（比率。null は計算不能）の参照用マップ。
  const emaReturnMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const s of analysis?.stats ?? []) {
      map[s.asset_id] = s.ema_annual_return;
    }
    return map;
  }, [analysis]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  /**
 * 対象資産の選択を更新し、BL の市場ポートフォリオ・ビュー・確信度を
 * 選択資産に合わせて初期化する。市場ポートフォリオは既定値で埋める。
 */
  const handleAssetsChange = (next: string[]) => {
    setForm((prev) => {
      const changed =
        next.length !== prev.selectedAssetIds.length ||
        next.some((a, i) => a !== prev.selectedAssetIds[i]);
      if (!changed) {
        return { ...prev, selectedAssetIds: next };
      }
      return {
        ...prev,
        selectedAssetIds: next,
        blMarketWeights: defaultMarketWeightPct(next),
        blViews: Object.fromEntries(next.map((a) => [a, prev.blViews[a] ?? ''])),
        blViewConfidences: Object.fromEntries(
          next.map((a) => [a, prev.blViewConfidences[a] ?? '']),
        ),
      };
    });
  };

  // 資産一覧の読み込み後、選択資産が変化した時に市場ポートフォリオ既定値をフォームへ反映する。
  // （useEffect は handleAssetsChange と `selectedAssetIds` の依存を一方向にしないよう、
  //   変更検知は handleAssetsChange 側で行い、ここでは初期化時の既定値供給のみを担う）。
  useEffect(() => {
    if (
      form.expectedReturnMethod === 'black_litterman' &&
      form.selectedAssetIds.length > 0 &&
      Object.keys(form.blMarketWeights).length === 0
    ) {
      setForm((prev) => ({ ...prev, blMarketWeights: defaultMarketWeightPct(prev.selectedAssetIds) }));
    }
  }, [form.expectedReturnMethod, form.selectedAssetIds, form.blMarketWeights]);

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
      <h2>最適化（BL）</h2>
      <p>
        Black-Litterman モデルで市場均衡と投資家のビューを合成し、ウェイトとリスク指標を表示します。
        期待リターンは Black-Litterman に固定です。
      </p>

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
                  handleAssetsChange(
                    Array.from(e.target.selectedOptions)
                      .filter((o) => o.selected)
                      .map((o) => o.value),
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

            <p className="hint-text">
              期待リターンは Black-Litterman に固定です（市場均衡と投資家のビューを合成）。
            </p>

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

            {form.expectedReturnMethod === 'black_litterman' && (
              <>
                <label>
                  <span>市場ポートフォリオのウェイト（%・合計100）</span>
                  {form.selectedAssetIds
                    .sort()
                    .map((a) => (
                      <span key={a} className="bl-field">
                        <span className="hint-text">{assetLabel(a, assets?.assets)}</span>
                        <input
                          type="number"
                          step="0.1"
                          value={form.blMarketWeights[a] ?? ''}
                          onChange={(e) =>
                            update('blMarketWeights', {
                              ...form.blMarketWeights,
                              [a]: e.target.value,
                            })
                          }
                        />
                      </span>
                    ))}
                  <span className="hint-text">
                    投資家が想定する市場ポートフォリオ（時価総額加重）の構成比率。未指定なら既定値
                    （VTI 22.9% / AGG 21.4% / VXUS 23.7% / IAGG 32.0%）を選択資産に合わせて正規化します。
                  </span>
                </label>

                <label>
                  <span>ビュー（年率期待リターン %、r_f 込み）</span>
                  {form.selectedAssetIds
                    .sort()
                    .map((a) => (
                      <span key={a} className="bl-field">
                        <span className="hint-text">
                          {assetLabel(a, assets?.assets)}
                          {' '}
                          {emaReturnMap[a] != null
                            ? `（EMA: ${(emaReturnMap[a]! * 100).toFixed(1)}%・参考）`
                            : '（EMA: —）'}
                        </span>
                        <input
                          type="number"
                          step="0.1"
                          value={form.blViews[a] ?? ''}
                          placeholder="（空=ビューなし）"
                          onChange={(e) =>
                            update('blViews', { ...form.blViews, [a]: e.target.value })
                          }
                        />
                      </span>
                    ))}
                  <span className="hint-text">
                    この資産の年率期待リターン（リスクフリー金利 r_f を含む水準）。例: r_f=1% で 5% の
                    リターンを見込むなら「5」と入力。空欄はビューなし。EMA は全期間の指数加重平均
                    リターン（年率）で、ビュー入力の参考値。
                  </span>
                </label>

                <label>
                  <span>ω（ビュー不確実性）の決定方法</span>
                  <select
                    value={form.blOmegaMethod}
                    onChange={(e) => update('blOmegaMethod', e.target.value as BlOmegaMethod)}
                  >
                    <option value="default">分散に比例（default）</option>
                    <option value="idzorek">Idzorek（確信度から算出）</option>
                  </select>
                </label>

                {form.blOmegaMethod === 'idzorek' && (
                  <label>
                    <span>ビューの確信度（0〜1・ビューのある資産に入力必須）</span>
                    {form.selectedAssetIds
                      .filter((a) => form.blViews[a] && form.blViews[a].trim() !== '')
                      .map((a) => (
                        <span key={a} className="bl-field">
                          <span className="hint-text">{assetLabel(a, assets?.assets)}</span>
                          <input
                            type="number"
                            step="0.05"
                            min={0}
                            max={1}
                            placeholder="必須"
                            value={form.blViewConfidences[a] ?? ''}
                            onChange={(e) =>
                              update('blViewConfidences', {
                                ...form.blViewConfidences,
                                [a]: e.target.value,
                              })
                            }
                          />
                          <span className="hint-text">0=ほぼ不確実 / 1=確実</span>
                        </span>
                      ))}
                    <span className="hint-text">
                      ω=idzorek では、ビューのある資産すべてに 0〜1 の確信度を入力してください
                      （未入力のままだと実行できません）。
                    </span>
                  </label>
                )}

                <label>
                  <span>τ（ビュー信頼係数）</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0.01}
                    max={1}
                    value={form.blTau}
                    onChange={(e) => update('blTau', e.target.value)}
                  />
                  <span className="hint-text">既定 0.05。ω=default では結果に影響しません。</span>
                </label>

                <label>
                  <span>リスク回避度（任意）</span>
                  <input
                    type="number"
                    step="0.1"
                    value={form.blRiskAversion}
                    placeholder="空欄=市場から自動算出"
                    onChange={(e) => update('blRiskAversion', e.target.value)}
                  />
                  <span className="hint-text">
                    明示しない場合、市場ポートフォリオの超過リターンと分散から逆算します。
                  </span>
                </label>
              </>
            )}

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
                      // バックテストの再最適化で再現するためのリクエストを保持する。
                      request: buildRequest(form),
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

              <h4>個別資産のリターン・リスク（年率）</h4>
              {Object.keys(result.metrics.asset_returns ?? {}).length > 0 ? (
                <table className="result-table">
                  <thead>
                    <tr>
                      <th>資産</th>
                      <th>年率リターン（期待）</th>
                      <th>年率ボラティリティ（リスク）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(result.metrics.asset_returns)
                      .sort()
                      .map((assetId) => (
                        <tr key={assetId}>
                          <td>{assetLabel(assetId, assets?.assets)}</td>
                          <td>{(result.metrics.asset_returns[assetId] * 100).toFixed(2)}%</td>
                          <td>
                            {(result.metrics.asset_volatilities[assetId] * 100).toFixed(2)}%
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="warning-text">表示できる個別資産の統計がありません。</p>
              )}

              <h4>指標（年率）</h4>
              <table className="result-table">
                <tbody>
                  <tr>
                    <td>期待リターン（{EXPECTED_RETURN_LABELS['black_litterman']}）</td>
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