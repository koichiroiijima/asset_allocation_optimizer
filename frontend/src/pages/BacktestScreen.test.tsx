import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { CompareProvider } from '../compare/CompareContext';
import { BacktestScreen } from './BacktestScreen';

/** CompareProvider で包んで描画する。 */
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

const BACKTEST_BODY = {
  asset_ids: ['us_equity', 'us_bond'],
  params: {
    weights: { us_equity: 0.6, us_bond: 0.4 },
    rebalance_frequency: 'M',
    initial_capital: 1000000,
    cost_rate: 0.001,
    risk_free_rate: 0,
    annualization_factor: 252,
    lookback: 252,
  },
  currency: 'USD',
  metrics: {
    cumulative_return: 0.3,
    annual_return: 0.08,
    annual_volatility: 0.05,
    sharpe_ratio: 1.6,
    sortino_ratio: 1.2,
    calmar_ratio: 0.9,
    max_drawdown: -0.1,
    win_rate: 0.5,
    turnover: 0.4,
    total_fees: 12.5,
  },
  equity_curve: [
    { date: '2024-01-02', value: 1000000 },
    { date: '2024-01-03', value: 1300000 },
  ],
  drawdown: [
    { date: '2024-01-02', value: 0 },
    { date: '2024-01-03', value: -0.1 },
  ],
  yearly: [{ year: 2024, period_return: 0.3 }],
  allocation: [
    { date: '2024-01-02', weights: { us_equity: 0.6, us_bond: 0.4 } },
  ],
  trades: [
    {
      date: '2024-01-02',
      asset_id: 'us_equity',
      side: 'BUY',
      quantity: 10,
      price: 100,
      value: 1000,
      fee: 1,
    },
  ],
  warnings: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(backtestStub?: { body: unknown; status: number }) {
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
    void _init; // 送信 body は fetchMock.mock.calls からテストが直接読む
    const url = String(input);
    if (url.includes('/assets')) {
      return Promise.resolve(jsonResponse(ASSETS_BODY));
    }
    if (url.includes('/backtests')) {
      if (backtestStub == null) {
        return Promise.resolve(jsonResponse(BACKTEST_BODY));
      }
      return Promise.resolve(jsonResponse(backtestStub.body, backtestStub.status));
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

/** 取得済み2資産をチェックし、ウェイトを 0.6/0.4 に設定して実行する。 */
async function selectTwoAssetsAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('checkbox', { name: /米国株式/ });
  await user.click(screen.getByRole('checkbox', { name: /米国株式/ }));
  await user.click(screen.getByRole('checkbox', { name: /米国債券/ }));

  // ウェイト入力（米国株式 0.6、米国債券 0.4）
  const equityWeight = screen.getByLabelText(/米国株式.*ウェイト/);
  await user.clear(equityWeight);
  await user.type(equityWeight, '0.6');
  const bondWeight = screen.getByLabelText(/米国債券.*ウェイト/);
  await user.clear(bondWeight);
  await user.type(bondWeight, '0.4');

  submitForm();
}

/** フォームの submit イベントを発火する（jsdom では click で不発火のため fireEvent を使用）。 */
function submitForm() {
  const form = screen.getByRole('button', { name: 'バックテストを実行' }).closest('form');
  expect(form).not.toBeNull();
  fireEvent.submit(form!);
}

describe('BacktestScreen', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('取得済み資産のみが対象選択肢に表示される', async () => {
    stubFetch();
    renderWithProvider(<BacktestScreen />);
    await screen.findByRole('checkbox', { name: /米国株式/ });
    expect(screen.getByRole('checkbox', { name: /米国債券/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /米国を除く株式/ })).not.toBeInTheDocument();
  });

  it('実行すると POST body と結果が正しい', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BacktestScreen />);
    await selectTwoAssetsAndSubmit(user);

    // 結果表示
    await screen.findAllByText('30.00%'); // cumulative_return（指標表とグラフラベル）
    expect(screen.getAllByText('8.00%').length).toBeGreaterThan(0); // annual_return
    expect(screen.getAllByText('米国株式（VTI）').length).toBeGreaterThan(0); // 取引一覧

    // POST body 検証
    const btCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/backtests'));
    expect(btCalls.length).toBe(1);
    const body = JSON.parse(String(btCalls[0][1]?.body));
    expect(body.asset_ids).toEqual(['us_equity', 'us_bond']);
    expect(body.weights).toEqual({ us_equity: 0.6, us_bond: 0.4 });
    expect(body.rebalance_frequency).toBe('M');
    expect(body.initial_capital).toBe(1000000);
  });

  it('ウェイト合計が 1 でないとエラー（fetch しない）', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BacktestScreen />);
    await screen.findByRole('checkbox', { name: /米国株式/ });
    await user.click(screen.getByRole('checkbox', { name: /米国株式/ }));
    await user.click(screen.getByRole('checkbox', { name: /米国債券/ }));
    const equityWeight = screen.getByLabelText(/米国株式.*ウェイト/);
    await user.clear(equityWeight);
    await user.type(equityWeight, '0.2');
    const bondWeight = screen.getByLabelText(/米国債券.*ウェイト/);
    await user.clear(bondWeight);
    await user.type(bondWeight, '0.2');

    submitForm();

    await screen.findByText(/ウェイトの合計が 1 になっていません/);
    await waitFor(() => {
      const btCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/backtests'));
      expect(btCalls.length).toBe(0);
    });
  });

  it('バックエンドが400（日本語 detail）を返すとエラー表示', async () => {
    stubFetch({ body: { detail: 'データが未取得の資産があるためバックテストを実行できません: ex_us_equity' }, status: 400 });
    const user = userEvent.setup();
    renderWithProvider(<BacktestScreen />);
    await selectTwoAssetsAndSubmit(user);
    await screen.findByText(/バックテストの実行に失敗しました: データが未取得の資産/);
  });

  it('取得済みの資産が無い場合は警告を表示しフォームを出さない', async () => {
    const noAssetsBody = { assets: ASSETS_BODY.assets.map((a) => ({ ...a, data_status: null })) };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/assets')) return Promise.resolve(jsonResponse(noAssetsBody));
        if (url.includes('/health')) {
          return Promise.resolve(jsonResponse({ status: 'ok', app: 'a', version: '1', app_env: 'test' }));
        }
        return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
      }),
    );
    renderWithProvider(<BacktestScreen />);
    await screen.findByText(/取得済みの資産がありません。/);
    expect(screen.queryByRole('button', { name: 'バックテストを実行' })).not.toBeInTheDocument();
  });
});