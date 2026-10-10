import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataScreen } from './DataScreen';
import { render } from '../../tests/test-utils';

/** ResponsiveContainer（recharts）が使う ResizeObserver をモックする。 */
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
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
      data_status: null,
    },
  ],
};

const SERIES_BODY = {
  asset_id: 'us_equity',
  currency: 'JPY',
  series_type: 'adjusted_close',
  points: [{ date: '2024-01-02', value: 120 }],
  warnings: [],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/assets')) {
      return Promise.resolve(jsonResponse(ASSETS_BODY));
    }
    if (url.includes('/data/series')) {
      return Promise.resolve(jsonResponse(SERIES_BODY));
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

describe('DataScreen', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('資産一覧を取得して表を描画する', async () => {
    stubFetch();
    render(<DataScreen />);
    await screen.findByText('米国株式');
    expect(screen.getByText('VTI')).toBeInTheDocument();
    // 資産一覧表に通貨列がある
    expect(screen.getByRole('columnheader', { name: '通貨' })).toBeInTheDocument();
    expect(screen.getAllByText('USD').length).toBe(2);
    expect(screen.getByText('取得済み')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('未取得')).toBeInTheDocument());
    expect(screen.getByText('米国債券')).toBeInTheDocument();
  });

  it('資産選択で系列を取得し切替で再取得する', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    render(<DataScreen />);
    await screen.findByText('米国株式');

    const assetSelect = screen.getByRole('combobox', { name: /資産/ });
    await user.selectOptions(assetSelect, 'us_equity');
    // 系列メタ情報（資産 / 系列種別 / 頻度）が表示される
    await screen.findByText('米国株式 / adjusted_close / D');
    // 系列リクエストが発行された
    await waitFor(() => {
      const seriesCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/data/series'),
      );
      expect(seriesCalls.length).toBeGreaterThan(0);
    });

    fetchMock.mockClear();
    const seriesTypeSelect = screen.getByRole('combobox', { name: /系列種別/ });
    await user.selectOptions(seriesTypeSelect, 'cumulative');
    await waitFor(() => {
      const seriesCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/data/series'),
      );
      expect(seriesCalls.length).toBeGreaterThan(0);
      expect(String(seriesCalls[0][0])).toContain('series_type=cumulative');
    });

    const freqSelect = screen.getByRole('combobox', { name: /頻度/ });
    await user.selectOptions(freqSelect, 'M');
    await waitFor(() => {
      const seriesCalls = fetchMock.mock.calls.filter(([input]) =>
        String(input).includes('/data/series'),
      );
      expect(String(seriesCalls[seriesCalls.length - 1][0])).toContain('frequency=M');
    });
  });

  it('資産一覧の取得失敗で再試行ボタンを表示する', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'サーバーエラー' }, 500)),
    );
    render(<DataScreen />);
    await screen.findByText(/資産一覧の取得に失敗しました/);
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
  });
});
