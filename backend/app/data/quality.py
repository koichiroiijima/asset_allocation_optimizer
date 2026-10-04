"""価格データの品質検査（一時的な異常値の検出）。

CLAUDE.md: 取得データをそのまま信頼せず、重複日付・欠損・**異常値**・配当/分割の扱い・
営業日ずれを検証する。値の推測補完はしない。

方針:
- 前後を含むローリング中央値（`center=True`）から大きく乖離する観測を「異常値」とみなす。
- 中央値は窓の内側にあるため、**数日で復帰する一時的なスパイク**（Yahoo がまれに返す
  誤った終値など）を狙って検出できる。
- 一方、株式分割のような**恒久的な水準変化**には窓が追従するため誤検出しにくい
  （境界の1点が僅かに残る程度）。分割補正そのものは別課題（未実装）。
- 既定しきい値は「中央値の 2 倍超 / 0.5 倍未満」。日本の株式 ETF を想定した値で、
  通常の日次変動（数%）では発火しない。暗号資産など高ボラ資産には不向き。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

# ローリング中央値の窓（観測数）と、異常とみなす比率（中央値比）。
# 窓は奇数が望ましい（中心が1点に定まる）。min_periods は窓の 1/4（最低3）。
DEFAULT_ANOMALY_WINDOW = 21
DEFAULT_ANOMALY_RATIO = 2.0

# 未調整の株式分割を検出する既定値。
# `factor` が共通分割比率（2/3/4/5/10…）に近く、かつ水準が持続する場合のみ分割とみなす。
DEFAULT_SPLIT_TOLERANCE = 0.02  # 分割比率の許容相対誤差（±2%）
DEFAULT_SPLIT_CONFIRM = 20  # 前後の水準確認に使う観測数
DEFAULT_SPLIT_MIN_FACTOR = 1.5  # これ未満の比は分割とみなさない（急落との区別）


@dataclass(frozen=True)
class PriceAnomaly:
    """検出した1件の異常値。"""

    asset_id: str
    date: pd.Timestamp
    value: float
    rolling_median: float
    ratio: float  # value / rolling_median（1 未満は下落方向の乖離）

    @property
    def direction(self) -> str:
        return "上振れ" if self.ratio >= 1.0 else "下振れ"


def detect_price_anomalies(
    series: pd.Series,
    *,
    asset_id: str = "",
    window: int = DEFAULT_ANOMALY_WINDOW,
    ratio: float = DEFAULT_ANOMALY_RATIO,
) -> list[PriceAnomaly]:
    """価格系列から一時的な異常値を検出して返す（空リストなら異常なし）。

    `series` は日付 index・正の価格。`window` はローリング中央値の観測数、
    `ratio` は「中央値比が ratio 倍超 または 1/ratio 倍未満」を異常とするしきい値。
    値の補正・補完は行わない（検出のみ）。
    """
    if series is None or series.empty or ratio <= 1.0 or window < 3:
        return []

    s = pd.to_numeric(series, errors="coerce").astype("float64")
    positive = s.where(s > 0.0)
    median = positive.rolling(window, center=True, min_periods=max(3, window // 4)).median()
    ratio_series = positive / median
    flagged = (ratio_series > ratio) | (ratio_series < 1.0 / ratio)

    anomalies: list[PriceAnomaly] = []
    for date in s.index[flagged.fillna(False).to_numpy()]:
        anomalies.append(
            PriceAnomaly(
                asset_id=asset_id,
                date=pd.Timestamp(date),
                value=float(s.loc[date]),
                rolling_median=float(median.loc[date]),
                ratio=float(ratio_series.loc[date]),
            )
        )
    return anomalies


@dataclass(frozen=True)
class SplitEvent:
    """未調整の株式分割（Yahoo が adjusted_close に反映していないもの）。"""

    asset_id: str
    date: pd.Timestamp  # 分割の適用日（この日の価格が新スケール）
    factor: float  # 分割比率（旧1株 → factor 株）。例 10.0
    raw_before: float
    raw_after: float


def detect_splits(
    raw_close: pd.Series,
    *,
    asset_id: str = "",
    tolerance: float = DEFAULT_SPLIT_TOLERANCE,
    confirm: int = DEFAULT_SPLIT_CONFIRM,
    min_factor: float = DEFAULT_SPLIT_MIN_FACTOR,
) -> list[SplitEvent]:
    """`raw_close` から**未調整の株式分割**を検出して返す（空リストなら該当なし）。

    判定:
    - 前日比の逆数 `raw[t-1]/raw[t]` が `min_factor` 以上で、共通分割比率（整数 2 以上）に
      `tolerance` 以内で一致する。
    - 分割比率どおりに**水準が持続**する（前 `confirm` 観測の中央値 ÷ 後 `confirm` 観測の
      中央値 が比率に概ね一致する）。急落（V字回復）と区別するため。

    これは「Yahoo が分割を adjusted_close に反映していない」事象の検出であり、値の補正は
    行わない（呼び出し側で分割前データを除外する用途を想定）。
    """
    s = pd.to_numeric(raw_close, errors="coerce").astype("float64").dropna()
    if s.size < confirm * 2 + 1:
        return []
    values = s.to_numpy()
    dates = s.index
    events: list[SplitEvent] = []
    for i in range(confirm, len(values) - confirm):
        before_pt = values[i - 1]
        after_pt = values[i]
        if before_pt <= 0.0 or after_pt <= 0.0:
            continue
        factor = before_pt / after_pt
        if factor < min_factor:
            continue
        nearest = round(factor)
        if nearest < 2 or abs(factor - nearest) / nearest > tolerance:
            continue
        before_level = float(np.median(values[i - confirm : i]))
        after_level = float(np.median(values[i : i + confirm]))
        if before_level <= 0.0 or after_level <= 0.0:
            continue
        implied = before_level / after_level
        if abs(implied - factor) / factor > 0.15:
            continue
        events.append(
            SplitEvent(
                asset_id=asset_id,
                date=pd.Timestamp(dates[i]),
                factor=float(nearest),
                raw_before=float(before_pt),
                raw_after=float(after_pt),
            )
        )
    return events


def latest_split_cutoff(raw_close: pd.Series, *, asset_id: str = "") -> SplitEvent | None:
    """検出した分割のうち最も新しいものを返す（分割前データを除外する基準日）。"""
    events = detect_splits(raw_close, asset_id=asset_id)
    if not events:
        return None
    return max(events, key=lambda e: e.date)


__all__ = [
    "DEFAULT_ANOMALY_RATIO",
    "DEFAULT_ANOMALY_WINDOW",
    "DEFAULT_SPLIT_CONFIRM",
    "DEFAULT_SPLIT_MIN_FACTOR",
    "DEFAULT_SPLIT_TOLERANCE",
    "PriceAnomaly",
    "SplitEvent",
    "detect_price_anomalies",
    "detect_splits",
    "latest_split_cutoff",
]
