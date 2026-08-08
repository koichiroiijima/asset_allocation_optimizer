"""CSV エクスポートのテスト。"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from app.config.settings import Settings
from app.data.export import export_csv_for_asset, export_csv_processed
from app.data.repository import ParquetPriceRepository


@pytest.fixture
def sample() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-02", "2024-01-03"]),
            "asset_id": ["us_equity", "us_equity"],
            "raw_close": [100.0, 101.0],
            "adjusted_close": [101.2, 102.3],
            "distribution": [0.0, 0.4],
        }
    )


def test_export_csv_for_asset(tmp_path: Path, sample: pd.DataFrame) -> None:
    """1資産の CSV が日付 %Y-%m-%d 形式で出力される。"""
    out = tmp_path / "out"
    export_csv_for_asset("us_equity", sample, out / "us_equity.csv")
    content = (out / "us_equity.csv").read_text(encoding="utf-8")
    assert "2024-01-02" in content
    assert "2024-01-03" in content


def test_export_csv_processed_all(tmp_settings: Settings, sample: pd.DataFrame) -> None:
    """processed の全資産が CSV 変換され、再読込と一致する。"""
    repo = ParquetPriceRepository(tmp_settings.processed_dir)
    repo.save_series("us_equity", sample)
    repo.save_series("us_bond", sample.assign(asset_id="us_bond"))

    written = export_csv_processed(tmp_settings.processed_dir)
    assert len(written) == 2

    loaded = pd.read_csv(tmp_settings.processed_dir / "us_equity.csv")
    assert loaded["date"].tolist() == ["2024-01-02", "2024-01-03"]
    assert loaded["adjusted_close"].tolist() == [101.2, 102.3]


def test_export_csv_processed_subset_and_skip(tmp_settings: Settings) -> None:
    """資産指定で絞り込み、存在しない資産の読み込み失敗はスキップされる。"""
    repo = ParquetPriceRepository(tmp_settings.processed_dir)
    repo.save_series("us_equity", pd.DataFrame({"date": pd.to_datetime(["2024-01-02"]),
                                                "asset_id": ["us_equity"]}))

    written = export_csv_processed(tmp_settings.processed_dir, asset_ids=["us_equity"])
    assert [p.name for p in written] == ["us_equity.csv"]

    missing = export_csv_processed(tmp_settings.processed_dir, asset_ids=["nope"])
    assert missing == []
