"""資産マッピング定義（assets.default.json）のテスト。"""

from pathlib import Path

from app.config import load_asset_mapping
from app.config.assets import AssetDefinition
from app.domain.assets import DEFAULT_ASSET_IDS


def _mapping(asset_mapping_file: Path) -> list[AssetDefinition]:
    return load_asset_mapping(asset_mapping_file)


def test_exactly_four_logical_assets(asset_mapping_file: Path) -> None:
    """既定マッピングはちょうど4資産を持つ。"""
    mapping = _mapping(asset_mapping_file)
    logical = {item.logical_asset for item in mapping}
    assert logical == set(DEFAULT_ASSET_IDS)


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
    """us_bond / ex_us_bond は asset_class=bond である。"""
    mapping = {item.logical_asset: item for item in _mapping(asset_mapping_file)}
    assert mapping["us_bond"].asset_class == "bond"
    assert mapping["ex_us_bond"].asset_class == "bond"
    assert mapping["us_equity"].asset_class == "equity"
    assert mapping["ex_us_equity"].asset_class == "equity"
