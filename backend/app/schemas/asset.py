"""資産定義の API スキーマ。"""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.config.assets import AssetDefinition

LogicalAsset = Literal["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"]


class Asset(AssetDefinition):
    """`GET /api/assets` が返す資産定義。設定ファイルの AssetDefinition をそのまま公開。"""

    model_config = ConfigDict(from_attributes=True)


class AssetDataStatus(BaseModel):
    """論理資産に対応する processed データの要約状態。

    データ画面の一覧（出所・期間・欠損・取得日時・価格種別）を賄う。
    値は推測せず、実データの要約と、取得できなければ `available=False` で明示する。
    """

    logical_asset: LogicalAsset
    available: bool = False
    start: date | None = None
    end: date | None = None
    rows: int = 0
    missing: int = 0  # adjusted_close の NaN 行数
    source: str | None = None
    price_type: str | None = None
    retrieved_at: datetime | None = None
    snapshot_hash: str | None = None


class AssetWithStatus(Asset):
    """資産定義に processed データ状態を合成したレスポンス用モデル。"""

    data_status: AssetDataStatus | None = Field(default=None)


class AssetListResponse(BaseModel):
    """資産一覧レスポンス。"""

    assets: list[AssetWithStatus] = Field(default_factory=list)


__all__ = ["Asset", "AssetDataStatus", "AssetListResponse", "AssetWithStatus"]
