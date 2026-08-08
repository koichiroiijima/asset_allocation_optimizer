"""ストレージ層の抽象と最小実装。

- 価格系列は Parquet（+ スナップショットマニフェスト）
- 索引（資産・取得履歴・ジョブ・実行結果）は SQLite（標準ライブラリの sqlite3）

ORM は使わず、将来ワーカーに置き換えても影響が出ないようインターフェースを切る。
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import date
from pathlib import Path
from typing import Any, Protocol

import pandas as pd
from pandas import Timestamp

# 時系列の境界指定（開始/終了日）。pandas の datetime 変換が受ける型に絞る。
DateBound = str | date | Timestamp

# CLAUDE.md の推奨データレコード列（Parquet のスキーマ）
SERIES_COLUMNS = [
    "date",
    "asset_id",
    "raw_close",
    "adjusted_close",
    "distribution",
    "currency",
    "source",
    "source_symbol",
    "price_type",
    "retrieved_at",
    "timezone",
    "calendar",
    "available_at",
    "source_request_hash",
    "raw_snapshot_hash",
    "processed_snapshot_hash",
]


class SeriesStore(Protocol):
    """価格系列ストアの契約。"""

    def save_series(self, asset_id: str, frame: pd.DataFrame) -> None: ...
    def load_series(
        self, asset_id: str, start: DateBound | None = None, end: DateBound | None = None
    ) -> pd.DataFrame: ...
    def read_manifest(self, ref: str) -> dict[str, Any]: ...


class ParquetPriceRepository:
    """processed ディレクトリに Parquet で系列を保存・読み出すリポジトリ。"""

    def __init__(self, processed_dir: Path) -> None:
        self._processed_dir = processed_dir
        self._processed_dir.mkdir(parents=True, exist_ok=True)

    def _path_for(self, asset_id: str) -> Path:
        return self._processed_dir / f"{asset_id}.parquet"

    def _manifest_path(self, asset_id: str) -> Path:
        return self._processed_dir / f"{asset_id}.snapshot.json"

    def save_series(self, asset_id: str, frame: pd.DataFrame) -> None:
        df = frame.copy()
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
        # マニフェスト用に内容ハッシュを計算してから保存。
        # カラム順・行順を固定した正規化 JSON で SHA-256 を取る（再現可能なスナップショット）。
        canonical = df.copy()
        canonical["date"] = canonical["date"].astype(str)
        canonical = canonical.sort_values("date", kind="stable")
        blob = json.dumps(
            canonical.to_dict(orient="records"),
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        ).encode("utf-8")
        snapshot_hash = hashlib.sha256(blob).hexdigest()

        df.to_parquet(self._path_for(asset_id), index=False)
        manifest = {"asset_id": asset_id, "snapshot_hash": snapshot_hash, "rows": int(len(df))}
        self._manifest_path(asset_id).write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def load_series(
        self, asset_id: str, start: DateBound | None = None, end: DateBound | None = None
    ) -> pd.DataFrame:
        path = self._path_for(asset_id)
        if not path.exists():
            raise FileNotFoundError(f"系列が存在しません: {asset_id}")
        df = pd.read_parquet(path)
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
            if start is not None:
                df = df[df["date"] >= pd.Timestamp(start)]
            if end is not None:
                df = df[df["date"] <= pd.Timestamp(end)]
        return df

    def read_manifest(self, ref: str) -> dict[str, Any]:
        """指定の asset_id に対応するマニフェストを返す。"""
        path = self._manifest_path(ref)
        if not path.exists():
            return {}
        return dict(json.loads(path.read_text(encoding="utf-8")))


class SqliteIndexRepository:
    """SQLite で索引（assets / fetch_history / jobs / runs）を管理するリポジトリ。

    スキーマは必要になった時点でマイグレーション関数を追加する。初期版は最小 DDL のみ。
    """

    def __init__(self, db_path: Path) -> None:
        self._db_path = db_path
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self._db_path)
        self._create_schema()

    def _create_schema(self) -> None:
        with self._conn:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS assets (
                    logical_asset TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    default_ticker TEXT,
                    asset_class TEXT,
                    currency TEXT,
                    updated_at TEXT
                );
                CREATE TABLE IF NOT EXISTS fetch_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    asset_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    finished_at TEXT,
                    rows INTEGER,
                    status TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS jobs (
                    job_id TEXT PRIMARY KEY,
                    type TEXT NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT
                );
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY,
                    job_id TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    settings_json TEXT
                );
                """
            )

    @property
    def db_path(self) -> Path:
        return self._db_path

    def insert_fetch_history(
        self, asset_id: str, source: str, *, started_at: str, status: str = "running"
    ) -> int:
        """fetch_history に行を追加し、その id を返す。"""
        with self._conn:
            cur = self._conn.execute(
                "INSERT INTO fetch_history (asset_id, source, started_at, status) "
                "VALUES (?, ?, ?, ?)",
                (asset_id, source, started_at, status),
            )
        return int(cur.lastrowid) if cur.lastrowid is not None else 0

    def update_fetch_status(
        self, row_id: int, *, finished_at: str, rows: int, status: str
    ) -> None:
        """fetch_history 行の終了時刻・件数・状態を更新する。"""
        with self._conn:
            self._conn.execute(
                "UPDATE fetch_history SET finished_at = ?, rows = ?, status = ? "
                "WHERE id = ?",
                (finished_at, rows, status, row_id),
            )

    def close(self) -> None:
        self._conn.close()


__all__ = [
    "SERIES_COLUMNS",
    "ParquetPriceRepository",
    "SeriesStore",
    "SqliteIndexRepository",
]
