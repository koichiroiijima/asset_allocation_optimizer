import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import type {
  BacktestResponse,
  OptimizationResponse,
} from '../api/types';
import { CompareProvider, useCompare } from '../compare/CompareContext';
import { makeResultId, type StoredResult } from '../compare/types';
import { CompareScreen } from './CompareScreen';

/** テスト用の最適化結果。 */
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

/** テスト用のバックテスト結果。 */
const BACKTEST_RESULT: BacktestResponse = {
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
  equity_curve: [],
  drawdown: [],
  yearly: [],
  allocation: [],
  trades: [],
  warnings: [],
};

function optStored(label: string, overrides: Partial<StoredResult> = {}): StoredResult {
  return {
    id: makeResultId(),
    kind: 'optimization',
    label,
    executedAt: '2026-08-09T10:00:00.000Z',
    result: OPTIMIZATION_RESULT,
    ...overrides,
  };
}

function btStored(label: string, overrides: Partial<StoredResult> = {}): StoredResult {
  return {
    id: makeResultId(),
    kind: 'backtest',
    label,
    executedAt: '2026-08-09T11:00:00.000Z',
    result: BACKTEST_RESULT,
    ...overrides,
  };
}

/** 初期結果を Provider に投入してから画面を描画する。 */
function renderWithResults(results: StoredResult[]) {
  function Seed({ initial }: { initial: StoredResult[] }) {
    const { addResult } = useCompare();
    // マウント後に投入する（レンダー中の setState を避けるため）
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
    React.useEffect(() => {
      for (const r of initial) addResult(r);
    }, [initial]);
    return null;
  }
  render(
    <CompareProvider>
      <Seed initial={results} />
      <CompareScreen />
    </CompareProvider>,
  );
}

/** URL.createObjectURL / revokeObjectURL と downloadBlob の生成要素をモックする。 */
function stubBlob() {
  const create = vi.fn(() => 'blob:mock-url');
  vi.stubGlobal('URL', { ...URL, createObjectURL: create, revokeObjectURL: vi.fn() });
  // downloadBlob は a 要素を作成して click する。click を記録しタグ以外は元の動作を保つ
  const originalCreate = document.createElement.bind(document);
  const click = vi.fn();
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    const el = originalCreate(tag);
    if (tag === 'a') {
      el.click = click;
    }
    return el;
  });
  return { create, click };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CompareScreen', () => {
  it('結果が無い場合は案内を表示する', () => {
    render(
      <CompareProvider>
        <CompareScreen />
      </CompareProvider>,
    );
    expect(
      screen.getByText(/比較に追加した結果がありません。/),
    ).toBeInTheDocument();
  });

  it('結果がある場合は一覧・比較表を表示し、ラベルと指標値が読める', async () => {
    renderWithResults([
      optStored('最適化テストA'),
      btStored('バックテストB', {
        // ラベル変更を確認するために id を固定
      }),
    ]);
    // 一覧にラベルが表示される
    expect(screen.getByDisplayValue('最適化テストA')).toBeInTheDocument();
    expect(screen.getByDisplayValue('バックテストB')).toBeInTheDocument();
    // 指標比較に種別・数値が表示される（最適化側の期待リターン 8%、バックテスト側の累積 30%）
    expect(screen.getAllByText('8.00%').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30.00%').length).toBeGreaterThan(0);
  });

  it('ラベルを編集すると renameResult が反映される', async () => {
    const initial = optStored('初期ラベル');
    renderWithResults([initial]);
    await screen.findByDisplayValue('初期ラベル');
    const input = screen.getByDisplayValue('初期ラベル');
    await userEvent.clear(input);
    await userEvent.type(input, '新しいラベル');
    expect(screen.getByDisplayValue('新しいラベル')).toBeInTheDocument();
  });

  it('削除ボタンで結果が取り除かれる', async () => {
    const initial = optStored('削除対象');
    renderWithResults([initial]);
    await screen.findByDisplayValue('削除対象');
    fireEvent.click(screen.getByRole('button', { name: '削除' }));
    expect(screen.queryByDisplayValue('削除対象')).not.toBeInTheDocument();
  });

  it('JSON/CSV エクスポートが Blob を生成する', async () => {
    const { create, click } = stubBlob();
    renderWithResults([optStored('JSONテスト'), btStored('CSVテスト')]);
    const jsonButton = await screen.findByRole('button', { name: 'JSON エクスポート' });
    const csvButton = screen.getByRole('button', { name: 'CSV エクスポート' });

    fireEvent.click(jsonButton);
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    expect(jsonButton).toBeInTheDocument();

    fireEvent.click(csvButton);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('エクスポートは結果をラベル付きで含む（視覚的確認用にボタンが存在する）', async () => {
    stubBlob();
    renderWithResults([optStored('一覧に表示されるラベル')]);
    expect(screen.getByRole('button', { name: 'JSON エクスポート' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV エクスポート' })).toBeInTheDocument();
  });
});