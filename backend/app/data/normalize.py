"""データ正規化ロジック。

CLAUDE.md: 取得データをそのまま信頼しない。日付ソート・重複除去・欠損検出・
カラム揃えを実施する。通貨換算・営業日揃え・異常値検出は後続工程で拡張する。
上場前データを推測で補完しない（欠損は欠損のまま扱う）。
"""

from __future__ import annotations

import pandas as pd

from app.data.repository import SERIES_COLUMNS

_NUMERIC_COLUMNS = ("raw_close", "adjusted_close", "distribution")


def normalize_prices(frame: pd.DataFrame) -> pd.DataFrame:
    """価格系列を正規化して返す。

    - `date` を datetime64 化して昇順ソート、重複日付は最後の行を残す。
    - 数値列を float へ変換。`raw_close` と `adjusted_close` が両方空の行は除去。
    - `distribution` の欠損は 0.0 に補完。
    - `SERIES_COLUMNS` の列のみを順序どおり保持し、欠損列は既定値で補完する。
    - 未知の列は捨てる（作り込まない）。空入力は ValueError。

    in/out の型は object から pd.DataFrame へ実装に合わせて変更する。
    """
    if frame is None or len(frame) == 0:
        raise ValueError("正規化対象のデータが空です")

    required = {"date", "asset_id"}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"必須列がありません: {sorted(missing)}")

    df = frame.copy()

    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date", kind="stable").drop_duplicates(subset=["date"], keep="last")

    for col in _NUMERIC_COLUMNS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").astype("float64")

    # raw_close と adjusted_close が両方空の行は除去（価格が全く無い＝観測不能）
    if "raw_close" in df.columns and "adjusted_close" in df.columns:
        df = df.dropna(subset=["raw_close", "adjusted_close"], how="all")

    df = df.reset_index(drop=True)

    result = pd.DataFrame(index=df.index)
    for col in SERIES_COLUMNS:
        if col in df.columns:
            result[col] = df[col]
        elif col == "distribution":
            # 欠損の分配金は 0.0、無い場合は新規列として 0.0 を入れる
            result[col] = 0.0
        elif col == "price_type":
            result[col] = "adjusted_close"
        elif col == "source":
            # source が無い場合は yahoo と決め打ちしない。未知は空でなく None 扱い。
            result[col] = None
        else:
            result[col] = None

    if "distribution" in result.columns:
        result["distribution"] = result["distribution"].fillna(0.0).astype("float64")

    if len(result) == 0:
        raise ValueError("正規化後にデータが空です（全行が価格なし）")

    return result


__all__ = ["normalize_prices"]
