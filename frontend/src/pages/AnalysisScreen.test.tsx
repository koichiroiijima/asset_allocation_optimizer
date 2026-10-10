import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisScreen } from './AnalysisScreen';
import { render } from '../../tests/test-utils';

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
        missing: 0,
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
  ],
};

const ANALYSIS_BODY = {
  currency: 'USD',
  assets_used: ['us_equity', 'us_bond'],
  window: 60,
  prices: [
    { asset_id: 'us_equity', points: [{ date: '2024-01-02', value: 100 }] },
    { asset_id: 'us_bond', points: [{ date: '2024-01-02', value: 100 }] },
  ],
  cumulative: [],
  rolling_volatility: [],
  correlation: {
    assets: ['us_equity', 'us_bond'],
    matrix: [
      [1, null],
      [null, 1],
    ],
  },
  stats: [
    {
      asset_id: 'us_equity',
      mean_annual_return: 0.12,
      ema_annual_return: 0.25,
      annual_volatility: 0.19,
      sharpe_ratio: 0.63,
    },
    {
      asset_id: 'us_bond',
      mean_annual_return: 0.03,
      ema_annual_return: 0.03,
      annual_volatility: 0.05,
      sharpe_ratio: 0.6,
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

function stubFetch(analysisBody?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/assets')) return Promise.resolve(jsonResponse(ASSETS_BODY));
      if (url.includes('/data/analysis')) {
        return Promise.resolve(jsonResponse(analysisBody ?? ANALYSIS_BODY));
      }
      if (url.includes('/health')) {
        return Promise.resolve(
          jsonResponse({ status: 'ok', app: 'a', version: '1', app_env: 'test' }),
        );
      }
      return Promise.resolve(jsonResponse({ detail: 'not found' }, 404));
    }),
  );
}

describe('AnalysisScreen', () => {
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

  it('リターン・リスク統計表に平均/EMA リターンとリスクを表示する', async () => {
    stubFetch();
    render(<AnalysisScreen />);
    // 統計表の見出し
    expect(await screen.findByText('リターン・リスク統計（年率）')).toBeInTheDocument();
    expect(screen.getByText('平均リターン')).toBeInTheDocument();
    expect(screen.getByText('EMA リターン')).toBeInTheDocument();
    expect(screen.getByText('年率ボラティリティ（リスク）')).toBeInTheDocument();
    expect(screen.getByText('シャープレシオ')).toBeInTheDocument();
    // 値: 平均 12%、EMA 25%（%表示）
    expect(screen.getByText('12.00%')).toBeInTheDocument();
    expect(screen.getByText('25.00%')).toBeInTheDocument();
  });

  it('統計が空の場合は警告を表示する', async () => {
    stubFetch({ ...ANALYSIS_BODY, stats: [] });
    render(<AnalysisScreen />);
    expect(await screen.findByText('表示できるリターン統計がありません。')).toBeInTheDocument();
  });
});
