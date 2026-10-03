import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { CompareProvider } from '../compare/CompareContext';
import { AssetSetProvider } from '../state/AssetSetContext';
import { BlOptimizationScreen } from './BlOptimizationScreen';

/** CompareProvider で包んで描画する。実行結果の「比較に追加」用。 */
function renderWithProvider(ui: React.ReactNode) {
  return render(<CompareProvider>{ui}</CompareProvider>);
}

const ASSETS_BODY = {
  assets: [
    {
      logical_asset: 'us_equity',
      display_name: '米国株式',
      default_ticker: 'VTI',
      underlying: null,
      asset_class: 'equity',
      currency: 'USD',
      fx_hedged: false,
      dividend_policy: 'reinvest',
      history_start: null,
      note: '',
      data_status: {
        logical_asset: 'us_equity',
        available: true,
        start: '2024-01-02',
        end: '2024-01-05',
        rows: 4,
        missing: 1,
        source: 'yahoo',
        price_type: 'adjusted_close',
        retrieved_at: '2024-01-06T00:00:00Z',
        snapshot_hash: 'abc',
      },
    },
    {
      logical_asset: 'us_bond',
      display_name: '米国債券',
      default_ticker: 'BND',
      underlying: null,
      asset_class: 'bond',
      currency: 'USD',
      fx_hedged: false,
      dividend_policy: 'reinvest',
      history_start: null,
      note: '',
      data_status: {
        logical_asset: 'us_bond',
        available: true,
        start: '2024-01-02',
        end: '2024-01-05',
        rows: 4,
        missing: 0,
        source: 'yahoo',
        price_type: 'adjusted_close',
        retrieved_at: '2024-01-06T00:00:00Z',
        snapshot_hash: 'def',
      },
    },
    {
      logical_asset: 'ex_us_equity',
      display_name: '米国を除く株式',
      default_ticker: 'VXUS',
      underlying: null,
      asset_class: 'equity',
      currency: 'USD',
      fx_hedged: false,
      dividend_policy: 'reinvest',
      history_start: null,
      note: '',
      data_status: null,
    },
  ],
};

