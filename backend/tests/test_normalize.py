"""normalize_prices のテスト。"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest
from app.data.normalize import normalize_prices
from app.data.repository import SERIES_COLUMNS


def _frame(**overrides: object) -> pd.DataFrame:
    data: dict[str, object] = {
        "date": pd.to_datetime(["2024-01-03", "2024-01-02", "2024-01-02"]),
        "asset_id": ["us_equity", "us_equity", "us_equity"],
        "raw_close": [101.0, 100.0, 99.0],
        "adjusted_close": [102.0, 101.0, 100.0],
        "distribution": [0.0, 0.5, 0.4],
    }
    data.update(overrides)
    return pd.DataFrame(data)


def test_sorts_dedups_and_orders_columns() -> None:
    """未ソート・重複日付 → 昇順ソート・keep=last・SERIES_COLUMNS 順。"""
    out = normalize_prices(_frame())
    assert out["date"].is_monotonic_increasing
    assert len(out) == 2
    # 2024-01-02 は最後の行（raw_close=99.0）が残る
    row = out[out["date"] == pd.Timestamp("2024-01-02")].iloc[0]
    assert row["raw_close"] == 99.0
    assert row["distribution"] == 0.4
    assert list(out.columns) == SERIES_COLUMNS


def test_drops_all_nan_rows() -> None:
    """raw_close と adjusted_close が両方 NaN の行は除去される。"""
    frame = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-02", "2024-01-03"]),
            "asset_id": ["us_equity", "us_equity"],
            "raw_close": [100.0, None],
            "adjusted_close": [101.0, None],
            "distribution": [0.0, 0.0],
        }
    )
    out = normalize_prices(frame)
    assert len(out) == 1
    assert out["date"].astype(str).iloc[0] == "2024-01-02"


def test_unknown_columns_dropped_defaults_filled() -> None:
    """未知列は捨てられ、欠損の distribution は 0.0 に補完される。"""
    frame = _frame()
    frame["extra"] = "x"
    frame["distribution"] = [None, None, None]
    out = normalize_prices(frame)
    assert "extra" not in out.columns
    assert out["distribution"].tolist() == [0.0, 0.0]
    assert out["price_type"].tolist() == ["adjusted_close", "adjusted_close"]


def test_empty_input_raises() -> None:
    """空入力は ValueError。"""
    with pytest.raises(ValueError):
        normalize_prices(pd.DataFrame())


def test_missing_required_columns_raises() -> None:
    """date / asset_id 欠落は ValueError。"""
    with pytest.raises(ValueError):
        normalize_prices(pd.DataFrame({"raw_close": [1.0]}))


def test_all_rows_removed_raises() -> None:
    """価格列が存在するのに全行が空（＝全行除去）の場合も ValueError。"""
    frame = pd.DataFrame(
        {
            "date": [date(2024, 1, 2)],
            "asset_id": ["us_equity"],
            "raw_close": [None],
            "adjusted_close": [None],
        }
    )
    with pytest.raises(ValueError):
        normalize_prices(frame)
