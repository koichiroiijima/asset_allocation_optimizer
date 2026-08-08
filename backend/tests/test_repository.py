"""Parquet 価格リポジトリと SQLite 索引リポジトリのテスト。"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest
from app.data.repository import (
    SERIES_COLUMNS,
    ParquetPriceRepository,
    SqliteIndexRepository,
)


@pytest.fixture
def sample_frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-02", "2024-01-03"]),
            "asset_id": ["us_equity", "us_equity"],
            "raw_close": [100.0, 101.0],
            "adjusted_close": [101.2, 102.3],
            "distribution": [0.0, 0.4],
            "currency": ["USD", "USD"],
            "source": ["local", "local"],
        }
    )


def test_parquet_roundtrip(tmp_path: Path, sample_frame: pd.DataFrame) -> None:
    """Parquet 保存→読み出しで行数と主要列が一致する。"""
    repo = ParquetPriceRepository(tmp_path / "processed")
    repo.save_series("us_equity", sample_frame)
    loaded = repo.load_series("us_equity")
    assert len(loaded) == len(sample_frame)
    for col in ("date", "raw_close", "adjusted_close"):
        assert col in loaded.columns
    assert loaded["date"].equals(sample_frame["date"])


def test_load_missing_raises(tmp_path: Path) -> None:
    """存在しない系列の読み出しは FileNotFoundError。"""
    repo = ParquetPriceRepository(tmp_path / "processed")
    with pytest.raises(FileNotFoundError):
        repo.load_series("us_equity")


def test_manifest_written(tmp_path: Path, sample_frame: pd.DataFrame) -> None:
    """保存時にスナップショットマニフェストが書かれる。"""
    repo = ParquetPriceRepository(tmp_path / "processed")
    repo.save_series("us_equity", sample_frame)
    manifest = repo.read_manifest("us_equity")
    assert manifest["asset_id"] == "us_equity"
    assert manifest["rows"] == len(sample_frame)
    assert manifest["snapshot_hash"]


def test_sqlite_schema_created(tmp_path: Path) -> None:
    """SQLite 最小スキーマ（assets / fetch_history / jobs / runs）が作られる。"""
    db_path = tmp_path / "data" / "app.db"
    repo = SqliteIndexRepository(db_path)
    assert db_path.exists()
    with repo._conn:  # noqa: SLF001 — テストで内部接続を確認
        tables = {
            row[0]
            for row in repo._conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        }
    assert {"assets", "fetch_history", "jobs", "runs"} <= tables
    repo.close()


def test_series_columns_contract() -> None:
    """Parquet スキーマ契約が CLAUDE.md の推奨データレコードと整合する。"""
    required = {
        "date",
        "asset_id",
        "raw_close",
        "adjusted_close",
        "currency",
        "source",
        "retrieved_at",
    }
    assert required <= set(SERIES_COLUMNS)
