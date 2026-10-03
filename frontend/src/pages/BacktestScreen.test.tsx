import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import type { OptimizationResponse } from '../api/types';
import { CompareProvider, useCompare } from '../compare/CompareContext';
import { type StoredResult } from '../compare/types';
import { BacktestScreen } from './BacktestScreen';

/** テスト用の最適化結果（再最適化元の選択肢として保存する）。 */
const OPTIMIZATION_RESULT: OptimizationResponse = {
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

/** 初期結果を Provider に投入してから画面を描画する。 */
function Seed({ initial }: { initial: StoredResult[] }) {
  const { addResult } = useCompare();
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  React.useEffect(() => {
    for (const r of initial) addResult(r);
  }, [initial]);
  return null;
}

/** CompareProvider で包んで描画する。追加の Provider ラッパーを指定できる。 */
function renderWithProvider(
  ui: React.ReactNode,
  wrapper?: (children: React.ReactNode) => React.ReactNode,
) {
  return render(wrapper ? wrapper(ui) : <CompareProvider>{ui}</CompareProvider>);
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

/** 取得済み2資産を選択し、ウェイトを 0.6/0.4 に設定して実行する。 */
async function selectTwoAssetsAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  const listbox = await screen.findByRole('listbox', { name: /対象資産/ });
  await user.selectOptions(listbox, ['us_equity', 'us_bond']);

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

  it('未取得資産も対象選択肢に表示され、入力不可（disabled）になる', async () => {
    stubFetch();
    renderWithProvider(<BacktestScreen />);
    const listbox = await screen.findByRole('listbox', { name: /対象資産/ });
    const options = Array.from(listbox.querySelectorAll('option'));
    const byText = (t: string) => options.find((o) => o.textContent === t)!;
    expect(byText('米国株式（VTI）').disabled).toBe(false);
    expect(byText('米国債券（BND）').disabled).toBe(false);
    // 未取得資産は消さず、disabled で表示する
    expect(byText('米国を除く株式（VXUS）（未取得）')).toBeTruthy();
    expect(byText('米国を除く株式（VXUS）（未取得）').disabled).toBe(true);
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

  it('初期資金は小数でも送信でき、入力欄は step 刻み検証を持たない', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();

    // 入力欄が step="any"（ブラウザの刻み検証で既定値・小数が弾かれない）
    renderWithProvider(<BacktestScreen />);
    await screen.findByRole('listbox', { name: /対象資産/ });
    const capitalInput = screen.getByLabelText(/初期資金/) as HTMLInputElement;
    expect(capitalInput.getAttribute('step')).toBe('any');

    // 小数の初期資金を入力してから資産選択・送信すると、その値がそのまま送られる
    await user.clear(capitalInput);
    await user.type(capitalInput, '123.45');
    await selectTwoAssetsAndSubmit(user);

    await screen.findAllByText('30.00%');
    const btCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/backtests'));
    expect(btCalls.length).toBe(1);
    expect(JSON.parse(String(btCalls[0][1]?.body)).initial_capital).toBe(123.45);
  });

  it('ウェイト合計が 1 でないとエラー（fetch しない）', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BacktestScreen />);
    await screen.findByRole('listbox', { name: /対象資産/ });
    await user.selectOptions(screen.getByRole('listbox', { name: /対象資産/ }), [
      'us_equity',
      'us_bond',
    ]);
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

  it('リバランス頻度に年次（Y）が選べ、POST body に反映される', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderWithProvider(<BacktestScreen />);
    await selectTwoAssetsAndSubmit(user);

    const freqSelect = screen.getByRole('combobox', { name: /リバランス頻度/ });
    await user.selectOptions(freqSelect, 'Y');

    submitForm();
    await waitFor(() => {
      const btCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/backtests'),
      );
      const body = JSON.parse(String(btCalls[btCalls.length - 1][1]?.body));
      expect(body.rebalance_frequency).toBe('Y');
    });
  });

  it('保存済み最適化を選択すると POST body に再最適化として反映される', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    // 保存済みの最適化結果（request 付き）を Provider に投入する
    const saved: StoredResult = {
      id: 'opt-1',
      kind: 'optimization',
      label: '最適化（max_sharpe / mean_historical_return）',
      executedAt: '2026-08-09T10:00:00.000Z',
      result: OPTIMIZATION_RESULT,
      request: {
        asset_ids: ['us_equity', 'us_bond'],
        optimization_method: 'max_sharpe',
        expected_return_method: 'mean_historical_return',
        covariance_method: 'sample_cov',
        risk_free_rate: 0,
        annualization_factor: 252,
        weight_bounds: [0, 1],
      },
    };
    renderWithProvider(
      <BacktestScreen />,
      (providerChildren) => (
        <CompareProvider>
          <Seed initial={[saved]} />
          {providerChildren}
        </CompareProvider>
      ),
    );

    await selectTwoAssetsAndSubmit(user);

    // 保存済み最適化を選択するだけで再最適化が有効になる
    await user.selectOptions(screen.getByRole('combobox', { name: /再最適化元の最適化/ }), 'opt-1');

    submitForm();
    await waitFor(() => {
      const btCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/backtests'),
      );
      const body = JSON.parse(String(btCalls[btCalls.length - 1][1]?.body));
      expect(body.reoptimize).toBe(true);
      expect(body.optimization_params.optimization_method).toBe('max_sharpe');
    });
  });

  it('再最適化元が未選択なら固定ウェイトで送信される', async () => {
    const fetchMock = stubFetch();
    const saved: StoredResult = {
      id: 'opt-1',
      kind: 'optimization',
      label: '最適化（max_sharpe / mean_historical_return）',
      executedAt: '2026-08-09T10:00:00.000Z',
      result: OPTIMIZATION_RESULT,
      request: {
        asset_ids: ['us_equity', 'us_bond'],
        optimization_method: 'max_sharpe',
        expected_return_method: 'mean_historical_return',
        covariance_method: 'sample_cov',
        risk_free_rate: 0,
        annualization_factor: 252,
        weight_bounds: [0, 1],
      },
    };
    renderWithProvider(
      <BacktestScreen />,
      (providerChildren) => (
        <CompareProvider>
          <Seed initial={[saved]} />
          {providerChildren}
        </CompareProvider>
      ),
    );
    const user = userEvent.setup();
    await selectTwoAssetsAndSubmit(user);

    await screen.findAllByText('30.00%');
    const btCalls = fetchMock.mock.calls.filter(([input]) => String(input).includes('/backtests'));
    expect(btCalls.length).toBe(1);
    const body = JSON.parse(String(btCalls[0][1]?.body));
    expect(body.reoptimize).toBe(false);
    expect(body.optimization_params).toBeUndefined();
  });

  it('取得済みの資産が無い場合は警告を表示し、選択肢をすべて入力不可にする', async () => {
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
    // フォームは描画されるが、選択肢はすべて入力不可（非表示にはしない）
    const assetOptions = Array.from(
      screen.getByRole('listbox', { name: /対象資産/ }).querySelectorAll('option'),
    );
    expect(assetOptions.length).toBe(ASSETS_BODY.assets.length);
    expect(assetOptions.every((o) => o.disabled)).toBe(true);
  });
});