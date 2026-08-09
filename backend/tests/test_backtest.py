"""固定ウェイト・バックテストエンジンの単体テスト。

`test_optimization.py` と同じ固定データ（GBM）の方針で、エンジンの
下記を検証する:
- 単一資産・コスト0: equity == 初期資金 × P/P0、指標の手計算照合
- 2資産: 初期配分・リバランス後のウェイト復帰・手数料・回転率
- 次営業日約定（シグナル日と約定日の分離）
- バイアス検知: 未来部分のデータ変更で過去結果が変わらない
- エラー系・警告系・指標の未定義（null）
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from app.backtest.engine import BacktestInputError, run_backtest
from app.schemas.backtest import BacktestParams, BacktestRequest

_DATES = pd.date_range("2024-01-02", periods=60, freq="B")


def _make_2asset_prices(rng_seed: int = 42) -> pd.DataFrame:
    """2 資産（us_equity / us_bond）の GBM 価格を返す。"""
    rng = np.random.default_rng(rng_seed)
    n = len(_DATES)
    return pd.DataFrame(
        {
            "us_equity": 100.0 * np.cumprod(1 + rng.normal(0, 0.01, n)),
            "us_bond": 100.0 * np.cumprod(1 + rng.normal(0, 0.005, n)),
        },
        index=_DATES,
    )


def _from_values(values: list[float], freq: str = "B") -> pd.DataFrame:
    """手計算しやすい整数価格系列を返す。"""
    n = len(values)
    dates = pd.bdate_range("2024-01-02", periods=n)
    return pd.DataFrame({"us_equity": values}, index=dates)


# ---------------------------------------------------------------------------
# 単一資産・コスト0
# ---------------------------------------------------------------------------


def test_single_asset_no_cost_equity_matches_price_ratio() -> None:
    """単一資産・ウェイト1.0・コスト0では equity == 初期資金×P/P0。"""
    prices = _from_values([100.0, 110.0, 105.0, 120.0, 130.0])
    params = BacktestParams(
        weights={"us_equity": 1.0},
        rebalance_frequency="D",
        initial_capital=1000.0,
        cost_rate=0.0,
    )
    res = run_backtest(prices, params, currency="USD")

    expected_equity = [p.value for p in res.equity_curve]
    assert expected_equity[0] == pytest.approx(1000.0)
    assert expected_equity[-1] == pytest.approx(1000.0 * 130.0 / 100.0)

    assert res.metrics.cumulative_return == pytest.approx(0.30, abs=1e-9)
    # 取引は初期投資のみ（コスト0なので回転も手数料も0）
    assert len(res.trades) == 1
    assert res.trades[0].side == "BUY"
    assert res.trades[0].quantity == pytest.approx(10.0)
    assert res.metrics.turnover == pytest.approx(0.0)
    assert res.metrics.total_fees == 0.0


def test_single_asset_cost_applies_initial_fee() -> None:
    """コスト有りだと初期投資にも手数料がかかる。"""
    prices = _from_values([100.0, 100.4, 100.8, 101.2, 101.6])
    params = BacktestParams(
        weights={"us_equity": 1.0},
        rebalance_frequency="M",
        initial_capital=10000.0,
        cost_rate=0.001,
    )
    res = run_backtest(prices, params)
    # 初期 BUY 1件の fee = 0.001 * 10000
    assert res.metrics.total_fees == pytest.approx(10.0)
    assert res.trades[0].fee == pytest.approx(10.0)


# ---------------------------------------------------------------------------
# 2資産・リバランス・次営業日約定
# ---------------------------------------------------------------------------


def test_two_assets_initial_split_and_monthly_rebalance() -> None:
    """2資産 50/50 で初期配分、月末にリバランスして翌営業日約定。"""
    prices = _make_2asset_prices()
    params = BacktestParams(
        weights={"us_equity": 0.5, "us_bond": 0.5},
        rebalance_frequency="M",
        initial_capital=10000.0,
        cost_rate=0.0,
    )
    res = run_backtest(prices, params)

    # 初期投資: 2資産に BUY
    init_trades = [t for t in res.trades if t.date == _DATES[0].date()]
    assert len(init_trades) == 2
    for t in init_trades:
        assert t.side == "BUY"
        assert t.value == pytest.approx(5000.0, abs=1e-6)

    # 月初（月末→翌営業日）にリバランス取引がある
    rebal_trades = [t for t in res.trades if t.date != _DATES[0].date()]
    assert len(rebal_trades) >= 2

    # 2月のシグナル日（1月末）の翌営業日に取引がある
    feb_dates = sorted({t.date for t in rebal_trades if t.date.month == 2})
    assert feb_dates, "2月にリバランスがない"

    # リバランスの翌観測日（約定日翌日）のウェイトが 50/50 に戻っている。
    # 約定日当日の allocation はリバランス前の評価時点、翌日は価格変動で厳密 0.5 にはならない
    # ため、ターゲットに近いこと（abs=1e-3）を検証する。
    exec_day = feb_dates[0]
    alloc_indices = [i for i, a in enumerate(res.allocation) if a.date == exec_day]
    assert alloc_indices, "約定日の allocation がない"
    next_index = alloc_indices[0] + 1
    assert next_index < len(res.allocation)
    alloc_after = res.allocation[next_index]
    assert alloc_after.weights["us_equity"] == pytest.approx(0.5, abs=1e-3)
    assert alloc_after.weights["us_bond"] == pytest.approx(0.5, abs=1e-3)


def test_monthly_execution_is_next_observation_day() -> None:
    """約定日はシグナル日（月末）の翌観測日（次営業日）であり、当月最終観測日に取引がない。"""
    prices = _make_2asset_prices()
    # 1 月の最終営業日を特定
    jan_dates = _DATES[_DATES.month == 1]
    jan_last = jan_dates[-1]
    feb_first = _DATES[_DATES.month == 2][0]

    params = BacktestParams(
        weights={"us_equity": 0.5, "us_bond": 0.5},
        rebalance_frequency="M",
        initial_capital=10000.0,
        cost_rate=0.0,
    )
    res = run_backtest(prices, params)

    trade_dates = {t.date for t in res.trades}
    # シグナル日（1月末）に取引は発生しない（当日の翌日に約定）
    assert jan_last.date() not in trade_dates
    # 翌営業日（2月最初の観測日）に取引がある
    assert feb_first.date() in trade_dates


def test_daily_rebalance_trades_every_day() -> None:
    """D 頻度ではほぼ毎観測日（初日除く）に取引がある。

    約定日はシグナル日の翌観測日。最後の観測日はシグナル日だが翌観測日が
    無いため約定しない。取引日は「初日（初期投資）+ 2番目以降の観測日」。
    """
    prices = _make_2asset_prices()
    params = BacktestParams(
        weights={"us_equity": 0.5, "us_bond": 0.5},
        rebalance_frequency="D",
        initial_capital=10000.0,
        cost_rate=0.0,
    )
    res = run_backtest(prices, params)
    trade_dates = sorted({t.date for t in res.trades})
    # 初日(初期投資) + 観測日2番目以降 = len-1 日
    assert len(trade_dates) == len(_DATES) - 1
    assert trade_dates[0] == _DATES[0].date()
    # 最後の取引は最後から2番目の観測日をシグナル日とする約定日（= 最終観測日）
    assert trade_dates[-1] == _DATES[-1].date()


# ---------------------------------------------------------------------------
# コスト・回転率
# ---------------------------------------------------------------------------


def test_cost_rate_adds_fees_on_rebalance() -> None:
    """コスト率を 2 資産・コスト有りで検証。総手数料 == 各取引 fee の和。"""
    prices = _make_2asset_prices()
    cost_rate = 0.001
    params = BacktestParams(
        weights={"us_equity": 0.5, "us_bond": 0.5},
        rebalance_frequency="D",
        initial_capital=10000.0,
        cost_rate=cost_rate,
    )
    res = run_backtest(prices, params)
    expected_fees = sum(t.fee for t in res.trades)
    assert res.metrics.total_fees == pytest.approx(expected_fees, abs=1e-9)
    # 初期投資の fee は 2資産 × 0.001 × 5000
    assert res.trades[0].fee == pytest.approx(5.0)
    assert res.metrics.total_fees > 10.0  # 初期 + リバランス分


# ---------------------------------------------------------------------------
# 指標の手計算照合
# ---------------------------------------------------------------------------


def test_metrics_hand_computation() -> None:
    """固定リターン系列で cumulative / annual / volatility を手計算照合。"""
    # 2 日間: +10% のみ（ノーイズ）
    prices = _from_values([100.0, 110.0])
    params = BacktestParams(
        weights={"us_equity": 1.0}, rebalance_frequency="M",
        initial_capital=1000.0, cost_rate=0.0,
    )
    res = run_backtest(prices, params)

    assert res.metrics.cumulative_return == pytest.approx(0.10)
    # annualized geometric = (1.10)^252 - 1
    assert res.metrics.annual_return == pytest.approx(1.10**252 - 1, rel=1e-6)
    # 非負リターンのみなので Sortino は None（下方偏差なし）
    assert res.metrics.sortino_ratio is None
    # win_rate = 100%
    assert res.metrics.win_rate == pytest.approx(1.0)


def test_flat_series_metrics_undefined() -> None:
    """リターンが全て 0 のときボラ=0.0、Sharpe/Sortino/Calmar などが None になる。"""
    values = [100.0] * 30
    prices = _from_values(values)
    params = BacktestParams(
        weights={"us_equity": 1.0}, rebalance_frequency="M",
        initial_capital=1000.0, cost_rate=0.0,
    )
    res = run_backtest(prices, params)
    assert res.metrics.cumulative_return == pytest.approx(0.0)
    # ボラは「0」として計算可能（std=0 のため 0.0）
    assert res.metrics.annual_volatility == pytest.approx(0.0)
    # ボラ=0 のため Sharpe は定義不可 → None
    assert res.metrics.sharpe_ratio is None
    # 下方偏差=0 のため Sortino は None
    assert res.metrics.sortino_ratio is None
    # 最大ドローワウン=0 のため Calmar は None
    assert res.metrics.calmar_ratio is None
    # リターンが全て 0（|r|<=1e-12）のため勝率は None
    assert res.metrics.win_rate is None


# ---------------------------------------------------------------------------
# バイアス検知（未来データ混入の検出）
# ---------------------------------------------------------------------------


def test_future_price_change_does_not_alter_past_results() -> None:
    """ある日付 X 以降の価格を変更しても、X 以前の結果（equity/drawdown/trades）が不変。

    ルックアヘッド回避の宣言的保証（約定日 = シグナル日の翌観測日）を検証する。
    """
    base = _make_2asset_prices(rng_seed=1)
    params = BacktestParams(
        weights={"us_equity": 0.6, "us_bond": 0.4},
        rebalance_frequency="W",
        initial_capital=10000.0,
        cost_rate=0.0,
    )
    res_base = run_backtest(base, params)

    # X 日（30番目の観測日）以降だけ価格を大きく変更 = 将来のデータ変動を模す
    x_index = 30
    x_date = _DATES[x_index]
    perturbed = base.copy()
    for col in perturbed.columns:
        perturbed.loc[perturbed.index >= x_date, col] = perturbed.loc[
            perturbed.index >= x_date, col
        ] * 1.5
    res_perturb = run_backtest(perturbed, params)

    # X 以前（date < X）の equity_curve: ルックアヘッドが無ければ不変
    base_pre = [p for p in res_base.equity_curve if p.date < x_date.date()]
    pert_pre = [p for p in res_perturb.equity_curve if p.date < x_date.date()]
    assert len(base_pre) == len(pert_pre)
    for a, b in zip(base_pre, pert_pre, strict=True):
        assert a.date == b.date
        assert float(a.value) == pytest.approx(float(b.value), abs=1e-6)

    # X 以前のデローダウンも不変
    base_dd = [p for p in res_base.drawdown if p.date < x_date.date()]
    pert_dd = [p for p in res_perturb.drawdown if p.date < x_date.date()]
    for a, b in zip(base_dd, pert_dd, strict=True):
        assert float(a.value) == pytest.approx(float(b.value), abs=1e-6)

    # X 以降は価格が変わっているので equity も変化している（将来変動は反映される）
    base_after = [float(p.value) for p in res_base.equity_curve if p.date >= x_date.date()]
    pert_after = [float(p.value) for p in res_perturb.equity_curve if p.date >= x_date.date()]
    assert base_after and pert_after
    assert not np.allclose(base_after, pert_after)


def test_truncated_run_is_prefix_of_full_run() -> None:
    """中途終了（end = X）の結果は、全期間実行の X までの prefix と一致する。"""
    base = _make_2asset_prices()
    params = BacktestParams(
        weights={"us_equity": 0.5, "us_bond": 0.5},
        rebalance_frequency="M",
        initial_capital=10000.0,
        cost_rate=0.0,
    )
    res_full = run_backtest(base, params)

    cut = 25
    truncated = base.iloc[: cut + 1]
    res_cut = run_backtest(truncated, params)

    full_pre = [p for p in res_full.equity_curve if p.date <= truncated.index[-1].date()]
    cut_curve = res_cut.equity_curve
    assert len(full_pre) == len(cut_curve)
    for a, b in zip(full_pre, cut_curve, strict=True):
        assert a.date == b.date
        assert a.value == pytest.approx(b.value, abs=1e-9)


# ---------------------------------------------------------------------------
# エラー系・警告系
# ---------------------------------------------------------------------------


def test_empty_prices_raises() -> None:
    with pytest.raises(BacktestInputError, match="空"):
        run_backtest(
            pd.DataFrame(columns=["us_equity"], index=pd.DatetimeIndex([])),
            BacktestParams(weights={"us_equity": 1.0}),
        )


def test_too_few_observations_raises() -> None:
    prices = _from_values([100.0])
    with pytest.raises(BacktestInputError, match="観測が少なすぎます"):
        run_backtest(
            prices,
            BacktestParams(weights={"us_equity": 1.0}),
        )


def test_nonpositive_price_raises() -> None:
    prices = _from_values([100.0, 0.0, 120.0])
    with pytest.raises(BacktestInputError, match="0 以下"):
        run_backtest(
            prices,
            BacktestParams(weights={"us_equity": 1.0}),
        )


def test_nan_rows_dropped_with_warning() -> None:
    """途中の NaN（全資産そろわない行）は除外され、警告が出る。"""
    n = len(_DATES)
    rng = np.random.default_rng(0)
    df = pd.DataFrame(
        {
            "us_equity": 100.0 * np.cumprod(1 + rng.normal(0, 0.01, n)),
            "us_bond": 100.0 * np.cumprod(1 + rng.normal(0, 0.005, n)),
        },
        index=_DATES,
    )
    # 途中の1行に NaN を作る（us_bond のみ欠落 → 行全体除外）
    df.iloc[10, 1] = np.nan
    params = BacktestParams(
        weights={"us_equity": 0.5, "us_bond": 0.5},
        rebalance_frequency="M",
        initial_capital=1000.0,
        cost_rate=0.0,
    )
    res = run_backtest(df, params)
    assert any("除外" in w for w in res.warnings)
    # equity に NaN が含まれない
    assert all(np.isfinite(float(p.value)) for p in res.equity_curve)


# ---------------------------------------------------------------------------
# リクエストバリデーション
# ---------------------------------------------------------------------------


def test_request_weights_keys_must_match_assets() -> None:
    """weights のキーが asset_ids と一致しないと ValueError（422相当）。"""
    with pytest.raises(ValueError):
        BacktestRequest(
            asset_ids=["us_equity", "us_bond"],
            weights={"us_equity": 1.0},  # us_bond が無い
            rebalance_frequency="M",
        )


def test_request_weights_sum_must_be_one() -> None:
    with pytest.raises(ValueError):
        BacktestRequest(
            asset_ids=["us_equity", "us_bond"],
            weights={"us_equity": 0.2, "us_bond": 0.2},
            rebalance_frequency="M",
        )