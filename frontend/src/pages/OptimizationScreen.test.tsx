import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { CompareProvider } from '../compare/CompareContext';
import { OptimizationScreen } from './OptimizationScreen';

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

const OPTIMIZATION_BODY = {
  method: 'max_sharpe',
  weights: { us_equity: 0.4, us_bond: 0.6 },
  clean_weights: { us_equity: 0.4, us_bond: 0.6 },
  metrics: {
    expected_annual_return: 0.08,
    annual_volatility: 0.05,
    sharpe_ratio: 1.6,
    asset_returns: { us_equity: 0.12, us_bond: 0.03 },
    asset_volatilities: { us_equity: 0.19, us_bond: 0.05 },
  },
  params: {
    optimization_method: 'max_sharpe',
    expected_return_method: 'mean_historical_return',
    covariance_method: 'sample_cov',
    risk_free_rate: 0,
    annualization_factor: 252,
    weight_bounds: [0, 1],
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
        return Promise.resolve(jsonResponse(OPTIMIZATION_BODY));
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

/** 取得済み 2 資産を選択し、最適化を実行する共通ヘルパー。 */
async function selectTwoAssetsAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('listbox', { name: /対象資産/ });
  const assetSelect = screen.getByRole('listbox', { name: /対象資産/ });
  await user.selectOptions(assetSelect, ['us_equity', 'us_bond']);
  await user.click(screen.getByRole('button', { name: '最適化を実行' }));
}

describe('OptimizationScreen', () => {
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

  it('取得済み資産のみが対象資産の選択肢に表示される', async () => {
    stubFetch();
    renderWithProvider(<OptimizationScreen />);
    const assetSelect = await screen.findByRole('listbox', { name: /対象資産/ });
    // 資産セレクト内の option のみを対象にする（手法・期待リターン等の option と混ざらない）
    const assetOptions = Array.from(assetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(assetOptions.sort()).toEqual(['米国債券（BND）', '米国株式（VTI）']);
    expect(screen.queryByText('米国を除く株式（VXUS）')).not.toBeInTheDocument();
  });

  it('対象資産2件を選択して実行すると POST body と結果が正しい', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await selectTwoAssetsAndSubmit(user);

    // 結果表が表示される
    await waitFor(() => expect(screen.getByText('0.4000')).toBeInTheDocument());

    // POST body を検証する
    const optCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/optimizations'),
    );
    expect(optCalls.length).toBe(1);
    const body = JSON.parse(String(optCalls[0][1]?.body));
    expect(body.asset_ids).toEqual(['us_equity', 'us_bond']);
    expect(body.optimization_method).toBe('max_sharpe');
    expect(body.weight_bounds).toEqual([0, 1]);
  });

  it('efficient_return 選択時のみ target_return が表示される', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await screen.findByRole('listbox', { name: /対象資産/ });

    expect(screen.queryByText('目標リターン（年率）')).not.toBeInTheDocument();

    const methodSelect = screen.getByRole('combobox', { name: /手法/ });
    await user.selectOptions(methodSelect, 'efficient_return');
    expect(screen.getByText('目標リターン（年率）')).toBeInTheDocument();
    expect(screen.queryByText('目標ボラティリティ（年率）')).not.toBeInTheDocument();

    await user.selectOptions(methodSelect, 'max_sharpe');
    expect(screen.queryByText('目標リターン（年率）')).not.toBeInTheDocument();
  });

  it('efficient_return に説明文が表示されない（target_return 入力は残る）', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await screen.findByRole('listbox', { name: /対象資産/ });
    const methodSelect = screen.getByRole('combobox', { name: /手法/ });
    await user.selectOptions(methodSelect, 'efficient_return');
    expect(screen.getByText('目標リターン（年率）')).toBeInTheDocument();
    // 削除した説明文が表示されないこと
    expect(screen.queryByText(/目標リターンは、最適化に使う/)).not.toBeInTheDocument();
  });

  it('個別資産のリターン・リスク統計が表示される', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await selectTwoAssetsAndSubmit(user);

    await waitFor(() => expect(screen.getByText('0.4000')).toBeInTheDocument());
    expect(screen.getByText('個別資産のリターン・リスク（年率）')).toBeInTheDocument();
    // 資産ごとの年率リターン（12%、3%）と年率ボラ（19%、5%）
    expect(screen.getByText('12.00%')).toBeInTheDocument();
    expect(screen.getByText('3.00%')).toBeInTheDocument();
    expect(screen.getByText('19.00%')).toBeInTheDocument();
    expect(screen.getByText('5.00%')).toBeInTheDocument();
  });

  it('バックエンドが400（日本語 detail）を返すとエラーを表示する', async () => {
    stubFetch({
      body: { detail: 'データが未取得の資産があるため最適化を実行できません: us_equity' },
      status: 400,
    });
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await selectTwoAssetsAndSubmit(user);
    await screen.findByText(/最適化の実行に失敗しました: データが未取得の資産があるため最適化を実行できません/);
  });

  it('取得済みの資産が無い場合は警告を表示しフォームを出さない', async () => {
    const noAssetsBody = {
      assets: ASSETS_BODY.assets.map((a) => ({ ...a, data_status: null })),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/assets')) return Promise.resolve(jsonResponse(noAssetsBody));
        if (url.includes('/health')) {
          return Promise.resolve(
            jsonResponse({ status: 'ok', app: 'a', version: '1', app_env: 'test' }),
          );
        }
        return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
      }),
    );
    renderWithProvider(<OptimizationScreen />);
    await screen.findByText(/取得済みの資産がありません。/);
    expect(screen.queryByRole('button', { name: '最適化を実行' })).not.toBeInTheDocument();
  });
});

