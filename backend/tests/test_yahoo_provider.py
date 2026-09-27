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
    _calendar_for,
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

    # URL に VTI と period1（start/end 未指定でも日足を得るための起点）が含まれる
    assert calls[0].url.path == "/v8/finance/chart/VTI"
    assert calls[0].url.params.get("period1") is not None
    assert "range" not in calls[0].url.params


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


def test_fetch_history_without_dates_uses_early_period1() -> None:
    """start/end 未指定（全履歴）でも range=max を使わず、十分過去の period1 を付けて日足を得る。

    `period1` だけだと Yahoo が endDate=-1 として 400 を返すため、`period2`（現在）も必ず付与する。
    """
    seen: dict[str, str | int] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(request.url.params)
        return httpx.Response(200, json=_fixture_body())

    provider = _provider(httpx.Client(transport=httpx.MockTransport(handler)))
    provider.fetch_history("us_equity")

    assert "period1" in seen
    assert "period2" in seen
    assert "range" not in seen
    # Yahoo が月足にダウンサンプリングしないよう、2000-01-01 起点の日足を要求する
    assert int(seen["period1"]) == int(datetime(2000, 1, 1, tzinfo=UTC).strftime("%s"))


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


def _jp_fixture_body() -> dict[str, object]:
    path = Path(__file__).parent / "fixtures" / "yahoo_jp_sample.json"
    return json.loads(path.read_text(encoding="utf-8"))


def test_jp_symbol_maps_currency_timezone_calendar_and_adjusted_close() -> None:
    """東京銘柄は通貨 JPY・カレンダー jp で、分配金補正済み adjclose を保持する。"""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_jp_fixture_body())

    provider = YahooPriceProvider(
        {"jp_equity": "1306.T"},
        client=httpx.Client(transport=httpx.MockTransport(handler)),
    )
    records = provider.fetch_history("jp_equity")

    assert len(records) == 4
    first = records[0]
    assert first.currency == "JPY"
    assert first.timezone == "Asia/Tokyo"
    assert first.calendar == "jp"
    # 分配金補正付き Adjusted Close が close を下回る（補正が効いている）
    assert first.raw_close == 292.45
    assert first.adjusted_close == 280.15
    assert first.adjusted_close < first.raw_close
    # 配当イベントが distribution に入る
    assert records[2].distribution == 5.79


@pytest.mark.parametrize(
    ("currency", "timezone_name", "symbol", "expected"),
    [
        ("JPY", "Asia/Tokyo", "1306.T", "jp"),
        ("JPY", None, "1306.T", "jp"),  # 通貨 JPY のみ
        ("USD", "Asia/Tokyo", "9999", "jp"),  # タイムゾーンが Tokyo
        ("USD", "America/New_York", "1306.T", "jp"),  # シンボル末尾 .T
        ("USD", "America/New_York", "VTI", "us"),
        ("USD", None, "AGG", "us"),  # 不明は us へフォールバック
    ],
)
def test_calendar_for(
    currency: str, timezone_name: str | None, symbol: str, expected: str
) -> None:
    """カレンダー判定: 東京の手掛かりがあれば jp、なければ us。"""
    assert _calendar_for(currency, timezone_name, symbol) == expected
