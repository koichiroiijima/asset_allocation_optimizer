"""processed Parquet から CSV へエクスポートする。

CLAUDE.md: 結果はダウンロード可能な明細表でも確認できるようにする。CSV は
UTF-8、日付は `%Y-%m-%d` で出力する（raw/processed の原本は Parquet のまま）。
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from app.data.repository import ParquetPriceRepository


def export_csv_for_asset(asset_id: str, df: pd.DataFrame, out_path: Path) -> Path:
    """1資産分の DataFrame を CSV へ書き出し、そのパスを返す。"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out_path, index=False, date_format="%Y-%m-%d")
    return out_path


def export_csv_processed(
    processed_dir: Path, out_dir: Path | None = None, asset_ids: list[str] | None = None
) -> list[Path]:
    """processed の全（または指定）資産を CSV に変換し、作成パス一覧を返す。

    `out_dir` 未指定なら processed_dir そのものへ出力する。
    """
    out = out_dir or processed_dir
    out.mkdir(parents=True, exist_ok=True)
    repo = ParquetPriceRepository(processed_dir)
    if asset_ids is None:
        asset_ids = sorted(p.stem for p in processed_dir.glob("*.parquet"))
    written: list[Path] = []
    for asset_id in asset_ids:
        try:
            df = repo.load_series(asset_id)
        except FileNotFoundError:
            continue
        written.append(export_csv_for_asset(asset_id, df, out / f"{asset_id}.csv"))
    return written


__all__ = ["export_csv_for_asset", "export_csv_processed"]
