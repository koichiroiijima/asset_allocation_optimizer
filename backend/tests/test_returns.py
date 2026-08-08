"""リターン計算・年率換算（app.domain.returns）のテスト。

既知の数値例を手計算と照合し、純粋関数としての動作を検証する。
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from app.domain.returns import (
    annualize_log_return,
    annualize_return,
    annualize_volatility,
    cumulative_return,
    log_return,
    resample_prices,
    resample_returns,
    simple_return,
)

# 価格 4 点の既知例（2024-01-02〜05）
_PRICE_DATES = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"])
_PRICES = pd.Series([100.0, 110.0, 99.0, 108.9], index=_PRICE_DATES)


def test_simple_return_known_values() -> None:
    """単純リターン既知値: [NaN, 0.10, -0.10, 0.10]。先頭は NaN。"""
    out = simple_return(_PRICES)
    assert np.isnan(out.iloc[0])
    assert out.iloc[1] == pytest.approx(0.10)
    assert out.iloc[2] == pytest.approx(-0.10)
    assert out.iloc[3] == pytest.approx(0.10)


def test_log_return_known_values() -> None:
    """対数リターン既知値: [NaN, ln 1.1, ln 0.9, ln 1.1]。"""
    out = log_return(_PRICES)
    assert np.isnan(out.iloc[0])
    assert out.iloc[1] == pytest.approx(math.log(1.1))
    assert out.iloc[2] == pytest.approx(math.log(0.9))
    assert out.iloc[3] == pytest.approx(math.log(1.1))


def test_cumulative_return_known_values() -> None:
    """累積リターン既知値: [0.0, 0.10, -0.01, 0.089]（1.1×0.9×1.1=1.089）。"""
    out = cumulative_return(simple_return(_PRICES))
    assert out.iloc[0] == pytest.approx(0.0)
    assert out.iloc[1] == pytest.approx(0.10)
    assert out.iloc[2] == pytest.approx(-0.01)
    assert out.iloc[3] == pytest.approx(0.089)


def test_cumulative_return_starts_at_zero() -> None:
    """累積リターンの先頭は基準日＝0.0 に置換される。"""
    # 先頭が NaN でも基準表現として 0.0 になる
    out = cumulative_return(simple_return(_PRICES))
    assert out.iloc[0] == pytest.approx(0.0)


def test_annualize_return_geometric_known_value() -> None:
    """年率リターン（geometric）: 日次平均 0.001 → (1.001)^252 - 1 ≈ 0.28647。"""
    daily = pd.Series([0.001, 0.001, 0.001])  # 平均 0.001
    out = annualize_return(daily, annualization_factor=252)
    assert out == pytest.approx((1.001) ** 252 - 1.0, rel=1e-9)


def test_annualize_return_arithmetic_differs_from_geometric() -> None:
    """arithmetic は geometric と異なる値（mean×factor）。"""
    daily = pd.Series([0.001, 0.001, 0.001])
    geom = annualize_return(daily, annualization_factor=252)
    arith = annualize_return(daily, annualization_factor=252, method="arithmetic")
    assert arith == pytest.approx(0.001 * 252)
    assert geom != pytest.approx(arith)


def test_annualize_log_return_known_value() -> None:
    """対数年率リターン: m=0.0004, f=252 → expm1(0.1008) ≈ 0.10606。"""
    mean_log = 0.0004
    logs = pd.Series([mean_log, mean_log, mean_log])
    out = annualize_log_return(logs, annualization_factor=252)
    assert out == pytest.approx(math.expm1(mean_log * 252), rel=1e-9)


def test_annualize_volatility_known_value() -> None:
    """年率ボラティリティ: std(ddof=1) × √252。"""
    returns = pd.Series([0.01, 0.02, -0.005, 0.011])
    expected = returns.std(ddof=1) * math.sqrt(252)
    assert annualize_volatility(returns, annualization_factor=252) == pytest.approx(expected)


def test_resample_monthly_compounds_simple() -> None:
    """月次リサンプリング（単純）: 1月 0.01、2月 (1.02×0.995)-1=0.0149。"""
    idx = pd.to_datetime(["2024-01-31", "2024-02-01", "2024-02-02"])
    returns = pd.Series([0.01, 0.02, -0.005], index=idx)
    out = resample_returns(returns, frequency="M")
    # 集約 index は各期間の最終観測日（01-31 / 02-02）
    assert out.index.tolist() == pd.to_datetime(["2024-01-31", "2024-02-02"]).tolist()
    assert out.iloc[0] == pytest.approx(0.01)
    assert out.iloc[1] == pytest.approx((1.02 * 0.995) - 1.0)


def test_resample_monthly_sums_log() -> None:
    """月次リサンプリング（対数）: 周期内は和。"""
    idx = pd.to_datetime(["2024-01-31", "2024-02-01", "2024-02-02"])
    logs = pd.Series([0.02, 0.03, -0.005], index=idx)
    out = resample_returns(logs, frequency="M", log=True)
    assert out.iloc[0] == pytest.approx(0.02)
    assert out.iloc[1] == pytest.approx(0.03 + (-0.005))


def test_resample_daily_is_identity() -> None:
    """'D' は恒等変換（入力がそのまま返る）。"""
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    returns = pd.Series([0.01, 0.02], index=idx)
    out = resample_returns(returns, frequency="D")
    pd.testing.assert_series_equal(out, returns)


def test_resample_prices_monthly_takes_last_observed() -> None:
    """月次価格集約: 各期間の最終観測価格を index の最終観測日に割り当てる。"""
    idx = pd.to_datetime(["2024-01-31", "2024-02-01", "2024-02-02", "2024-05-10"])
    prices = pd.Series([10.0, 11.0, 10.5, 20.0], index=idx)
    out = resample_prices(prices, frequency="M")
    # 1月→01-31(10.0)、2月→02-02(10.5)、3/4月なし、5月→05-10(20.0)
    assert out.index.tolist() == pd.to_datetime(["2024-01-31", "2024-02-02", "2024-05-10"]).tolist()
    assert out.iloc[0] == pytest.approx(10.0)
    assert out.iloc[1] == pytest.approx(10.5)
    assert out.iloc[2] == pytest.approx(20.0)


def test_resample_prices_daily_is_identity() -> None:
    """'D' は恒等変換。"""
    idx = pd.to_datetime(["2024-01-02", "2024-01-03"])
    prices = pd.Series([10.0, 11.0], index=idx)
    pd.testing.assert_series_equal(resample_prices(prices, frequency="D"), prices)


def test_resample_prices_uses_last_observed_ignores_trailing_nan() -> None:
    """期間最終値が NaN の場合、直近の実測価格とその観測日を採る（推測しない）。

    01-03 が NaN なら 1月の価格は 01-02 の 10.0 で、NaN は index にも値にも
    混ざらない（欠損は series 側の警告・missing 集計で顕在化させる）。
    """
    idx = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-02-01"])
    prices = pd.Series([10.0, np.nan, 11.0], index=idx)
    out = resample_prices(prices, frequency="M")
    assert out.index.tolist() == pd.to_datetime(["2024-01-02", "2024-02-01"]).tolist()
    assert out.iloc[0] == pytest.approx(10.0)
    assert out.iloc[1] == pytest.approx(11.0)


def test_empty_input_returns_nan_no_exception() -> None:
    """空 Series: simple/log は全 NaN、annualize は NaN（例外なし）。"""
    empty = pd.Series(dtype="float64", index=pd.DatetimeIndex([]))
    assert simple_return(empty).empty
    assert log_return(empty).empty
    assert math.isnan(annualize_return(empty))
    assert math.isnan(annualize_log_return(empty))
    assert math.isnan(annualize_volatility(empty))


def test_single_point_returns_nan_no_exception() -> None:
    """1 点 Series: simple/log は全 NaN、annualize は NaN（例外なし）。"""
    one_price = pd.Series([100.0], index=pd.to_datetime(["2024-01-02"]))
    assert np.isnan(simple_return(one_price).iloc[0])
    assert np.isnan(log_return(one_price).iloc[0])
    # リターン 0 点（1 点分の NaN）では年率換算は NaN
    one_return = pd.Series([np.nan], index=pd.to_datetime(["2024-01-02"]))
    assert math.isnan(annualize_return(one_return))
    assert math.isnan(annualize_log_return(one_return))
    assert math.isnan(annualize_volatility(one_return))


def test_mid_nan_not_filled() -> None:
    """途中欠損は前処理（前fill）されず NaN のまま伝播する。"""
    idx = pd.to_datetime(["2024-01-02", "2024-01-03", "2024-01-04"])
    prices = pd.Series([100.0, np.nan, 110.0], index=idx)
    out = simple_return(prices)
    assert np.isnan(out.iloc[0])
    assert np.isnan(out.iloc[1])  # 前fill されない
    assert np.isnan(out.iloc[2])


def test_all_nan_annualize_nan() -> None:
    """全 NaN のリターン系列は年率換算で NaN を返す。"""
    all_nan = pd.Series([np.nan, np.nan], index=pd.to_datetime(["2024-01-02", "2024-01-03"]))
    assert math.isnan(annualize_return(all_nan))
    assert math.isnan(annualize_log_return(all_nan))
    assert math.isnan(annualize_volatility(all_nan))
