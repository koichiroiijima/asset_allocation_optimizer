"""価格異常値検出（app.data.quality.detect_price_anomalies）のテスト。

一時的なスパイク（Yahoo がまれに返す誤った終値）を検出し、株式分割のような
恒久的な水準変化は誤検出しないことを検証する。ネットワーク・実データは使わない。
"""

from __future__ import annotations

import pandas as pd
from app.data.quality import DEFAULT_ANOMALY_RATIO, detect_price_anomalies


def _series(values: list[float], start: str = "2020-01-01") -> pd.Series:
    index = pd.date_range(start, periods=len(values), freq="D")
    return pd.Series([float(v) for v in values], index=index, dtype="float64")


def test_detects_isolated_downward_spike() -> None:
    """2日間だけ 1/10 になるスパイクを検出する（2026-03 の日本株と同型）。"""
    values = [100.0] * 20 + [10.0, 10.0] + [100.0] * 20
    anomalies = detect_price_anomalies(_series(values), asset_id="jp_equity")

    assert {a.date.date().isoformat() for a in anomalies} == {"2020-01-21", "2020-01-22"}
    assert all(a.asset_id == "jp_equity" for a in anomalies)
    assert all(a.direction == "下振れ" for a in anomalies)
    assert all(a.ratio < 1.0 / DEFAULT_ANOMALY_RATIO for a in anomalies)


def test_detects_isolated_upward_spike() -> None:
    """1日だけ 10 倍になるスパイクを検出する。"""
    values = [100.0] * 20 + [1000.0] + [100.0] * 20
    anomalies = detect_price_anomalies(_series(values))

    assert len(anomalies) == 1
    assert anomalies[0].direction == "上振れ"
    assert anomalies[0].date.date().isoformat() == "2020-01-21"


def test_permanent_level_shift_is_not_flagged() -> None:
    """株式分割のような恒久的な段差（戻らない水準変化）は検出しない。"""
    values = [100.0] * 30 + [10.0] * 30
    assert detect_price_anomalies(_series(values)) == []


def test_empty_and_short_series_return_nothing() -> None:
    """空・短すぎる系列では検出しない（窓が確保できないため）。"""
    assert detect_price_anomalies(pd.Series(dtype="float64")) == []
    assert detect_price_anomalies(_series([100.0, 101.0])) == []


def test_custom_threshold_changes_sensitivity() -> None:
    """しきい値 ratio を厳しく／緩くすると検出結果が変わる。"""
    values = [100.0] * 20 + [60.0] + [100.0] * 20  # -40%
    assert detect_price_anomalies(_series(values), ratio=1.5)
    assert detect_price_anomalies(_series(values), ratio=4.0) == []


def test_normal_volatility_is_not_flagged() -> None:
    """通常の日次変動（±10% 程度）は検出しない。"""
    values = [100.0, 105.0, 98.0, 103.0, 95.0, 101.0, 108.0, 100.0] * 6
    assert detect_price_anomalies(_series(values)) == []
