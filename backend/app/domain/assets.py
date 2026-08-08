"""4資産の論理名と既定値。

論理名はコード全体で一意に識別するキー。実際の商品（ETF/指数）への割当は設定ファイル
`app/config/assets.default.json` で変更可能（コードに固定しない）。
"""

from typing import Literal

AssetId = Literal["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"]

DEFAULT_ASSET_IDS: tuple[AssetId, ...] = (
    "us_equity",
    "us_bond",
    "ex_us_equity",
    "ex_us_bond",
)

# 論理名 → 日本語表示名
ASSET_LABELS: dict[AssetId, str] = {
    "us_equity": "米国株式",
    "us_bond": "米国債券",
    "ex_us_equity": "米国を除く株式",
    "ex_us_bond": "米国を除く債券",
}


def is_valid_asset_id(value: str) -> bool:
    """指定の文字列が有効な論理資産IDかどうかを返す。"""
    return value in ASSET_LABELS


__all__ = [
    "ASSET_LABELS",
    "AssetId",
    "DEFAULT_ASSET_IDS",
    "is_valid_asset_id",
]