const BL_OPTIMIZATION_BODY = {
  method: 'max_sharpe',
  weights: { us_equity: 0.3, us_bond: 0.7 },
  clean_weights: { us_equity: 0.3, us_bond: 0.7 },
  metrics: {
    expected_annual_return: 0.06,
    annual_volatility: 0.04,
    sharpe_ratio: 1.4,
    asset_returns: { us_equity: 0.1, us_bond: 0.04 },
    asset_volatilities: { us_equity: 0.19, us_bond: 0.05 },
  },
  base_currency: 'USD',
  params: {
    optimization_method: 'max_sharpe',
    expected_return_method: 'black_litterman',
    covariance_method: 'sample_cov',
    risk_free_rate: 0,
    annualization_factor: 252,
    weight_bounds: [0, 1],
    bl_market_weights: { us_equity: 0.5, us_bond: 0.5 },
    bl_omega_method: 'default',
    bl_tau: 0.05,
  },
  warnings: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** /optimizations の応答を制御する。形状は `{ body, status }`。 */
interface OptimizationStub {
  body: unknown;
  status: number;
}

/** /optimizations を POST body にして返す fetch スタブ。URL に応じて /assets / /health を分岐。 */
function stubFetch(optimizationStub?: OptimizationStub | null) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    void _init; // 送信 body は fetchMock.mock.calls から検証テストが直接読む
    const url = String(input);
    if (url.includes('/assets')) {
      return Promise.resolve(jsonResponse(ASSETS_BODY));
    }
    if (url.includes('/optimizations')) {
      if (optimizationStub == null) {
        return Promise.resolve(jsonResponse(BL_OPTIMIZATION_BODY));
      }
      return Promise.resolve(jsonResponse(optimizationStub.body, optimizationStub.status));
    }
    if (url.includes('/health')) {
      return Promise.resolve(
        jsonResponse({ status: 'ok', app: 'a', version: '1', app_env: 'test' }),
      );
    }
    return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('BlOptimizationScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 取得済み 2 資産を選択する。BL 画面は資産選択で直ちに BL 入力が表示される。 */
  async function selectAssets(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('listbox', { name: /対象資産/ });
    const assetSelect = screen.getByRole('listbox', { name: /対象資産/ });
    await user.selectOptions(assetSelect, ['us_equity', 'us_bond']);
  }

  it('BL 選択で市場ポートフォリオ・ビュー・τ の入力が現れる', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BlOptimizationScreen />);
    await selectAssets(user);

    expect(screen.getByText(/市場ポートフォリオのウェイト/)).toBeInTheDocument();
    expect(screen.getByText(/ビュー（年率期待リターン/)).toBeInTheDocument();
    expect(screen.getByText(/τ（ビュー信頼係数）/)).toBeInTheDocument();
    expect(screen.getByText(/リスク回避度/)).toBeInTheDocument();
    // 期待リターンは固定のため combobox は表示されない
    expect(screen.queryByRole('combobox', { name: /期待リターン/ })).not.toBeInTheDocument();
  });

  it('選択資産にデフォルトの市場ウェイト（合計100%）が表示される', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BlOptimizationScreen />);
    await selectAssets(user);

    // 既定の4資産ウェイト（us_equity=22.88%, us_bond=21.40%）を選択資産2件で比率維持のまま
    // 合計100%に正規化する（us_bond の .sort() 順で並ぶ: 48.33% → 51.67%）
    const weightInputs = screen
      .getByText(/市場ポートフォリオのウェイト/)
      .closest('label')!
      .querySelectorAll('input');
    expect(weightInputs.length).toBe(2);
    const values = Array.from(weightInputs).map((i) => i.value);
    expect(values.sort()).toEqual(['48.33', '51.67']);
  });

  it('BL で実行すると POST body に BL フィールドが含まれる', async () => {
    const fetchMock = stubFetch({ body: BL_OPTIMIZATION_BODY, status: 200 });
    const user = userEvent.setup();
    renderWithProvider(<BlOptimizationScreen />);
    await selectAssets(user);

    // デフォルト市場ウェイト（51.67% / 48.33% → 比率 0.5167 / 0.4833）が POST body に反映される
    await user.click(screen.getByRole('button', { name: '最適化を実行' }));
    await waitFor(() => expect(screen.getByText('0.3000')).toBeInTheDocument());
    // 基準通貨が結果見出しに表示される
    expect(screen.getByText(/基準通貨: USD/)).toBeInTheDocument();

    const optCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/optimizations'),
    );
    const body = JSON.parse(String(optCalls[0][1]?.body));
    // 期待リターンは Black-Litterman 固定
    expect(body.expected_return_method).toBe('black_litterman');
    // 市場ウェイトは % → 比率へ変換されて送られる（0.5167 / 0.4833）
    expect(body.bl_market_weights.us_equity).toBeCloseTo(0.5167, 3);
    expect(body.bl_market_weights.us_bond).toBeCloseTo(0.4833, 3);
    expect(body.bl_omega_method).toBe('default');
    expect(body.bl_tau).toBe(0.05);
    // 未入力のビューは送られない
    expect(body.bl_views).toBeUndefined();
  });

  it('確信度入力は常に入力可能で、入力すると ω が Idzorek に自動切替される', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BlOptimizationScreen />);
    await selectAssets(user);

    // ビューを入力すると確信度入力欄が現れる
    const viewInputs = screen
      .getByText(/ビュー（年率期待リターン/)
      .closest('label')!
      .querySelectorAll('input');
    await user.type(viewInputs[0], '3');

    // ω=default でも入力可能（以前は disabled だった）
    const confInput = () =>
      screen.getByText(/ビューの確信度/).closest('label')!.querySelectorAll('input')[0];
    const omegaSelect = screen.getByRole('combobox', { name: /ω（ビュー不確実性）/ });
    expect(omegaSelect).toHaveValue('default');
    expect(confInput()).toBeEnabled();

    // 確信度を入力すると ω が idzorek へ自動切替される
    await user.type(confInput(), '0.8');
    expect(omegaSelect).toHaveValue('idzorek');
    expect(confInput()).toHaveValue(0.8);

    // ω を default へ戻しても入力欄は引き続き編集可能
    await user.selectOptions(omegaSelect, 'default');
    expect(confInput()).toBeEnabled();
  });

  it('idzorek でビューあり・確信度未入力のまま実行するとクライアント検証エラー', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BlOptimizationScreen />);
    await selectAssets(user);

    // ビューを入力
    const viewInputs = screen
      .getByText(/ビュー（年率期待リターン/)
      .closest('label')!
      .querySelectorAll('input');
    await user.type(viewInputs[0], '3');

    // ω=idzorek に変更（確信度は未入力のまま）
    const omegaSelect = screen.getByRole('combobox', { name: /ω（ビュー不確実性）/ });
    await user.selectOptions(omegaSelect, 'idzorek');

    await user.click(screen.getByRole('button', { name: '最適化を実行' }));
    // サーバへ送らず、クライアント検証で確信度未入力を明示する
    await screen.findByText(/ω=idzorek では、ビューのある資産すべてに確信度/);
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/optimizations')).length).toBe(0);
  });

  it('idzorek で確信度を入力すると bl_view_confidences が POST に含まれる', async () => {
    const fetchMock = stubFetch({ body: BL_OPTIMIZATION_BODY, status: 200 });
    const user = userEvent.setup();
    renderWithProvider(<BlOptimizationScreen />);
    await selectAssets(user);

    // ビューを入力
    const viewInputs = screen
      .getByText(/ビュー（年率期待リターン/)
      .closest('label')!
      .querySelectorAll('input');
    await user.type(viewInputs[0], '3');

    // ω=idzorek に変更し、確信度を入力
    const omegaSelect = screen.getByRole('combobox', { name: /ω（ビュー不確実性）/ });
    await user.selectOptions(omegaSelect, 'idzorek');
    const confInputs = screen
      .getByText(/ビューの確信度/)
      .closest('label')!
      .querySelectorAll('input');
    await user.type(confInputs[0], '0.8');

    await user.click(screen.getByRole('button', { name: '最適化を実行' }));
    await waitFor(() => expect(screen.getByText('0.3000')).toBeInTheDocument());

    const optCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/optimizations'),
    );
    const body = JSON.parse(String(optCalls[0][1]?.body));
    expect(body.bl_omega_method).toBe('idzorek');
    // ビューのある資産の確信度が送られる（0〜1 の値をそのまま）
    expect(body.bl_view_confidences).toBeDefined();
    expect(Object.values(body.bl_view_confidences)[0]).toBeCloseTo(0.8, 5);
  });

  it('市場ウェイトの合計が100%でない場合はバリデーションエラー', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BlOptimizationScreen />);
    await selectAssets(user);

    const weightInputs = screen
      .getByText(/市場ポートフォリオのウェイト/)
      .closest('label')!
      .querySelectorAll('input');
    // 2 資産目の値を書き換えて合計を崩す
    const secondInput = weightInputs[1];
    await user.clear(secondInput);
    await user.type(secondInput, '10');
    await user.click(screen.getByRole('button', { name: '最適化を実行' }));

    await screen.findByText(/市場ポートフォリオのウェイトの合計を 100%/);
  });

  it('日本モードでは JP 仮既定の市場ウェイトと JP ヒントが表示される', async () => {
    const jpAssets = {
      assets: [
        {
          logical_asset: 'jp_equity',
          asset_set: 'jp',
          display_name: '日本株式',
          default_ticker: '1306.T',
          underlying: null,
          asset_class: 'equity',
          currency: 'JPY',
          fx_hedged: false,
          dividend_policy: 'reinvest',
          history_start: null,
          note: '',
          data_status: {
            logical_asset: 'jp_equity',
            available: true,
            start: '2024-01-02',
            end: '2024-01-05',
            rows: 4,
            missing: 0,
            source: 'yahoo',
            price_type: 'adjusted_close',
            retrieved_at: '2024-01-06T00:00:00Z',
            snapshot_hash: 'jp1',
          },
        },
        {
          logical_asset: 'jp_bond',
          asset_set: 'jp',
          display_name: '日本債券',
          default_ticker: '2510.T',
          underlying: null,
          asset_class: 'bond',
          currency: 'JPY',
          fx_hedged: false,
          dividend_policy: 'reinvest',
          history_start: null,
          note: '',
          data_status: {
            logical_asset: 'jp_bond',
            available: true,
            start: '2024-01-02',
            end: '2024-01-05',
            rows: 4,
            missing: 0,
            source: 'yahoo',
            price_type: 'adjusted_close',
            retrieved_at: '2024-01-06T00:00:00Z',
            snapshot_hash: 'jp2',
          },
        },
      ],
    };
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/assets')) return Promise.resolve(jsonResponse(jpAssets));
      if (url.includes('/health')) {
        return Promise.resolve(jsonResponse({ status: 'ok', app: 'a', version: '1', app_env: 'test' }));
      }
      return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(
      <AssetSetProvider initialAssetSet="jp">
        <CompareProvider>
          <BlOptimizationScreen />
        </CompareProvider>
      </AssetSetProvider>,
    );

    await screen.findByRole('listbox', { name: /対象資産/ });
    await user.selectOptions(screen.getByRole('listbox', { name: /対象資産/ }), [
      'jp_equity',
      'jp_bond',
    ]);
    // 資産一覧は set=jp で取得される
    expect(fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('/assets?set=jp'))).toBe(true);

    const weightInputs = screen
      .getByText(/市場ポートフォリオのウェイト/)
      .closest('label')!
      .querySelectorAll('input');
    const values = Array.from(weightInputs)
      .map((i) => i.value)
      .sort();
    // JP 仮既定（jp_equity 0.25 / jp_bond 0.35）を選択2件で合計100%へ正規化: 41.67 / 58.33
    expect(values).toEqual(['41.67', '58.33']);
    // ヒントに JP 銘柄が表示される（米国銘柄ではない）
    expect(screen.getByText(/1550\.T/)).toBeInTheDocument();
  });
});