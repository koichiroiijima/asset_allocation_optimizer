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

import pandas as pd

# ローリング中央値の窓（観測数）と、異常とみなす比率（中央値比）。
# 窓は奇数が望ましい（中心が1点に定まる）。min_periods は窓の 1/4（最低3）。
DEFAULT_ANOMALY_WINDOW = 21
DEFAULT_ANOMALY_RATIO = 2.0


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


__all__ = [
    "DEFAULT_ANOMALY_RATIO",
    "DEFAULT_ANOMALY_WINDOW",
    "PriceAnomaly",
    "detect_price_anomalies",
]
