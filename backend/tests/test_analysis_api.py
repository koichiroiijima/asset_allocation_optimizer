"""`GET /api/data/analysis` の配線テスト。

2〜3資産の processed Parquet を repo で保存した後にエンドポイントを呼び、
価格・累積・ローリングボラ・相関・未取得資産の日本語警告・単一資産時の警告を検証する。
実データ・ネットワークは使わない。
"""

from __future__ import annotations

from datetime import date

import pandas as pd
import pytest
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from fastapi.testclient import TestClient


def _save_two_assets(repo: ParquetPriceRepository) -> None:
    """2資産（us_equity / us_bond）の2024年1月の価格を保存。

    us_equity の adjusted_close には観測は全部あって、us_bond は観測日が一部ずれる
    （外側 union の NaN を検証しやすくする）。両方とも上昇トレンドで正相関を仮定。
    """
    equity = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]),
            "asset_id": ["us_equity"] * 4,
            "raw_close": [100.0, 101.0, 102.0, 103.0],
            "adjusted_close": [100.0, 101.0, 102.0, 103.0],
            "distribution": [0.0] * 4,
            "currency": ["USD"] * 4,
            "source": ["yahoo"] * 4,
            "source_symbol": ["VTI"] * 4,
            "price_type": ["adjusted_close"] * 4,
        }
    )
    bond = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-05", "2024-01-08"]),
            "asset_id": ["us_bond"] * 4,
            "raw_close": [100.0, 100.5, 101.0, 101.5],
            "adjusted_close": [100.0, 100.5, 101.0, 101.5],
            "distribution": [0.0] * 4,
            "currency": ["USD"] * 4,
            "source": ["yahoo"] * 4,
            "source_symbol": ["BND"] * 4,
            "price_type": ["adjusted_close"] * 4,
        }
    )
    repo.save_series("us_equity", equity)
    repo.save_series("us_bond", bond)


def _analysis_params(**overrides: object) -> dict[str, object]:
    params: dict[str, object] = {
        "asset_ids": ["us_equity", "us_bond"],
    }
    params.update(overrides)
    return params


def test_analysis_returns_assets_and_points(client: TestClient, tmp_settings: Settings) -> None:
    """価格・累積・ローリングボラの系列と、資産一覧・通貨・窓が返る。"""
    _save_two_assets(ParquetPriceRepository(tmp_settings.processed_dir))
    resp = client.get("/api/data/analysis", params=_analysis_params())
    assert resp.status_code == 200
    body = resp.json()

    assert body["currency"] == tmp_settings.instrument_trading_currency
    assert body["assets_used"] == ["us_equity", "us_bond"]
    assert body["window"] == 60

    # 価格: us_equity は4点、us_bond は4点（観測日順）
    equity_prices = body["prices"][0]
    assert equity_prices["asset_id"] == "us_equity"
    assert [p["date"] for p in equity_prices["points"]] == [
        "2024-01-02",
        "2024-01-03",
        "2024-01-04",
        "2024-01-05",
    ]
    assert [p["value"] for p in equity_prices["points"]] == [100.0, 101.0, 102.0, 103.0]

    # 累積リターン: adjusted_close で単純リターン → 累積、基点 0.0
    equity_cum = body["cumulative"][0]
    assert equity_cum["points"][0]["value"] == 0.0
    assert equity_cum["points"][-1]["value"] == pytest.approx(
        (103.0 / 100.0) - 1.0, abs=1e-9
    )

    # ローリングボラ: window=60 では観測が足りず全 NaN → points は空
    for asset in body["rolling_volatility"]:
        assert asset["points"] == []


def test_analysis_correlation_two_assets(client: TestClient, tmp_settings: Settings) -> None:
    """2資産なら相関行列は 2x2・対称・対角 1.0。"""
    _save_two_assets(ParquetPriceRepository(tmp_settings.processed_dir))
    body = client.get("/api/data/analysis", params=_analysis_params()).json()

    corr = body["correlation"]
    assert corr["assets"] == ["us_equity", "us_bond"]
    matrix = corr["matrix"]
    assert len(matrix) == 2
    for i in range(2):
        for j in range(2):
            cell = matrix[i][j]
            assert cell is None or (cell == matrix[j][i])
    # 対角
    assert matrix[0][0] == pytest.approx(1.0)
    assert matrix[1][1] == pytest.approx(1.0)


