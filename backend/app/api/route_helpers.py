"""複数資産のリポジトリ読み込み・価格行列の整列（ルート層共通ユーティリティ）。

`GET /api/data/analysis` と `POST /api/optimizations` はどちらも
「複数資産の adjusted_close を共通の日付インデックス（外側 union）で整列した
価格行列」を必要とする。ここで外側 join による整列・未取得資産の扱いを閉じ、
分析ルート（相関・ローリングボラ）と最適化ルート（static_allocation 入力）で共用する。

NaN 方針: 観測日が資産ごとに異なる場合は外側 join で NaN として残し、値を推測
補完しない（CLAUDE.md: 金融データの値を推測で補完しない）。
"""

from __future__ import annotations

from datetime import date

import pandas as pd

from app.data.quality import DEFAULT_ANOMALY_RATIO, detect_price_anomalies, latest_split_cutoff
from app.data.repository import ParquetPriceRepository

WRONG_MISSING_MESSAGE = (
    "データが未取得です（{asset_id}）。先にデータ取得 CLI を実行してください。"
)


def load_price_matrix(
    repo: ParquetPriceRepository,
    asset_ids: list[str],
    *,
    start: date | None = None,
    end: date | None = None,
) -> tuple[pd.DataFrame, list[str]]:
    """複数資産の adjusted_close を外側 union の日付インデックスで整列した価格行列を返す。

    `repo` は `ParquetPriceRepository` 互換（`load_series(asset_id, start, end)`）。

    - 列 = 資産（`asset_ids` の順序を維持）、値 = `adjusted_close`。観測日の
      一致しないセルは NaN のまま（補完しない）。
    - 未取得資産（`FileNotFoundError`）は除外し、`warnings`（日本語）に積む。
    - 戻り値は `(matrix, warnings)`。1 資産も残らない場合は空の DataFrame。

    異常値方針: 各資産の価格系列から**ローリング中央値から大きく乖離する一時的な
    異常値**（`app/data/quality.py`、既定は中央値の2倍超/0.5倍未満）を検出し、当該
    **日付の行を価格行列から除外**して日本語警告に明示する（値の推測補完はしない）。
    分析・最適化・バックテストが壊れた観測で巨大なリターンを計算するのを防ぐ。
    """
    frames: dict[str, pd.Series] = {}
    warnings: list[str] = []
    for asset_id in asset_ids:
        try:
            df = repo.load_series(asset_id, start, end)
        except FileNotFoundError:
            warnings.append(WRONG_MISSING_MESSAGE.format(asset_id=asset_id))
            continue
        if df.empty:
            # 指定期間内のデータが無い資産も算出対象に含めない（警告で明示）。
            warnings.append(f"指定期間にデータがありません（{asset_id}）。")
            continue
        ordered = df.sort_values("date")
        indexed = ordered.set_index("date")
        adjusted = pd.Series(
            indexed["adjusted_close"].astype("float64"),
            name=asset_id,
            dtype="float64",
        )
        # 未調整の株式分割（Yahoo が adjusted_close に反映していない）を検出し、
        # 分割前のデータをこの資産のみ除外する（外側 join で他資産は NaN のまま残る）。
        if "raw_close" in indexed.columns:
            split = latest_split_cutoff(indexed["raw_close"].astype("float64"), asset_id=asset_id)
            if split is not None and bool((adjusted.index < split.date).any()):
                dropped = int((adjusted.index < split.date).sum())
                adjusted = adjusted.loc[adjusted.index >= split.date]
                warnings.append(
                    f"{asset_id} は {split.date.date().isoformat()} に株式分割"
                    f"（{split.factor:.4g}:1）があり、Yahoo の調整済み価格が分割前後で"
                    f"不連続のため、分割前の {dropped} 件を除外しました。"
                )
        if adjusted.empty:
            warnings.append(f"指定期間にデータがありません（{asset_id}）。")
            continue
        frames[asset_id] = adjusted

    if not frames:
        return pd.DataFrame(dtype="float64"), warnings

    # 各資産の一時的な異常値を検出し、該当する日付を後で行列から除外する。
    anomalies = [
        anomaly
        for asset_id, series in frames.items()
        for anomaly in detect_price_anomalies(series, asset_id=asset_id)
    ]

    matrix = pd.concat(frames.values(), axis=1, join="outer")
    # 列順は asset_ids の順序を維持（観測できた資産のみ）。frames は次を保証しないため
    # 明示的に並べ替える。
    matrix = matrix.loc[:, [asset_id for asset_id in asset_ids if asset_id in frames]]
    matrix = matrix.sort_index()
    matrix.index = pd.DatetimeIndex(matrix.index)

    if anomalies:
        drop_dates = {anomaly.date for anomaly in anomalies}
        matrix = matrix.drop(index=[d for d in matrix.index if d in drop_dates])
        details = "、".join(
            f"{a.asset_id} {a.date.date().isoformat()}"
            f"（中央値比 {a.ratio:.2f} 倍・{a.direction}）"
            for a in anomalies
        )
        warnings.append(
            "価格の異常値（ローリング中央値から "
            f"{DEFAULT_ANOMALY_RATIO} 倍超の乖離）を検出したため除外しました: "
            f"{details}。データ提供元の値を確認してください。"
        )
    return matrix, warnings


__all__ = ["WRONG_MISSING_MESSAGE", "load_price_matrix"]