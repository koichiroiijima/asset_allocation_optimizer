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
import type { Asset } from '../api';
import { useAssets } from '../hooks/useAssets';
import { useSeries } from '../hooks/useSeries';
import type { Frequency, SeriesSpec, SeriesType } from '../api/types';

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

function renderAssetTable(assets: Asset[]) {
  return (
    <table>
      <thead>
        <tr>
          <th>資産</th>
          <th>ティッカー</th>
          <th>資産クラス</th>
          <th>出所</th>
          <th>期間</th>
          <th>欠損</th>
          <th>取得日時</th>
          <th>状態</th>
        </tr>
      </thead>
      <tbody>
        {assets.map((a) => {
          const ds = a.data_status;
          const available = ds?.available ?? false;
          return (
            <tr key={a.logical_asset}>
              <td>{a.display_name}</td>
              <td>{a.default_ticker}</td>
              <td>{ASSET_CLASS_LABEL[a.asset_class] ?? a.asset_class}</td>
              <td>{ds?.source ?? '—'}</td>
              <td>
                {available && ds?.start
                  ? `${formatDate(ds.start)} ～ ${formatDate(ds.end ?? '')}`
                  : '—'}
              </td>
              <td>{available ? `${ds?.missing ?? 0} 行` : '—'}</td>
              <td>{available ? formatRetrieved(a) : '—'}</td>
              <td>
                {available ? (
                  <span className="status-ok">取得済み</span>
                ) : (
                  <span className="status-warn">未取得</span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
    <section>
      <h2>データ</h2>
      <p>4資産の候補・データソース・期間・欠損・取得日時・価格種別を確認します。</p>

      {assetsLoading && <p>読み込み中…</p>}
      {assetsError && (
        <div className="error-box">
          <p>資産一覧の取得に失敗しました: {assetsError}</p>
          <button type="button" onClick={() => void refresh()}>
            再試行
          </button>
        </div>
      )}

      {assets && (
        <>
          {renderAssetTable(assets.assets)}

          <h3>系列グラフ</h3>
          <div className="controls">
            <label>
              資産
              <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                <option value="">選択してください</option>
                {assets.assets.map((a) => (
                  <option key={a.logical_asset} value={a.logical_asset}>
                    {a.display_name}（{a.default_ticker}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              系列種別
              <select
                value={seriesType}
                onChange={(e) => setSeriesType(e.target.value as SeriesType)}
              >
                {SERIES_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              頻度
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                {FREQUENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedAsset && (
            <>
              <p className="series-meta">
                {selectedAsset.display_name} / {seriesType} / {frequency}
              </p>
              {seriesLoading && <p>系列を読み込み中…</p>}
              {seriesError && <p className="error-text">系列の取得に失敗しました: {seriesError}</p>}
              {series && (
                <>
                  {(series.warnings ?? []).map((w, i) => (
                    <p key={i} className="warning-text">
                      {w}
                    </p>
                  ))}
                  {series.points.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart
                        data={series.points.map((p) => ({
                          date: formatDate(p.date),
                          value: p.value,
                        }))}
                        margin={{ top: 8, right: 16, bottom: 8, left: 8 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" />
                        <YAxis domain={['auto', 'auto']} />
                        <Tooltip />
                        <Line type="monotone" dataKey="value" name="値" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="warning-text">表示できる系列データがありません。</p>
                  )}
                  <p className="hint-text">通貨: {series.currency}</p>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