def test_analysis_outer_join_keeps_nan(client: TestClient, tmp_settings: Settings) -> None:
    """資産ごとの観測日が異なる場合、外側 join で NaN が残る（補完しない）。"""
    _save_two_assets(ParquetPriceRepository(tmp_settings.processed_dir))
    body = client.get("/api/data/analysis", params=_analysis_params()).json()

    # us_equity は 01-04 も観測あり、us_bond は 01-04 なし → 累積は損益のない証左に。
    # ここでは price points から外側日付が1資産に保持されていることを確認。
    bond_price = next(a for a in body["prices"] if a["asset_id"] == "us_bond")
    bond_dates = [p["date"] for p in bond_price["points"]]
    # 01-04 は us_bond の観測日ではないので、bond の価格点には 01-04 が現れない
    assert "2024-01-04" not in bond_dates


def test_analysis_frequency_monthly(client: TestClient, tmp_settings: Settings) -> None:
    """frequency='M' で価格は最終観測値、累積は複利合成。"""
    _save_two_assets(ParquetPriceRepository(tmp_settings.processed_dir))
    body = client.get(
        "/api/data/analysis", params=_analysis_params(frequency="M")
    ).json()

    equity_price = next(a for a in body["prices"] if a["asset_id"] == "us_equity")
    # 1月の最終観測日 01-05 に最終観測価格 103.0
    assert equity_price["points"] == [
        {"date": "2024-01-05", "value": 103.0}
    ]

    # 単一月データでは累積は基準点 0.0 のみ（月次価格 1 点からリターンが取れない）。
    # 月次累積は先頭月を基準 0.0 とし、以降は前月末→当月末のリターンを複利合成する。
    equity_cum = next(a for a in body["cumulative"] if a["asset_id"] == "us_equity")
    assert equity_cum["points"] == [{"date": "2024-01-05", "value": 0.0}]


def test_analysis_missing_asset_excluded_with_warning(
    client: TestClient, tmp_settings: Settings
) -> None:
    """未取得資産は除外され、日本語警告が返る（例外にしない）。"""
    _save_two_assets(ParquetPriceRepository(tmp_settings.processed_dir))
    resp = client.get(
        "/api/data/analysis",
        params=_analysis_params(asset_ids=["us_equity", "us_bond", "ex_us_equity"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assets_used"] == ["us_equity", "us_bond"]
    assert any("未取得" in w and "ex_us_equity" in w for w in body["warnings"])
    assert all(len(a["points"]) > 0 for a in body["prices"])


def test_analysis_all_missing_returns_empty_with_warning(
    client: TestClient, tmp_settings: Settings
) -> None:
    """全資産が未取得でも 200 を返し、空・警告で明示する。"""
    resp = client.get(
        "/api/data/analysis",
        params=_analysis_params(asset_ids=["us_equity", "us_bond"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assets_used"] == []
    assert body["prices"] == []
    assert body["correlation"]["assets"] == []
    assert len(body["warnings"]) == 2


def test_analysis_single_asset_warns_correlation_needs_two(
    client: TestClient, tmp_settings: Settings
) -> None:
    """1資産のみでも返るが、相関解釈には2資産以上必要と日本語警告を添える。"""
    _save_two_assets(ParquetPriceRepository(tmp_settings.processed_dir))
    resp = client.get(
        "/api/data/analysis", params=_analysis_params(asset_ids=["us_equity"])
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assets_used"] == ["us_equity"]
    assert body["correlation"]["assets"] == ["us_equity"]
    assert body["correlation"]["matrix"][0][0] == pytest.approx(1.0)
    assert any("2資産以上必要" in w for w in body["warnings"])


def test_analysis_filters_by_date_range(client: TestClient, tmp_settings: Settings) -> None:
    """start/end で期間を絞る。"""
    _save_two_assets(ParquetPriceRepository(tmp_settings.processed_dir))
    resp = client.get(
        "/api/data/analysis",
        params=_analysis_params(
            start=date(2024, 1, 3),
            end=date(2024, 1, 4),
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    equity = next(a for a in body["prices"] if a["asset_id"] == "us_equity")
    assert [p["date"] for p in equity["points"]] == ["2024-01-03", "2024-01-04"]