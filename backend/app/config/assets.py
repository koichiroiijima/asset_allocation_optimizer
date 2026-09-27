"""資産マッピング設定の読み込み。

`assets.default.json`（米国モード `us`）と `assets.jp.json`（日本モード `jp`）を読んで
`AssetDefinition` のリストへ変換する。これら JSON はコミット対象の初期設定で、実際の
商品・ユーザー環境に応じて差し替える。
"""

import json
from datetime import date
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.domain.assets import AssetId, AssetSet

AssetClass = Literal["equity", "bond"]
DividendPolicy = Literal["reinvest", "cash"]


class AssetDefinition(BaseModel):
    """論理資産と実商品（ETF/指数）の対応定義。"""

    model_config = ConfigDict(from_attributes=True)

    logical_asset: AssetId
    asset_set: AssetSet
    display_name: str
    default_ticker: str = Field(min_length=1)
    underlying: str | None = None
    asset_class: AssetClass
    currency: str = Field(pattern="^[A-Z]{3}$")
    duration: str | None = None
    credit_risk: str | None = None
    fx_hedged: bool = False
    dividend_policy: DividendPolicy = "reinvest"
    history_start: date | None = None
    note: str = ""


def load_asset_mapping(path: Path) -> list[AssetDefinition]:
    """JSON マッピングファイルを読み、AssetDefinition のリストに変換する。

    ファイルが存在しない／壊れている場合は ValueError を投げる（握りつぶさない）。
    """
    with path.open("r", encoding="utf-8") as fh:
        raw: list[dict[str, Any]] = json.load(fh)
    return [AssetDefinition.model_validate(item) for item in raw]


__all__ = ["AssetDefinition", "load_asset_mapping"]
