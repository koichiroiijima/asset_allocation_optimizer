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


def test_assets_with_data_status(client: TestClient, tmp_settings: Settings) -> None:
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


def test_assets_static_fields_present(client: TestClient, tmp_settings: Settings) -> None:
    """静的な資産定義フィールド（表示名・ティッカー等）が返る。"""
    resp = client.get("/api/assets")
    assert resp.status_code == 200
    assets = resp.json()["assets"]
    us_equity = next(a for a in assets if a["logical_asset"] == "us_equity")
    assert us_equity["display_name"]
    assert us_equity["default_ticker"] == "VTI"
    assert us_equity["currency"] == "USD"
    assert us_equity["asset_set"] == "us"


def test_assets_jp_set(client: TestClient) -> None:
    """set=jp で日本モードの4資産（JPY）が返る。"""
    resp = client.get("/api/assets", params={"set": "jp"})
    assert resp.status_code == 200
    assets = resp.json()["assets"]
    assert {a["logical_asset"] for a in assets} == {
        "jp_equity",
        "jp_bond",
        "ex_jp_equity",
        "ex_jp_bond",
    }
    assert {a["asset_set"] for a in assets} == {"jp"}
    assert {a["currency"] for a in assets} == {"JPY"}
    jp_equity = next(a for a in assets if a["logical_asset"] == "jp_equity")
    assert jp_equity["default_ticker"] == "1306.T"


def test_assets_unknown_set_returns_400(client: TestClient) -> None:
    """未知の set は 400（日本語）を返す。"""
    resp = client.get("/api/assets", params={"set": "eu"})
    assert resp.status_code == 400
    assert "未知の資産セット" in resp.json()["detail"]


def test_assets_jp_data_status(client: TestClient, tmp_settings: Settings) -> None:
    """set=jp でも processed データ状態が合成される。"""
    repo = ParquetPriceRepository(tmp_settings.processed_dir)
    repo.save_series(
        "jp_equity",
        pd.DataFrame(
            {
                "date": pd.to_datetime(["2024-01-02", "2024-01-03"]),
                "asset_id": ["jp_equity", "jp_equity"],
                "raw_close": [292.45, 293.1],
                "adjusted_close": [280.15, np.nan],
                "distribution": [0.0, 0.0],
                "currency": ["JPY"] * 2,
                "source": ["yahoo", "yahoo"],
                "source_symbol": ["1306.T"] * 2,
                "price_type": ["adjusted_close"] * 2,
            }
        ),
    )
    resp = client.get("/api/assets", params={"set": "jp"})
    saved = next(a for a in resp.json()["assets"] if a["logical_asset"] == "jp_equity")
    assert saved["data_status"]["available"] is True
    assert saved["data_status"]["missing"] == 1
    assert saved["data_status"]["end"] == "2024-01-03"
