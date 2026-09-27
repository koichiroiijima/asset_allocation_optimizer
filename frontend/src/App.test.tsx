import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function mockHealthOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          app: 'asset-allocation-optimizer',
          version: '0.1.0',
          app_env: 'test',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    ),
  );
}

describe('App', () => {
  beforeEach(() => {
    mockHealthOk();
  });

  it('アプリが描画されヘルス状態を表示する', async () => {
    render(<App />);
    const health = screen.getByTestId('health');
    await waitFor(() => expect(health).toHaveTextContent('API: 正常'));
  });

  it('ナビゲーションで画面を切り替えられる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '最適化' }));
    expect(screen.getByRole('heading', { name: '最適化' })).toBeInTheDocument();
  });

  it('「最適化（BL）」タブで BL 画面に切り替えられる', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '最適化（BL）' }));
    expect(screen.getByRole('heading', { name: '最適化（BL）' })).toBeInTheDocument();
  });

  it('モード切替（日本）で資産一覧を set=jp で再取得する', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/health')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ status: 'ok', app: 'a', version: '1', app_env: 'test' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ assets: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: '日本' }));
    // トグルが選択状態になる（aria-pressed）
    expect(screen.getByRole('button', { name: '日本' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '米国' })).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.some((u) => u.includes('/assets?set=jp'))).toBe(true);
    });
  });
});
