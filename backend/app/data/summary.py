"""processed データの要約（API 出力用の純粋関数）。

IO を行わず、`pd.DataFrame` から `AssetDataStatus` を組み立てる。
値は推測せず、実データの集計（期間・行数・欠損・出所・価格種別・取得日時）を返す。
並び順や欠損処理の判断はここに閉じる。
"""

from __future__ import annotations

import pandas as pd

from app.schemas.asset import AssetDataStatus


def summarize_series(df: pd.DataFrame) -> AssetDataStatus:
    """正規化済みの価格 DataFrame を要約し、`AssetDataStatus` に変換する。

    - 期間（start/end）と行数は `date` 列から。
    - 欠損（`missing`）は `adjusted_close` の NaN 行数（列が無ければ 0）。
    - 出所・価格種別は先頭の非 NaN 値、取得日時は最大値。
    - `available=True`。（ファイルが存在する時点で観測可能）

    想定: `date` は `datetime64`、`asset_id` は単一値。
    """
    asset_id = (
        str(df["asset_id"].iloc[0]) if "asset_id" in df.columns and len(df) else ""
    )
    if "date" in df.columns and len(df):
        dates = pd.to_datetime(df["date"])
    else:
        dates = pd.Series(dtype="datetime64[ns]")

    missing = 0
    if "adjusted_close" in df.columns:
        missing = int(df["adjusted_close"].isna().sum())

    def _first_non_nan(col: str) -> str | None:
        if col not in df.columns or len(df) == 0:
            return None
        values = df[col].dropna()
        if values.empty:
            return None
        return str(values.iloc[0])

    retrieved_at = None
    if "retrieved_at" in df.columns and len(df):
        ts = pd.to_datetime(df["retrieved_at"]).max()
        if pd.notna(ts):
            retrieved_at = ts.to_pydatetime()

    return AssetDataStatus(
        logical_asset=asset_id,
        available=True,
        start=dates.min().date() if len(dates) else None,
        end=dates.max().date() if len(dates) else None,
        rows=len(df),
        missing=missing,
        source=_first_non_nan("source"),
        price_type=_first_non_nan("price_type"),
        retrieved_at=retrieved_at,
        snapshot_hash=None,  # route 側で repo.read_manifest() から合成する
    )


__all__ = ["summarize_series"]
