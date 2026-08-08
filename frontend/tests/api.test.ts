import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from '../src/api/client';

describe('ApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getHealth が正常系でヘルスを返す', async () => {
    const body = { status: 'ok', app: 'a', version: '1', app_env: 'test' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const client = createApiClient();
    await expect(client.getHealth()).resolves.toEqual(body);
  });

  it('getHealth がエラー時に detail を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: 'サーバーエラー' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const client = createApiClient();
    await expect(client.getHealth()).rejects.toThrow('サーバーエラー');
  });

  it('getSeries がクエリを組み立て系列を返す', async () => {
    const body = {
      asset_id: 'us_equity',
      currency: 'JPY',
      series_type: 'adjusted_close',
      points: [{ date: '2024-01-02', value: 100 }],
      warnings: [],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createApiClient();
    const result = await client.getSeries({
      asset_id: 'us_equity',
      frequency: 'M',
      series_type: 'cumulative',
    });
    expect(result).toEqual(body);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/data/series?');
    expect(calledUrl).toContain('asset_id=us_equity');
    expect(calledUrl).toContain('frequency=M');
    expect(calledUrl).toContain('series_type=cumulative');
  });

  it('getSeries がエラー時に detail を投げる', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: '系列エラー' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    const client = createApiClient();
    await expect(client.getSeries({ asset_id: 'us_equity' })).rejects.toThrow('系列エラー');
  });
});
