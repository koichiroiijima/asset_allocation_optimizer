import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetSetProvider, useAssetSet } from '../src/state/AssetSetContext';
import { useAssets } from '../src/hooks/useAssets';

/** 現在のモードと資産一覧を表示し、切替ボタンを持つテスト用コンポーネント。 */
function Harness() {
  const { assetSet, setAssetSet } = useAssetSet();
  const { assets } = useAssets();
  return (
    <div>
      <span data-testid="set">{assetSet}</span>
      <span data-testid="count">{assets?.assets.length ?? -1}</span>
      <button type="button" onClick={() => setAssetSet('jp')}>
        日本へ
      </button>
    </div>
  );
}

function stubAssets() {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/assets')) {
      return Promise.resolve(
        new Response(JSON.stringify({ assets: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ detail: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AssetSetContext + useAssets', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('既定は us で、setAssetSet で jp に切り替わる', async () => {
    stubAssets();
    const user = userEvent.setup();
    render(
      <AssetSetProvider>
        <Harness />
      </AssetSetProvider>,
    );
    expect(screen.getByTestId('set')).toHaveTextContent('us');
    await user.click(screen.getByRole('button', { name: '日本へ' }));
    expect(screen.getByTestId('set')).toHaveTextContent('jp');
  });

  it('Provider 未指定なら既定 us で動作する', async () => {
    const fetchMock = stubAssets();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    // 既定モード us を set に付けて取得する
    expect(fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('/assets?set=us'))).toBe(
      true,
    );
  });

  it('モード切替で useAssets が set=jp を付けて再取得する', async () => {
    const fetchMock = stubAssets();
    const user = userEvent.setup();
    render(
      <AssetSetProvider>
        <Harness />
      </AssetSetProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    await user.click(screen.getByRole('button', { name: '日本へ' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/assets?set=jp'))).toBe(true);
    });
  });
});
