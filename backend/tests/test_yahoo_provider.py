"""YahooPriceProvider のテスト（ネットワーク不使用）。

httpx.MockTransport で固定フィクスチャを返し、レスポンスの解釈を検証する。
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import httpx
import pytest
from app.data.providers.yahoo import (
    CHART_URL,
    DEFAULT_UA,
    ProviderDataError,
    YahooPriceProvider,
)

SYMBOLS = {"us_equity": "VTI"}


def _provider(client: httpx.Client) -> YahooPriceProvider:
    return YahooPriceProvider(SYMBOLS, client=client)


def _fixture_body() -> dict[str, object]:
    path = Path(__file__).parent / "fixtures" / "yahoo_vti_sample.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_fetch_history_maps_fields() -> None:
    """レコード数・close/adjclose・配当 distribution がレスポンス通りになる。"""
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json=_fixture_body())

    provider = _provider(httpx.Client(transport=httpx.MockTransport(handler)))
    records = provider.fetch_history("us_equity")

    # close=None の非営業日 1 件を含む 4 件
    assert len(records) == 4
    # 非営業日：close が None でも日付レコードとして保持される
    non_trading = records[1]
    assert non_trading.raw_close is None
    assert non_trading.adjusted_close is None
    assert non_trading.distribution == 0.0

    # 配当日（3番目 の timestamp）に amount が入る
    div_holder = records[2]
    assert div_holder.distribution == 0.82

    # close/adjclose のマッピング
    assert records[0].raw_close == 258.11
    assert records[0].adjusted_close == 260.42

    # メタ情報
    assert records[0].currency == "USD"
    assert records[0].source == "yahoo"
    assert records[0].source_symbol == "VTI"
    assert records[0].timezone == "America/New_York"
    assert records[0].calendar == "us"
    assert records[0].source_request_hash  # レスポンス本文から計算される
    now = datetime.now(UTC)
    assert records[0].retrieved_at is not None
    assert (now - records[0].retrieved_at).total_seconds() < 60  # type: ignore[operator]

    # URL に VTI と range=max が含まれる（start/end 未指定）
    assert calls[0].url.path == "/v8/finance/chart/VTI"


def test_fetch_history_with_dates_sets_period() -> None:
    """start/end 指定時は period1/period2 の unix 秒が URL に入る。"""
    seen: dict[str, str | int] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.url.params)
        return httpx.Response(200, json=_fixture_body())

    provider = _provider(httpx.Client(transport=httpx.MockTransport(handler)))
    start = datetime(2024, 1, 1, tzinfo=UTC).date()
    end = datetime(2024, 1, 31, tzinfo=UTC).date()
    provider.fetch_history("us_equity", start=start, end=end)

    assert "period1" in seen
    assert "period2" in seen
    assert "range" not in seen
    assert int(seen["period1"]) == int(start.strftime("%s"))
    assert int(seen["period2"]) == int(end.strftime("%s"))


def test_default_ua_and_chart_url() -> None:
    """ブラウザ UA と query2 chart URL が定数として定義されている。"""
    assert CHART_URL.startswith("https://query2.finance.yahoo.com/v8/finance/chart/")
    assert "Chrome" in DEFAULT_UA


def test_chart_error_raises_provider_error() -> None:
    """chart.error がある場合に ProviderDataError を投げる。"""
    body = {"chart": {"error": {"code": "Not Found"}}}

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json=body)

    provider = _provider(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ProviderDataError):
        provider.fetch_history("us_equity")


def test_http_error_raises_provider_error() -> None:
    """HTTP エラー（例: 429）は ProviderDataError に変換される。"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, text="rate limited")

    provider = _provider(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ProviderDataError):
        provider.fetch_history("us_equity")


def test_unknown_asset_raises() -> None:
    """未登録の asset_id は ProviderDataError。"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_fixture_body())

    provider = _provider(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ProviderDataError):
        provider.fetch_history("unknown")
