"""`GET /api/assets` のデータ状態合成テスト。

保存済み資産は available=true で期間・欠損・出所・取得日時・snapshot_hash を、
未保存資産は available=false を返すことを検証する。
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from fastapi.testclient import TestClient


def _save_example(repo: ParquetPriceRepository) -> None:
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-02", "2024-01-03"]),
            "asset_id": ["us_equity", "us_equity"],
            "raw_close": [100.0, 101.0],
            "adjusted_close": [100.0, np.nan],
            "distribution": [0.0, 0.0],
            "currency": ["USD"] * 2,
            "source": ["yahoo", "yahoo"],
            "source_symbol": ["VTI"] * 2,
            "price_type": ["adjusted_close"] * 2,
        }
    )
    repo.save_series("us_equity", df)


def test_assets_with_data_status(
    client: TestClient, tmp_settings: Settings
) -> None:
    """保存済み資産は available=true で期間・欠損・出所・hash を返す。"""
    repo = ParquetPriceRepository(tmp_settings.processed_dir)
    _save_example(repo)
    manifest = repo.read_manifest("us_equity")["snapshot_hash"]

    resp = client.get("/api/assets")
    assert resp.status_code == 200
    assets = resp.json()["assets"]

    # 4 資産は定義どおり返る
    assert {a["logical_asset"] for a in assets} == {
        "us_equity",
        "us_bond",
        "ex_us_equity",
        "ex_us_bond",
    }

    saved = next(a for a in assets if a["logical_asset"] == "us_equity")
    assert saved["data_status"] is not None
    ds = saved["data_status"]
    assert ds["available"] is True
    assert ds["start"] == "2024-01-02"
    assert ds["end"] == "2024-01-03"
    assert ds["rows"] == 2
    assert ds["missing"] == 1  # adjusted_close の NaN
    assert ds["source"] == "yahoo"
    assert ds["snapshot_hash"] == manifest

    unsaved = next(a for a in assets if a["logical_asset"] == "us_bond")
    assert unsaved["data_status"]["available"] is False


def test_assets_static_fields_present(
    client: TestClient, tmp_settings: Settings
) -> None:
    """静的な資産定義フィールド（表示名・ティッカー等）が返る。"""
    resp = client.get("/api/assets")
    assert resp.status_code == 200
    assets = resp.json()["assets"]
    us_equity = next(a for a in assets if a["logical_asset"] == "us_equity")
    assert us_equity["display_name"]
    assert us_equity["default_ticker"] == "VTI"
    assert us_equity["currency"] == "USD"
