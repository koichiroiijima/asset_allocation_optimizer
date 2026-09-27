"""資産セット（米国モード / 日本モード）の論理名と既定値。

論理名はコード全体で一意に識別するキー。実際の商品（ETF/指数）への割当は設定ファイル
（`app/config/assets.default.json` = `us`、`app/config/assets.jp.json` = `jp`）で変更可能
（コードに固定しない）。

- `us` モード: 米国株式・米国債券・米国を除く株式・米国を除く債券（基準通貨 USD）
- `jp` モード: 日本株式・日本債券・日本を除く外国株式・日本を除く外国債券（基準通貨 JPY）
"""

from typing import Literal, cast

AssetSet = Literal["us", "jp"]

AssetId = Literal[
    "us_equity",
    "us_bond",
    "ex_us_equity",
    "ex_us_bond",
    "jp_equity",
    "jp_bond",
    "ex_jp_equity",
    "ex_jp_bond",
]

# 各モードの論理資産ID（順序は UI・API の既定順）。
US_ASSET_IDS: tuple[AssetId, ...] = (
    "us_equity",
    "us_bond",
    "ex_us_equity",
    "ex_us_bond",
)
JP_ASSET_IDS: tuple[AssetId, ...] = (
    "jp_equity",
    "jp_bond",
    "ex_jp_equity",
    "ex_jp_bond",
)

ASSET_IDS_BY_SET: dict[AssetSet, tuple[AssetId, ...]] = {
    "us": US_ASSET_IDS,
    "jp": JP_ASSET_IDS,
}

# 後方互換: 既定（米国）モードの4資産。
DEFAULT_ASSET_IDS: tuple[AssetId, ...] = US_ASSET_IDS

# 論理名 → 日本語表示名
ASSET_LABELS: dict[AssetId, str] = {
    "us_equity": "米国株式",
    "us_bond": "米国債券",
    "ex_us_equity": "米国を除く株式",
    "ex_us_bond": "米国を除く債券",
    "jp_equity": "日本株式",
    "jp_bond": "日本債券",
    "ex_jp_equity": "日本を除く外国株式",
    "ex_jp_bond": "日本を除く外国債券",
}

# 論理名 → 所属モード（asset_set）
ASSET_SET_BY_ID: dict[AssetId, AssetSet] = {
    **{asset_id: "us" for asset_id in US_ASSET_IDS},
    **{asset_id: "jp" for asset_id in JP_ASSET_IDS},
}

# モード → 基準通貨（ポートフォリオ評価の通貨）
ASSET_SET_BASE_CURRENCY: dict[AssetSet, str] = {
    "us": "USD",
    "jp": "JPY",
}


def is_valid_asset_id(value: str) -> bool:
    """指定の文字列が有効な論理資産IDかどうかを返す（両モード対象）。"""
    return value in ASSET_LABELS


def is_valid_asset_set(value: str) -> bool:
    """指定の文字列が有効な資産セット（モード）かどうかを返す。"""
    return value in ASSET_IDS_BY_SET


def asset_set_for_assets(asset_ids: list[str]) -> AssetSet | None:
    """資産ID群が同一モードに属するならそのモードを、混在・未知なら None を返す。"""
    sets = {ASSET_SET_BY_ID.get(cast(AssetId, asset_id)) for asset_id in asset_ids}
    sets.discard(None)
    if len(sets) == 1:
        return next(iter(sets))
    return None


def base_currency_for_assets(asset_ids: list[str]) -> str:
    """資産ID群の基準通貨を返す。混在・未知は米国モード（USD）へフォールバックする。"""
    asset_set = asset_set_for_assets(asset_ids)
    if asset_set is None:
        return ASSET_SET_BASE_CURRENCY["us"]
    return ASSET_SET_BASE_CURRENCY[asset_set]


__all__ = [
    "ASSET_IDS_BY_SET",
    "ASSET_LABELS",
    "ASSET_SET_BASE_CURRENCY",
    "ASSET_SET_BY_ID",
    "AssetId",
    "AssetSet",
    "DEFAULT_ASSET_IDS",
    "JP_ASSET_IDS",
    "US_ASSET_IDS",
    "asset_set_for_assets",
    "base_currency_for_assets",
    "is_valid_asset_id",
    "is_valid_asset_set",
]
