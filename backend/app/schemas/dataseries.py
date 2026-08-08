"""データレコード（Parquet の 1 行）のスキーマ。

CLAUDE.md の「推奨データレコード」のフィールドをそのまま型化したもの。
raw（取得直後）と processed（正規化済み）の両方で使う。
"""

from datetime import date, datetime

from pydantic import BaseModel


class PriceRecord(BaseModel):
    """価格1行分の正規化済みレコード。"""

    date: date
    asset_id: str
    raw_close: float | None = None
    adjusted_close: float | None = None
    distribution: float | None = None
    currency: str = "USD"
    source: str = "local"
    source_symbol: str | None = None
    price_type: str = "adjusted_close"
    retrieved_at: datetime | None = None
    timezone: str | None = None
    calendar: str | None = None
    available_at: datetime | None = None
    source_request_hash: str | None = None
    raw_snapshot_hash: str | None = None
    processed_snapshot_hash: str | None = None


__all__ = ["PriceRecord"]
