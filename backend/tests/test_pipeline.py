"""PricePipeline のテスト（ネットワーク不使用・fake provider 使用）。"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pandas as pd
from app.config.settings import Settings
from app.data.pipeline import PricePipeline
from app.data.repository import SqliteIndexRepository
from app.schemas.dataseries import PriceRecord


def _record(asset_id: str, day: int) -> PriceRecord:
    return PriceRecord(
        date=date(2024, 1, day),
        asset_id=asset_id,
        raw_close=100.0 + day,
        adjusted_close=101.0 + day,
        distribution=0.0,
        currency="USD",
        source="fake",
        source_symbol="TICK",
        price_type="adjusted_close",
        retrieved_at=datetime(2024, 1, 1, tzinfo=UTC),
        timezone="America/New_York",
        calendar="us",
        available_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


class FakeProvider:
    """fetch に失敗する資産を差し込める fake provider（実ネットワーク不使用）。"""

    def __init__(self, *, fail: set[str] | None = None) -> None:
        self._fail = fail or set()

    @property
    def name(self) -> str:
        return "fake"

    def fetch_history(
        self, asset_id: str, start: date | None = None, end: date | None = None
    ) -> list[PriceRecord]:
        if asset_id in self._fail:
            raise RuntimeError(f"fetch failure for {asset_id}")
        return [_record(asset_id, 2), _record(asset_id, 3)]


def test_run_saves_raw_and_processed(tmp_settings: Settings) -> None:
    """run で raw/processed Parquet が生成され、raw_snapshot_hash が入る。"""
    pipeline = PricePipeline(tmp_settings, provider=FakeProvider())
    try:
        summary = pipeline.run()
    finally:
        pipeline.close()

    results = summary["results"]
    assert len(results) == 4
    assert all(r["status"] == "succeeded" for r in results)
    by_id = {r["asset_id"]: r for r in results}

    for asset_id in ("us_equity", "us_bond", "ex_us_equity", "ex_us_bond"):
        raw_path = tmp_settings.raw_dir / f"{asset_id}.parquet"
        processed_path = tmp_settings.processed_dir / f"{asset_id}.parquet"
        assert raw_path.exists()
        assert processed_path.exists()
        processed = pd.read_parquet(processed_path)
        # processed に raw_snapshot_hash が設定されている（CLAUDE.md 要求）
        assert processed["raw_snapshot_hash"].notna().all()

        raw_hash = by_id[asset_id]["raw_snapshot_hash"]
        assert raw_hash
        assert processed["raw_snapshot_hash"].iloc[0] == raw_hash


def test_run_records_fetch_history(tmp_settings: Settings) -> None:
    """fetch_history に succeeded の行が記録される。"""
    pipeline = PricePipeline(tmp_settings, provider=FakeProvider())
    try:
        summary = pipeline.run()
    finally:
        pipeline.close()

    index = SqliteIndexRepository(tmp_settings.sqlite_path_resolved)
    try:
        with index._conn:  # noqa: SLF001 — テストで内部接続を確認
            rows = index._conn.execute(
                "SELECT status, rows FROM fetch_history ORDER BY id"
            ).fetchall()
    finally:
        index.close()
    assert len(rows) == 4
    assert all(r[0] == "succeeded" and r[1] == 2 for r in rows)
    assert summary["results"]


def test_run_isolates_failure(tmp_settings: Settings) -> None:
    """1資産の失敗を隔離し、他資産は成功のまま継続する。"""
    pipeline = PricePipeline(tmp_settings, provider=FakeProvider(fail={"us_bond"}))
    try:
        summary = pipeline.run()
    finally:
        pipeline.close()

    by_id = {r["asset_id"]: r for r in summary["results"]}
    assert by_id["us_bond"]["status"] == "failed"
    assert "error" in by_id["us_bond"]
    assert by_id["us_equity"]["status"] == "succeeded"

    # 失敗資産は processed を作らないが raw も作らない
    assert not (tmp_settings.processed_dir / "us_bond.parquet").exists()

    # fetch_history には failed が記録される
    index = SqliteIndexRepository(tmp_settings.sqlite_path_resolved)
    try:
        rows = dict(
            index._conn.execute(  # noqa: SLF001
                "SELECT asset_id, status FROM fetch_history"
            ).fetchall()
        )
    finally:
        index.close()
    assert rows["us_bond"] == "failed"
    assert rows["us_equity"] == "succeeded"
