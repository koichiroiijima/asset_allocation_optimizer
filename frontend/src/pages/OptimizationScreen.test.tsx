import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OptimizationScreen } from './OptimizationScreen';

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

const OPTIMIZATION_BODY = {
  method: 'max_sharpe',
  weights: { us_equity: 0.4, us_bond: 0.6 },
  clean_weights: { us_equity: 0.4, us_bond: 0.6 },
  metrics: {
    expected_annual_return: 0.08,
    annual_volatility: 0.05,
    sharpe_ratio: 1.6,
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
    render(<OptimizationScreen />);
    const assetSelect = await screen.findByRole('listbox', { name: /対象資産/ });
    // 資産セレクト内の option のみを対象にする（手法・期待リターン等の option と混ざらない）
    const assetOptions = Array.from(assetSelect.querySelectorAll('option')).map((o) => o.textContent);
    expect(assetOptions.sort()).toEqual(['米国債券（BND）', '米国株式（VTI）']);
    expect(screen.queryByText('米国を除く株式（VXUS）')).not.toBeInTheDocument();
  });

  it('対象資産2件を選択して実行すると POST body と結果が正しい', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<OptimizationScreen />);
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
    render(<OptimizationScreen />);
    await screen.findByRole('listbox', { name: /対象資産/ });

    expect(screen.queryByText('目標リターン（年率）')).not.toBeInTheDocument();

    const methodSelect = screen.getByRole('combobox', { name: /手法/ });
    await user.selectOptions(methodSelect, 'efficient_return');
    expect(screen.getByText('目標リターン（年率）')).toBeInTheDocument();
    expect(screen.queryByText('目標ボラティリティ（年率）')).not.toBeInTheDocument();

    await user.selectOptions(methodSelect, 'max_sharpe');
    expect(screen.queryByText('目標リターン（年率）')).not.toBeInTheDocument();
  });

  it('バックエンドが400（日本語 detail）を返すとエラーを表示する', async () => {
    stubFetch({
      body: { detail: 'データが未取得の資産があるため最適化を実行できません: us_equity' },
      status: 400,
    });
    const user = userEvent.setup();
    render(<OptimizationScreen />);
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
    render(<OptimizationScreen />);
    await screen.findByText(/取得済みの資産がありません。/);
    expect(screen.queryByRole('button', { name: '最適化を実行' })).not.toBeInTheDocument();
  });
});