"""`GET /api/data/series` の配線テスト。

processed Parquet を repo で保存した後にエンドポイントを呼び、
点の date/value、NaN 除外、未取得資産の警告・空系列を検証する。
実データ・ネットワークは使わない。
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from fastapi.testclient import TestClient


def _save_example(repo: ParquetPriceRepository) -> None:
    """2024-01-02〜07 の価格を保存。adjusted_close に途中 NaN を 1 つ含む。"""
    df = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]),
            "asset_id": ["us_equity"] * 4,
            "raw_close": [100.0, 110.0, 105.0, 118.5],
            "adjusted_close": [100.0, 110.0, np.nan, 118.5],
            "distribution": [0.0, 0.0, 0.0, 0.0],
            "currency": ["USD"] * 4,
            "source": ["yahoo"] * 4,
            "source_symbol": ["VTI"] * 4,
            "price_type": ["adjusted_close"] * 4,
        }
    )
    repo.save_series("us_equity", df)


def test_series_adjusted_close_points(client: TestClient, tmp_settings: Settings) -> None:
    """adjusted_close（既定）は欠損でない点のみ返り、NaN は除外される。"""
    _save_example(ParquetPriceRepository(tmp_settings.processed_dir))
    resp = client.get("/api/data/series", params={"asset_id": "us_equity"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["asset_id"] == "us_equity"
    assert body["series_type"] == "adjusted_close"
    assert body["currency"] == tmp_settings.portfolio_base_currency

    points = body["points"]
    # 01-03 の adjusted_close は NaN なので除外される
    assert points == [
        {"date": "2024-01-02", "value": 100.0},
        {"date": "2024-01-03", "value": 110.0},
        {"date": "2024-01-05", "value": 118.5},
    ]


def test_series_price_uses_raw_close(client: TestClient, tmp_settings: Settings) -> None:
    """'price' は raw_close を使う（adjusted_close の NaN は影響しない）。"""
    _save_example(ParquetPriceRepository(tmp_settings.processed_dir))
    resp = client.get(
        "/api/data/series",
        params={"asset_id": "us_equity", "series_type": "price"},
    )
    assert resp.status_code == 200
    points = resp.json()["points"]
    assert [p["value"] for p in points] == [100.0, 110.0, 105.0, 118.5]


def test_series_return_and_cumulative(client: TestClient, tmp_settings: Settings) -> None:
    """'return' は単純リターン、'cumulative' は累積リターン（NaN 先頭は除外）。"""
    _save_example(ParquetPriceRepository(tmp_settings.processed_dir))
    ret = client.get(
        "/api/data/series",
        params={"asset_id": "us_equity", "series_type": "return"},
    ).json()["points"]
    # adjusted(100,110,NaN,118.5): simple_return → [NaN, 0.10, NaN, NaN]
    assert ret[0]["date"] == "2024-01-03"
    assert abs(ret[0]["value"] - 0.1) < 1e-9

    cum = client.get(
        "/api/data/series",
        params={"asset_id": "us_equity", "series_type": "cumulative"},
    ).json()["points"]
    # 累積: 基点0.0(01-02)、0.10(01-03)。01-04 の NaN 以後は NaN として伝播・除外される。
    assert cum[0]["date"] == "2024-01-02"
    assert cum[0]["value"] == 0.0
    assert cum[-1]["date"] == "2024-01-03"
    assert abs(cum[-1]["value"] - 0.1) < 1e-9
    assert len(cum) == 2


def test_series_frequency_resampling(client: TestClient, tmp_settings: Settings) -> None:
    """frequency='M' で価格は最終観測値、リターンは複利合成される。"""
    _save_example(ParquetPriceRepository(tmp_settings.processed_dir))
    # 月末集約：全点同月なので最終観測日 01-05 に最終観測価格 118.5
    prices = client.get(
        "/api/data/series",
        params={"asset_id": "us_equity", "frequency": "M"},
    ).json()["points"]
    assert prices == [{"date": "2024-01-05", "value": 118.5}]


def test_series_missing_data_returns_warning_and_empty(
    client: TestClient, tmp_settings: Settings
) -> None:
    """未取得資産は空 series と日本語警告を返す（例外にしない）。"""
    resp = client.get("/api/data/series", params={"asset_id": "us_bond"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["points"] == []
    assert any("未取得" in w for w in body["warnings"])


def test_series_filters_by_date_range(client: TestClient, tmp_settings: Settings) -> None:
    """start/end で期間を絞る。"""
    _save_example(ParquetPriceRepository(tmp_settings.processed_dir))
    resp = client.get(
        "/api/data/series",
        params={
            "asset_id": "us_equity",
            "start": date(2024, 1, 3),
            "end": date(2024, 1, 4),
        },
    )
    assert resp.status_code == 200
    dates = [p["date"] for p in resp.json()["points"]]
    # 01-04 は adjusted_close が NaN のため除外され、01-03 のみ
    assert dates == ["2024-01-03"]
