"""基準カレンダーの最小実装。

CLAUDE.md: 日次データは基準カレンダーを定めて整列し、リターン計算と評価計算の
カレンダー規則を分けて記録する。祝日データベースは持たず、観測日付の単調ランクを
提供する最小実装とする（祝日対応は後続工程で拡張する）。
"""

from __future__ import annotations

import pandas as pd


class TradingCalendar:
    """観測日付に対して一意な単調ランクを割り当てる基準カレンダー。"""

    def __init__(self, name: str, anchor: str | None = None) -> None:
        self.name = name
        self.anchor = anchor  # 例: "America/New_York"。将来の祝日判定用。

    def rank(self, series: pd.Series) -> pd.Series:
        """日付列を時系列上のランク（0..n-1）へ変換する。

        同一日付は同じランクになり、欠損を含まない。祝日は考慮しない。
        """
        dates = pd.to_datetime(series)
        uniques = pd.DatetimeIndex(dates.dropna().unique()).sort_values()
        rank_map = {ts: i for i, ts in enumerate(uniques)}
        return dates.map(rank_map).astype("Int64")


def trading_calendar(name: str = "us") -> TradingCalendar:
    """指定名の基準カレンダーを返す。既定は米国（us）。"""
    if name == "default":
        name = "us"
    if name not in ("us", "jp"):
        raise ValueError(f"未対応のカレンダーです: {name!r}")
    anchor = "America/New_York" if name == "us" else "Asia/Tokyo"
    return TradingCalendar(name=name, anchor=anchor)


__all__ = ["TradingCalendar", "trading_calendar"]
