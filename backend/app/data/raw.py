"""raw（取得直後）データの保存。

`ParquetPriceRepository`（processed 用）と同一のハッシュレシピで Parquet＋
スナップショットマニフェストを保存する。CLAUDE.md: 取得データは原本（raw）と
正規化済み（processed）を分けて保存し、processed は必ず raw スナップショットを参照する。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pandas as pd


class RawParquetWriter:
    """raw ディレクトリへ Parquet とスナップショットマニフェストを書き込む。"""

    def __init__(self, raw_dir: Path) -> None:
        self._raw_dir = raw_dir
        self._raw_dir.mkdir(parents=True, exist_ok=True)

    def _path_for(self, asset_id: str) -> Path:
        return self._raw_dir / f"{asset_id}.parquet"

    def _manifest_path(self, asset_id: str) -> Path:
        return self._raw_dir / f"{asset_id}.snapshot.json"

    def save_raw(self, asset_id: str, frame: pd.DataFrame) -> str:
        """フレームを保存し、raw スナップショットの SHA-256 を返す。

        未正規化の input でも、保存時に日付をソートした正規化 JSON でハッシュを
        取るため、同じ内容なら再現可能なハッシュになる。
        """
        df = frame.copy()
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
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
        return snapshot_hash

    def load_raw(self, asset_id: str) -> pd.DataFrame:
        """保存済み raw Parquet を読み出す。"""
        path = self._path_for(asset_id)
        if not path.exists():
            raise FileNotFoundError(f"raw 系列が存在しません: {asset_id}")
        df = pd.read_parquet(path)
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
        return df

    def read_manifest(self, asset_id: str) -> dict[str, object]:
        """保存済み raw マニフェストを返す。"""
        path = self._manifest_path(asset_id)
        if not path.exists():
            return {}
        return dict(json.loads(path.read_text(encoding="utf-8")))


__all__ = ["RawParquetWriter"]
