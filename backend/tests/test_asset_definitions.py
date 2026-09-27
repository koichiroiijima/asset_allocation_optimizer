"""資産マッピング定義（assets.default.json / assets.jp.json）のテスト。"""

from pathlib import Path

from app.config import load_asset_mapping
from app.config.assets import AssetDefinition
from app.domain.assets import DEFAULT_ASSET_IDS, JP_ASSET_IDS


def _mapping(path: Path) -> list[AssetDefinition]:
    return load_asset_mapping(path)


def test_us_mapping_has_four_assets(asset_mapping_file: Path) -> None:
    """米国マッピングはちょうど4資産を持つ。"""
    mapping = _mapping(asset_mapping_file)
    logical = {item.logical_asset for item in mapping}
    assert logical == set(DEFAULT_ASSET_IDS)
    assert {item.asset_set for item in mapping} == {"us"}


def test_jp_mapping_has_four_assets(asset_mapping_file_jp: Path) -> None:
    """日本マッピングはちょうど4資産（すべて jp・JPY）を持つ。"""
    mapping = _mapping(asset_mapping_file_jp)
    logical = {item.logical_asset for item in mapping}
    assert logical == set(JP_ASSET_IDS)
    assert {item.asset_set for item in mapping} == {"jp"}
    assert {item.currency for item in mapping} == {"JPY"}


def test_all_assets_have_ticker_and_currency(asset_mapping_file: Path) -> None:
    """各資産は既定ティッカーと3文字通貨を持つ。"""
    for item in _mapping(asset_mapping_file):
        assert item.default_ticker.strip(), item.logical_asset
        assert len(item.currency) == 3


def test_asset_ids_unique(asset_mapping_file: Path) -> None:
    """logical_asset に重複が無い。"""
    mapping = _mapping(asset_mapping_file)
    ids = [item.logical_asset for item in mapping]
    assert len(ids) == len(set(ids))


def test_bond_assets_marked_as_bond(asset_mapping_file: Path) -> None:
    """米国モードの債券資産は asset_class=bond である。"""
    mapping = {item.logical_asset: item for item in _mapping(asset_mapping_file)}
    assert mapping["us_bond"].asset_class == "bond"
    assert mapping["ex_us_bond"].asset_class == "bond"
    assert mapping["us_equity"].asset_class == "equity"
    assert mapping["ex_us_equity"].asset_class == "equity"


def test_jp_bond_assets_marked_as_bond(asset_mapping_file_jp: Path) -> None:
    """日本モードの債券資産は asset_class=bond である。"""
    mapping = {item.logical_asset: item for item in _mapping(asset_mapping_file_jp)}
    assert mapping["jp_bond"].asset_class == "bond"
    assert mapping["ex_jp_bond"].asset_class == "bond"
    assert mapping["jp_equity"].asset_class == "equity"
    assert mapping["ex_jp_equity"].asset_class == "equity"
