"""データ取得パイプライン。

fetch → raw 保存 → 正規化 → processed 保存 → fetch_history 記録、を1資産ずつ
隔離して実行する。1資産の失敗でバッチ全体を中断しない（失敗資産は status=failed）。
CLAUDE.md: processed は必ず特定の raw スナップショットを参照する。
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import pandas as pd

from app.config.assets import AssetDefinition, load_asset_mapping
from app.config.settings import Settings
from app.data.normalize import normalize_prices
from app.data.providers.yahoo import YahooPriceProvider
from app.data.raw import RawParquetWriter
from app.data.repository import SERIES_COLUMNS, ParquetPriceRepository, SqliteIndexRepository
from app.schemas.dataseries import PriceRecord


def build_dataframe(records: list[PriceRecord]) -> pd.DataFrame:
    """PriceRecord のリストを SERIES_COLUMNS 順の DataFrame へ組み立てる。"""
    data = [record.model_dump() for record in records]
    frame = pd.DataFrame(data, columns=SERIES_COLUMNS)
    return frame


class PricePipeline:
    """4体系の取得・正規化・保存をまとめて実行する。"""

    def __init__(
        self,
        settings: Settings,
        *,
        provider: Any | None = None,
        assets: list[AssetDefinition] | None = None,
    ) -> None:
        self._settings = settings
        self._assets = assets or load_asset_mapping(settings.asset_mapping_file)
        self._symbols: dict[str, str] = {a.logical_asset: a.default_ticker for a in self._assets}
        self._provider = provider or YahooPriceProvider(self._symbols)
        self._raw = RawParquetWriter(settings.raw_dir)
        self._processed = ParquetPriceRepository(settings.processed_dir)
        self._index = SqliteIndexRepository(settings.sqlite_path_resolved)

    @property
    def provider(self) -> Any:
        return self._provider

    def close(self) -> None:
        self._index.close()
        close = getattr(self._provider, "close", None)
        if callable(close):
            close()

    def _run_one(
        self,
        asset_id: str,
        *,
        start: date | None,
        end: date | None,
    ) -> dict[str, Any]:
        started = datetime.now(UTC).isoformat()
        row_id = self._index.insert_fetch_history(
            asset_id, self._provider.name, started_at=started, status="running"
        )
        finished = datetime.now(UTC).isoformat()
        try:
            records = self._provider.fetch_history(asset_id, start=start, end=end)
            df = build_dataframe(records)
            raw_hash = self._raw.save_raw(asset_id, df)
            df["raw_snapshot_hash"] = raw_hash
            processed = normalize_prices(df)
            self._processed.save_series(asset_id, processed)
            self._index.update_fetch_status(
                row_id, finished_at=finished, rows=int(len(processed)), status="succeeded"
            )
            return {
                "asset_id": asset_id,
                "status": "succeeded",
                "rows": int(len(processed)),
                "raw_snapshot_hash": raw_hash,
            }
        except Exception as exc:  # noqa: BLE001 — 資産単位で隔離して記録する
            self._index.update_fetch_status(
                row_id, finished_at=finished, rows=0, status="failed"
            )
            return {"asset_id": asset_id, "status": "failed", "error": str(exc)}

    def run(
        self,
        asset_ids: list[str] | None = None,
        start: date | None = None,
        end: date | None = None,
    ) -> dict[str, Any]:
        """指定（省略時は全4資産）の取得パイプラインを実行し、結果サマリを返す。"""
        targets = asset_ids or [a.logical_asset for a in self._assets]
        results = [self._run_one(aid, start=start, end=end) for aid in targets]
        return {"results": results}


__all__ = ["PricePipeline", "build_dataframe"]
