"""データ系列（価格・リターン等）の API スキーマ。

CLAUDE.md の推奨データレコードのフィールドを反映した構造を定義する。
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

SeriesType = Literal["price", "adjusted_close", "return", "cumulative"]
Frequency = Literal["D", "W", "M", "Y"]


class SeriesSpec(BaseModel):
    """`GET /api/data/series` のクエリで指定する系列仕様。"""

    asset_id: str
    start: date | None = None
    end: date | None = None
    frequency: Frequency = "D"
    series_type: SeriesType = "adjusted_close"


class SeriesPoint(BaseModel):
    """単一の観測点。date は基準カレンダーの日付。"""

    date: date
    value: float


class SeriesResponse(BaseModel):
    """正規化済み系列のレスポンス。"""

    asset_id: str
    currency: str
    series_type: SeriesType
    points: list[SeriesPoint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


__all__ = ["SeriesPoint", "SeriesResponse", "SeriesSpec"]
