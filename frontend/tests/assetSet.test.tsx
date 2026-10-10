import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeaderBar } from '../src/components/HeaderBar';
import { ASSET_SET_STORAGE_KEY, AssetSetProvider, useAssetSet } from '../src/state/AssetSetContext';
import { useAssets } from '../src/hooks/useAssets';
import { render } from './test-utils';

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

/** localStorage に依存しないメモリ実装の Storage。 */
function makeMemoryStorage(): Storage {
  const data: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(data).length;
    },
    clear: () => {
      for (const key of Object.keys(data)) delete data[key];
    },
    getItem: (key: string) => data[key] ?? null,
    key: (index: number) => Object.keys(data)[index] ?? null,
    removeItem: (key: string) => {
      delete data[key];
    },
    setItem: (key: string, value: string) => {
      data[key] = String(value);
    },
  };
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

  it('Provider 未指定なら既定 us で動作する', async () => {
    const fetchMock = stubAssets();
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    // 既定モード us を set に付けて取得する
    expect(
      fetchMock.mock.calls.map((c) => String(c[0])).some((u) => u.includes('/assets?set=us')),
    ).toBe(true);
  });

  it('モードを切替すると localStorage に保存され、再マウントで復元される', async () => {
    stubAssets();
    const storage = makeMemoryStorage();
    const user = userEvent.setup();
    const { unmount } = render(
      <AssetSetProvider storage={storage}>
        <Harness />
      </AssetSetProvider>,
    );
    expect(screen.getByTestId('set')).toHaveTextContent('us');

    await user.click(screen.getByRole('button', { name: '日本へ' }));
    expect(screen.getByTestId('set')).toHaveTextContent('jp');
    // 切替時に localStorage へ保存される
    expect(storage.getItem(ASSET_SET_STORAGE_KEY)).toBe('jp');
    unmount();

    // 再マウントで復元される
    render(
      <AssetSetProvider storage={storage}>
        <Harness />
      </AssetSetProvider>,
    );
    expect(screen.getByTestId('set')).toHaveTextContent('jp');
  });

  it('localStorage に不正な値があっても us にフォールバックする', () => {
    const storage = makeMemoryStorage();
    storage.setItem(ASSET_SET_STORAGE_KEY, 'eu');
    render(
      <AssetSetProvider storage={storage}>
        <Harness />
      </AssetSetProvider>,
    );
    expect(screen.getByTestId('set')).toHaveTextContent('us');
  });

  it('HeaderBar のモード切替で基準通貨バッジ・説明文・選択状態が切り替わる', async () => {
    const storage = makeMemoryStorage();
    const user = userEvent.setup();
    render(
      <AssetSetProvider storage={storage}>
        <HeaderBar burgerOpened={false} onBurgerToggle={() => {}} />
      </AssetSetProvider>,
    );

    // 既定（米国モード）: USD バッジ・米国の説明文
    expect(screen.getByLabelText('基準通貨')).toHaveTextContent('USD');
    expect(screen.getByText(/米国株式・米国債券/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '米国' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '日本' })).not.toBeChecked();

    await user.click(screen.getByRole('radio', { name: '日本' }));

    // 日本モード: JPY バッジ・日本の説明文・選択状態の切替
    expect(screen.getByLabelText('基準通貨')).toHaveTextContent('JPY');
    expect(screen.getByText(/日本株式・日本債券/)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '日本' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '米国' })).not.toBeChecked();

    // 米国モードへ戻す
    await user.click(screen.getByRole('radio', { name: '米国' }));
    expect(screen.getByLabelText('基準通貨')).toHaveTextContent('USD');
    expect(screen.getByRole('radio', { name: '米国' })).toBeChecked();
  });
});
