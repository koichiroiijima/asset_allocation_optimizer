"""ドメイン層の資産セット／基準通貨ヘルパーのテスト。

`app/domain/assets.py` の純粋関数を対象に、モード判定・基準通貨の導出・
ID検証を正常系・境界・異常系で検証する。HTTP・DB には依存しない。
"""

from __future__ import annotations

import pytest
from app.domain.assets import (
    ASSET_IDS_BY_SET,
    ASSET_LABELS,
    ASSET_SET_BASE_CURRENCY,
    ASSET_SET_BY_ID,
    DEFAULT_ASSET_IDS,
    JP_ASSET_IDS,
    US_ASSET_IDS,
    asset_set_for_assets,
    base_currency_for_assets,
    is_valid_asset_id,
    is_valid_asset_set,
)


def test_asset_ids_by_set_are_disjoint_and_complete() -> None:
    """us と jp の資産IDは重複せず、全体で8資産になる。"""
    assert set(US_ASSET_IDS).isdisjoint(JP_ASSET_IDS)
    assert set(ASSET_SET_BY_ID) == set(US_ASSET_IDS) | set(JP_ASSET_IDS)
    assert len(ASSET_SET_BY_ID) == 8
    assert set(ASSET_LABELS) == set(ASSET_SET_BY_ID)


def test_default_asset_ids_is_us_for_backward_compat() -> None:
    """後方互換の DEFAULT_ASSET_IDS は米国モードを指す。"""
    assert DEFAULT_ASSET_IDS == US_ASSET_IDS


def test_asset_set_base_currency() -> None:
    """基準通貨は us=USD / jp=JPY。"""
    assert ASSET_SET_BASE_CURRENCY == {"us": "USD", "jp": "JPY"}


@pytest.mark.parametrize(
    ("asset_ids", "expected"),
    [
        (["us_equity", "us_bond"], "us"),
        (["jp_equity", "jp_bond", "ex_jp_equity"], "jp"),
        (["us_equity", "jp_equity"], None),  # 混在
        (["unknown"], None),  # 未知
        ([], None),  # 空
    ],
)
def test_asset_set_for_assets(asset_ids: list[str], expected: str | None) -> None:
    """同一モードならそのモード、混在・未知・空は None。"""
    assert asset_set_for_assets(asset_ids) == expected


@pytest.mark.parametrize(
    ("asset_ids", "expected"),
    [
        (["us_equity"], "USD"),
        (["jp_bond", "ex_jp_bond"], "JPY"),
        (["us_equity", "jp_equity"], "USD"),  # 混在は us へフォールバック
        (["unknown"], "USD"),  # 未知は us へフォールバック
        ([], "USD"),  # 空は us へフォールバック
    ],
)
def test_base_currency_for_assets(asset_ids: list[str], expected: str) -> None:
    """基準通貨を導出する。混在・未知・空は USD（米国モード）へフォールバック。"""
    assert base_currency_for_assets(asset_ids) == expected


def test_is_valid_asset_id_covers_both_sets() -> None:
    """8資産すべてが有効、未知・空文字は無効。"""
    for asset_id in ASSET_SET_BY_ID:
        assert is_valid_asset_id(asset_id)
    assert not is_valid_asset_id("nope")
    assert not is_valid_asset_id("")
    assert not is_valid_asset_id("US_EQUITY")  # 大文字は無効


def test_is_valid_asset_set() -> None:
    """us / jp は有効、その他は無効。"""
    assert is_valid_asset_set("us")
    assert is_valid_asset_set("jp")
    assert not is_valid_asset_set("eu")
    assert not is_valid_asset_set("")


def test_asset_ids_by_set_matches_literals() -> None:
    """ASSET_IDS_BY_SET の各モードは4資産で、順序は固定（UI/API の既定順）。"""
    assert len(ASSET_IDS_BY_SET["us"]) == 4
    assert len(ASSET_IDS_BY_SET["jp"]) == 4
    assert ASSET_IDS_BY_SET["jp"] == JP_ASSET_IDS