describe('OptimizationScreen / Black-Litterman', () => {
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

  async function selectBLAndAssets(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('listbox', { name: /対象資産/ });
    const assetSelect = screen.getByRole('listbox', { name: /対象資産/ });
    await user.selectOptions(assetSelect, ['us_equity', 'us_bond']);
    const expectedReturnSelect = screen.getByRole('combobox', { name: /期待リターン/ });
    await user.selectOptions(expectedReturnSelect, 'black_litterman');
  }

  it('BL 選択で市場ポートフォリオ・ビュー・τ の入力が現れる', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await selectBLAndAssets(user);

    expect(screen.getByText(/市場ポートフォリオのウェイト/)).toBeInTheDocument();
    expect(screen.getByText(/ビュー（年率期待超過リターン/)).toBeInTheDocument();
    expect(screen.getByText(/τ（ビュー信頼係数）/)).toBeInTheDocument();
    expect(screen.getByText(/リスク回避度/)).toBeInTheDocument();
  });

  it('選択資産にデフォルトの市場ウェイト（合計100%）が表示される', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await selectBLAndAssets(user);

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
    renderWithProvider(<OptimizationScreen />);
    await selectBLAndAssets(user);

    // デフォルト市場ウェイト（51.67% / 48.33% → 比率 0.5167 / 0.4833）が POST body に反映される
    await user.click(screen.getByRole('button', { name: '最適化を実行' }));
    await waitFor(() => expect(screen.getByText('0.3000')).toBeInTheDocument());

    const optCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/optimizations'),
    );
    const body = JSON.parse(String(optCalls[0][1]?.body));
    // 市場ウェイトは % → 比率へ変換されて送られる（0.5167 / 0.4833）
    expect(body.bl_market_weights.us_equity).toBeCloseTo(0.5167, 3);
    expect(body.bl_market_weights.us_bond).toBeCloseTo(0.4833, 3);
    expect(body.bl_omega_method).toBe('default');
    expect(body.bl_tau).toBe(0.05);
    // 未入力のビューは送られない
    expect(body.bl_views).toBeUndefined();
  });

  it('ω=idzorek 選択時のみ確信度入力が現れる', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await selectBLAndAssets(user);

    expect(screen.queryByText(/ビューの確信度/)).not.toBeInTheDocument();

    const omegaSelect = screen.getByRole('combobox', { name: /ω（ビュー不確実性）/ });
    await user.selectOptions(omegaSelect, 'idzorek');
    expect(screen.getByText(/ビューの確信度/)).toBeInTheDocument();
  });

  it('市場ウェイトの合計が100%でない場合はバリデーションエラー', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<OptimizationScreen />);
    await selectBLAndAssets(user);

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
});