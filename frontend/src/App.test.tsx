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
});
