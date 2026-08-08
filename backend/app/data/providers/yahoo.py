"""Yahoo Finance chart API（query2 ホスト）による価格取得アダプター。

利用上の注意（実プローブで確認済み）:
- `query2.finance.yahoo.com` はブラウザ UA ヘッダ付きで 200 を返す（`query1` は 429）。
- `interval=1d&events=div` で日次終値・Adjusted Close・分配金（`events.dividends`）を取得できる。
- Yahoo の利用規約に従い、非商用・研究利用に限定する。取得間隔は控えめにし、再配布しない。

CLAUDE.md: 外部データは出所・取得日時・対象期間・タイムゾーン・通貨・データ種別・
欠損処理を記録する。
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import httpx

from app.schemas.dataseries import PriceRecord

CHART_URL = "https://query2.finance.yahoo.com/v8/finance/chart/{symbol}"
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
TIMEOUT_SECONDS = 30.0


class ProviderDataError(Exception):
    """価格取得に失敗したことを表すドメイン例外。"""


def _hash_text(text: str) -> str:
    """レスポンス本文から再現可能な内容ハッシュを計算する。"""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class YahooPriceProvider:
    """クエリ2ホストの chart API から価格系列を取得するプロバイダー。"""

    def __init__(
        self,
        symbols: Mapping[str, str],
        *,
        user_agent: str = DEFAULT_UA,
        client: httpx.Client | None = None,
    ) -> None:
        """`symbols` は asset_id→ticker の対応。

        テストでは `client` に MockTransport を注入してネットワークを避ける。
        """
        self._symbols = dict(symbols)
        if not self._symbols:
            raise ValueError("シンボル対応が空です")
        self._client = client or httpx.Client(
            headers={"User-Agent": user_agent},
            timeout=TIMEOUT_SECONDS,
        )
        self._owns_client = client is None

    @property
    def name(self) -> str:
        return "yahoo"

    def close(self) -> None:
        """自前で生成した httpx Client を閉じる。注入された client は閉じない。"""
        if self._owns_client:
            self._client.close()

    def _url_for(self, asset_id: str) -> str:
        try:
            symbol = self._symbols[asset_id]
        except KeyError as exc:
            raise ProviderDataError(f"未登録の資産IDです: {asset_id}") from exc
        return CHART_URL.format(symbol=symbol)

    def _request(self, asset_id: str, start: date | None, end: date | None) -> httpx.Response:
        params: dict[str, str | int] = {"interval": "1d", "events": "div"}
        if start is None and end is None:
            params["range"] = "max"
        else:
            if start is not None:
                params["period1"] = int(start.strftime("%s"))
            if end is not None:
                params["period2"] = int(end.strftime("%s"))
        return self._client.get(self._url_for(asset_id), params=params)

    def fetch_history(
        self, asset_id: str, start: date | None = None, end: date | None = None
    ) -> list[PriceRecord]:
        response = self._request(asset_id, start, end)
        try:
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            raise ProviderDataError(
                f"Yahoo取得失敗 {asset_id}: HTTP {response.status_code}"
            ) from exc
        except ValueError as exc:
            raise ProviderDataError(f"Yahoo応答が JSON でない: {asset_id}") from exc

        chart = payload.get("chart") or {}
        if chart.get("error"):
            raise ProviderDataError(f"Yahoo API error: {chart['error']}")
        result = (chart.get("result") or [])
        if not result:
            raise ProviderDataError(f"Yahoo応答に result が無い: {asset_id}")
        block = result[0]

        meta = block.get("meta") or {}
        timestamps: list[int] = list(block.get("timestamp") or [])
        quote = ((block.get("indicators") or {}).get("quote") or [{}])[0]
        closes: list[float | None] = list(quote.get("close") or [])
        adj_blocks = (block.get("indicators") or {}).get("adjclose") or [{}]
        adjcloses: list[float | None] = list(adj_blocks[0].get("adjclose") or [])
        dividends: dict[str, dict[str, object]] = (
            (block.get("events") or {}).get("dividends") or {}
        )

        currency = str(meta.get("currency") or "USD")
        tz_name = meta.get("exchangeTimezoneName")
        try:
            tz = ZoneInfo(str(tz_name)) if tz_name else UTC
        except Exception:
            tz = UTC
        source_symbol = str(meta.get("symbol") or self._symbols[asset_id])
        now = datetime.now(UTC)
        request_hash = _hash_text(response.text)

        records: list[PriceRecord] = []
        for i, ts in enumerate(timestamps):
            close_val = closes[i] if i < len(closes) else None
            adj_val = adjcloses[i] if i < len(adjcloses) else None
            div = dividends.get(str(ts))
            distribution = 0.0
            if div:
                amount = div.get("amount")
                if isinstance(amount, (int, float)):
                    distribution = float(amount)
            exchange_day = datetime.fromtimestamp(ts, tz=tz).date()
            records.append(
                PriceRecord(
                    date=exchange_day,
                    asset_id=asset_id,
                    raw_close=float(close_val) if close_val is not None else None,
                    adjusted_close=float(adj_val) if adj_val is not None else None,
                    distribution=distribution,
                    currency=currency,
                    source=self.name,
                    source_symbol=source_symbol,
                    price_type="adjusted_close",
                    retrieved_at=now,
                    timezone=str(tz_name) if tz_name else "UTC",
                    calendar="us",
                    available_at=now,
                    source_request_hash=request_hash,
                )
            )
        return records

    def get_available_history(self, asset_id: str) -> tuple[date, date] | None:
        response = self._request(asset_id, None, None)
        try:
            response.raise_for_status()
            payload = response.json()
        except (httpx.HTTPStatusError, ValueError):
            return None
        chart = payload.get("chart") or {}
        result = (chart.get("result") or [])
        if not result:
            return None
        meta = result[0].get("meta") or {}
        first = meta.get("firstTradeDate")
        last = meta.get("regularMarketTime")
        if not first or not last:
            return None
        try:
            return (
                datetime.fromtimestamp(int(first), tz=UTC).date(),
                datetime.fromtimestamp(int(last), tz=UTC).date(),
            )
        except (ValueError, OSError, OverflowError):
            return None


__all__ = ["CHART_URL", "DEFAULT_UA", "ProviderDataError", "YahooPriceProvider"]
