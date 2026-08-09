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
import { useAssets } from '../hooks/useAssets';
import type { AnalysisSpec, Asset, Frequency } from '../api/types';
import { useAnalysis } from '../hooks/useAnalysis';

/** 頻度の選択肢。 */
const FREQUENCY_OPTIONS: { value: Frequency; label: string }[] = [
  { value: 'D', label: '日次' },
  { value: 'W', label: '週次' },
  { value: 'M', label: '月次' },
];

/** グラフごとの資産別線色（4資産 + 折返し）。 */
const COLORS = ['#2a6e9b', '#c0573f', '#2f8f5b', '#b0882f', '#6b5fa8', '#3f9ab0'];

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
function seriesLine(assetId: string, _series: unknown, color: string) {
  return (
    <Line
      key={assetId}
      type="monotone"
      dataKey={assetId}
      name={assetId}
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
function longestXSeries(seriesList: { asset_id: string; points: { date: string; value: number }[] }[]) {
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
  const dateSet = new Set(xDates);
  return {
    xDates,
    rows: xDates.map((date) => {
      const row: Record<string, string | number | undefined> = { date: formatDate(date) };
      for (const s of seriesList) {
        const point = s.points.find((p) => p.date === date);
        row[s.asset_id] = point?.value;
      }
      void dateSet;
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

function corrColorClass(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return Math.abs(value) < 0.15 ? 'corr-cell-light' : 'corr-cell';
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
    () => (availableAssets.length > 0 ? { asset_ids: availableAssets.map((a) => a.logical_asset), frequency } : null),
    [availableAssets, frequency],
  );

  const { analysis, error: analysisError, loading: analysisLoading, refresh } = useAnalysis(spec);

  return (
    <section>
      <h2>分析</h2>
      <p>取得済み資産の価格推移・累積リターン・ローリングボラティリティ・相関を表示します。</p>

      {assetsLoading && <p>資産一覧を読み込み中…</p>}
      {assetsError && (
        <div className="error-box">
          <p>資産一覧の取得に失敗しました: {assetsError}</p>
          <button type="button" onClick={() => void refresh()}>
            再試行
          </button>
        </div>
      )}

      {spec && (
        <div className="controls">
          <label>
            頻度
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            >
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {analysisError && <p className="error-text">分析データの取得に失敗しました: {analysisError}</p>}
      {analysisLoading && <p>分析データを読み込み中…</p>}

      {analysis && (
        <>
          {(analysis.warnings ?? []).map((w, i) => (
            <p key={i} className="warning-text">
              {w}
            </p>
          ))}

          {analysis.assets_used.length === 0 ? (
            <p className="warning-text">
              取得済みの資産がありません。先にデータ取得 CLI を実行してください。
            </p>
          ) : (
            <>
              <div className="controls">
                <p className="series-meta">
                  対象資産: {analysis.assets_used.map((a) => assetLabel(a, assets?.assets)).join('、')}
                  &nbsp;/ 通貨: {analysis.currency}
                </p>
              </div>

              <h3>価格推移</h3>
              {(() => {
                const { xDates, rows } = seriesMatrix(analysis.prices);
                void xDates;
                return rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis domain={['auto', 'auto']} />
                      <Tooltip />
                      <Legend />
                      {analysis.prices.map((s, i) => seriesLine(s.asset_id, s, COLORS[i % COLORS.length]))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="warning-text">表示できる価格データがありません。</p>
                );
              })()}

              <h3>累積リターン</h3>
              {(() => {
                const { rows } = seriesMatrix(analysis.cumulative);
                return rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis domain={['auto', 'auto']} />
                      <Tooltip />
                      <Legend />
                      {analysis.cumulative.map((s, i) => seriesLine(s.asset_id, s, COLORS[i % COLORS.length]))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="warning-text">表示できる累積リターンがありません。</p>
                );
              })()}

              <h3>ローリングボラティリティ（窓 {analysis.window} 日・年率）</h3>
              {(() => {
                const { rows } = seriesMatrix(analysis.rolling_volatility);
                return rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis domain={['auto', 'auto']} />
                      <Tooltip />
                      <Legend />
                      {analysis.rolling_volatility.map((s, i) =>
                        seriesLine(s.asset_id, s, COLORS[i % COLORS.length]),
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="warning-text">表示できるローリングボラティリティがありません。</p>
                );
              })()}

              <h3>相関（{analysis.assets_used.length}資産）</h3>
              {analysis.correlation.assets.length > 0 ? (
                <table className="corr-table">
                  <thead>
                    <tr className="corr-header-row">
                      <th />
                      {analysis.correlation.assets.map((a) => (
                        <th key={a}>{assetLabel(a, assets?.assets)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.correlation.assets.map((rowAsset, i) => (
                      <tr key={rowAsset}>
                        <th>{assetLabel(rowAsset, assets?.assets)}</th>
                        {analysis.correlation.matrix[i]?.map((v, j) => (
                          <td
                            key={`${rowAsset}-${analysis.correlation.assets[j] ?? j}`}
                            className={`corr-cell ${corrColorClass(v)}`}
                            style={{ backgroundColor: corrColor(v) }}
                            title={v === null ? '欠損' : v.toFixed(3)}
                          >
                            {v === null ? '—' : v.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="warning-text">相関の表示データがありません。</p>
              )}
              <p className="hint-text">
                相関は各資産のリターン系列から計算します。欠損セルは計算に使える共通データがないことを示します。
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}