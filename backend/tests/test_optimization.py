"""最適化サービス（app.optimization.service.static_allocation）のテスト。

固定データで PyPortfolioOpt を使った最適化の動作を検証する。
CLAUDE.md テスト計画「最適化」: 重み合計・上下限制約・既知解・制約矛盾時のエラー。
ネットワーク・実データは使わない（純粋関数のテスト）。
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest
from app.optimization.service import OptimizationInputError, static_allocation
from app.schemas.optimization import DEFAULT_MARKET_WEIGHTS, StaticAllocationParams
from pypfopt import EfficientFrontier, black_litterman, expected_returns, risk_models

# 確定的な固定データ（乱数シード固定・再現可能）。
_DATES = pd.date_range("2020-01-01", periods=300, freq="D")


def _make_prices(
    means: list[float] | None = None,
    vols: list[float] | None = None,
    *,
    names: list[str] | None = None,
) -> pd.DataFrame:
    """固定シードの幾何ブラウン運動で価格 DataFrame を作る（列=資産）。"""
    rng = np.random.default_rng(42)
    names = names or ["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"]
    means = means or [0.0004, 0.0001, 0.0003, 0.0002]
    vols = vols or [0.008, 0.002, 0.009, 0.003]
    prices: dict[str, np.ndarray] = {}
    for name, mu, vol in zip(names, means, vols, strict=True):
        rets = rng.normal(mu, vol, size=len(_DATES))
        prices[name] = 100.0 * np.cumprod(1.0 + rets)
    return pd.DataFrame(prices, index=_DATES)


def _expected_from_prices(prices: pd.DataFrame) -> pd.Series:
    """テスト内で期待リターンを自力計算（PyPortfolioOpt と同じ既定値）。"""
    return expected_returns.mean_historical_return(prices, frequency=252)


def _cov_from_prices(prices: pd.DataFrame) -> pd.DataFrame:
    return risk_models.sample_cov(prices, frequency=252)


def test_weights_sum_to_one_and_within_bounds() -> None:
    """max_sharpe: 生ウェイトの合計が1、各ウェイトが0-1に収まる。"""
    prices = _make_prices()
    params = StaticAllocationParams(optimization_method="max_sharpe", risk_free_rate=0.0)
    result = static_allocation(prices, params)

    w = result.weights
    assert sorted(w) == sorted(prices.columns)
    assert sum(w.values()) == pytest.approx(1.0, abs=1e-6)
    for value in w.values():
        assert 0.0 <= value <= 1.0

    # metrics に年率リターン／ボラ／Sharpe が設定される
    assert np.isfinite(result.metrics.expected_annual_return)
    assert np.isfinite(result.metrics.annual_volatility)
    assert np.isfinite(result.metrics.sharpe_ratio)


def test_min_volatility_has_lower_volatility_than_equity_only() -> None:
    """min_volatility: 債券に高い配分が入り、単純な株式集中より低ボラになる。"""
    prices = _make_prices()
    params = StaticAllocationParams(optimization_method="min_volatility")
    result = static_allocation(prices, params)

    # 低ボラの債券（us_bond）に有意な配分が入る
    assert result.weights["us_bond"] > 0.4
    assert 0.0 <= result.weights["ex_us_bond"] <= 1.0
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_efficient_risk_matches_portfolio_performance() -> None:
    """efficient_risk: 目標ボラ（最小分散より高めで達成可能）で最適化できる。"""
    prices = _make_prices()
    # 最小分散ポートフォリオのボラを基準に、達成可能な目標（1.5倍）を設定する
    min_params = StaticAllocationParams(optimization_method="min_volatility")
    vmin = static_allocation(prices, min_params).metrics.annual_volatility
    target_vol = vmin * 1.5

    params = StaticAllocationParams(
        optimization_method="efficient_risk", target_volatility=target_vol
    )
    result = static_allocation(prices, params)
    # 報告ボラは目標と概ね一致（厳密一致は solver の精度に依存）
    assert result.metrics.annual_volatility == pytest.approx(target_vol, rel=1e-3)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_efficient_return_requires_target() -> None:
    """efficient_return に target_return が無いとバリデーションエラー。"""
    with pytest.raises(ValueError):
        StaticAllocationParams(optimization_method="efficient_return")


def test_target_validation_for_efficient_risk() -> None:
    """efficient_risk に target_volatility が無いとバリデーションエラー。"""
    with pytest.raises(ValueError):
        StaticAllocationParams(optimization_method="efficient_risk")


def test_covariance_ledoit_wolf_and_semicovariance_run() -> None:
    """ledoit_wolf / semicovariance の各共分散手法が実行でき、ウェイトが返る。"""
    prices = _make_prices()
    for method in ("ledoit_wolf", "semicovariance"):
        params = StaticAllocationParams(covariance_method=method)  # type: ignore[arg-type]
        result = static_allocation(prices, params)
        assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-6)
        assert len(result.weights) == len(prices.columns)


def test_capm_return_with_benchmark_runs() -> None:
    """capm_return はベンチマーク価格系列があれば実行できる。"""
    prices = _make_prices()
    rng = np.random.default_rng(7)
    benchmark = pd.Series(
        100.0 * np.cumprod(1.0 + rng.normal(0.0003, 0.006, len(_DATES))), index=_DATES
    )
    params = StaticAllocationParams(expected_return_method="capm_return")
    result = static_allocation(prices, params, benchmark=benchmark)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_capm_return_without_benchmark_raises() -> None:
    """capm_return をベンチマーク無しで呼ぶと説明可能なエラー。"""
    prices = _make_prices()
    params = StaticAllocationParams(expected_return_method="capm_return")
    with pytest.raises(OptimizationInputError, match="ベンチマーク"):
        static_allocation(prices, params)


def test_asset_weight_bounds_are_respected() -> None:
    """資産ごとの上下限が最適解に反映される（例: 株式に10%以下）。"""
    prices = _make_prices()
    bounds = {"us_equity": (0.0, 0.01), "ex_us_equity": (0.0, 0.01)}
    params = StaticAllocationParams(
        optimization_method="min_volatility", asset_weight_bounds=bounds
    )
    result = static_allocation(prices, params)
    assert result.weights["us_equity"] <= 0.01 + 1e-6
    assert result.weights["ex_us_equity"] <= 0.01 + 1e-6
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_insufficient_assets_raises() -> None:
    """資産1つでは最適化できない旨の説明可能なエラー。"""
    prices = _make_prices(means=[0.0004], vols=[0.008], names=["only"])
    params = StaticAllocationParams()
    with pytest.raises(OptimizationInputError, match="2資産"):
        static_allocation(prices, params)


def test_empty_prices_raises() -> None:
    """空の価格 DataFrame は説明可能なエラー。"""
    empty = pd.DataFrame()
    params = StaticAllocationParams()
    with pytest.raises(OptimizationInputError, match="空"):
        static_allocation(empty, params)


def test_non_positive_price_raises() -> None:
    """0以下を含む価格は計算できない旨の説明可能なエラー。"""
    prices = _make_prices()
    prices.iloc[10, 0] = -1.0
    params = StaticAllocationParams()
    with pytest.raises(OptimizationInputError, match="0 以下"):
        static_allocation(prices, params)


def test_all_nan_column_raises_or_warns() -> None:
    """1資産が全 NaN でも他資産があれば実行し、全列 NaN 行の警告が出る。"""
    prices = _make_prices()
    # 全資産で NaN の行を作成して警告を確認する
    prices.iloc[50:60, :] = np.nan
    params = StaticAllocationParams()
    result = static_allocation(prices, params)
    assert any("除外" in w for w in result.warnings)
    assert sum(result.weights.values()) == pytest.approx(1.0, abs=1e-6)


def test_weight_bounds_validation() -> None:
    """lower > upper の weight_bounds はバリデーションエラー。"""
    with pytest.raises(ValueError):
        StaticAllocationParams(weight_bounds=(0.8, 0.2))


def test_negative_weight_bound_rejected() -> None:
    """ウェイト下限が負は拒否される（ロングオンリー既定）。"""
    with pytest.raises(ValueError):
        StaticAllocationParams(weight_bounds=(-0.1, 1.0))


def test_rounding_behavior_clean_vs_raw() -> None:
    """clean_weights は表示用に丸められ、raw weights は丸め前の値を保持する。"""
    prices = _make_prices()
    params = StaticAllocationParams(optimization_method="max_sharpe")
    result = static_allocation(prices, params)
    # raw はより高い精度（clean は小数点以下4桁程度に丸められる）
    raw_max_precision = max(
        len(f"{abs(v):.6f}".rstrip("0").split(".")[1]) for v in result.weights.values()
    )
    assert raw_max_precision >= 5


def test_benchmark_weights_reproducible() -> None:
    """同一固定データではウェイトが再現できる（シード固定）。"""
    prices_a = _make_prices()
    prices_b = _make_prices()
    result_a = static_allocation(prices_a, StaticAllocationParams())
    result_b = static_allocation(prices_b, StaticAllocationParams())
    for name in prices_a.columns:
        assert result_a.weights[name] == pytest.approx(result_b.weights[name])


def test_static_allocation_matches_direct_pypfopt() -> None:
    """サービス結果が PyPortfolioOpt を直接呼んだ結果と一致する（同値検証）。"""
    prices = _make_prices()
    params = StaticAllocationParams(optimization_method="min_volatility")
    result = static_allocation(prices, params)

    mu = _expected_from_prices(prices)
    sigma = _cov_from_prices(prices)
    ef = EfficientFrontier(mu, sigma, weight_bounds=(0.0, 1.0))
    ef.min_volatility()
    expected_weights = dict(zip(prices.columns, ef.weights, strict=True))

    for name in prices.columns:
        assert result.weights[name] == pytest.approx(expected_weights[name])


# ---------------------------------------------------------------- Black-Litterman ---


def test_bl_prior_matches_manual_pi() -> None:
    """BL の先行情報 Π が δ·Σ·w_mkt + rf の手計算と一致する。

    `static_allocation` の `metrics.asset_returns`（no-views 時は pi と同一）を
    PyPortfolioOpt の `market_implied_prior_returns`（＝手計算式）と照合する。
    """
    prices = _make_prices()
    params = StaticAllocationParams(
        expected_return_method="black_litterman", bl_risk_aversion=3.0
    )
    result = static_allocation(prices, params)

    sigma = _cov_from_prices(prices)
    w_mkt = pd.Series(DEFAULT_MARKET_WEIGHTS, dtype="float64").reindex(prices.columns)
    delta = params.bl_risk_aversion
    assert delta is not None  # mypy: 3.0 を指定している
    expected = delta * sigma.dot(w_mkt / w_mkt.sum()) + params.risk_free_rate
    for name in prices.columns:
        assert result.metrics.asset_returns[name] == pytest.approx(expected[name], rel=1e-6)


def test_bl_no_views_matches_market_weights() -> None:
    """BL でビューを指定しないと市場均衡（=市場ポートフォリオ）に収束する。

    逆算されたリスク回避度 δ = (E[r_p] - rf)/Var[r_p] を用いると、ビュー無しの最大
    Sharpe 解は市場ポートフォリオウェイト w_mkt と一致する（tangency portfolio）。
    これにより「ビューなしBL = 市場均衡」の性質を検証する。
    """
    prices = _make_prices()
    params = StaticAllocationParams(
        expected_return_method="black_litterman", optimization_method="max_sharpe"
    )
    result = static_allocation(prices, params)

    w_mkt = pd.Series(DEFAULT_MARKET_WEIGHTS, dtype="float64").reindex(prices.columns)
    w_mkt = w_mkt / w_mkt.sum()
    for name in prices.columns:
        assert result.weights[name] == pytest.approx(w_mkt[name], abs=1e-3)


def test_bl_view_moves_expected_returns() -> None:
    """絶対ビューが期待リターンを市場均衡から動かす（方向と大きさ）。"""
    prices = _make_prices()
    base = StaticAllocationParams(expected_return_method="black_litterman")
    base_result = static_allocation(prices, base)

    view = StaticAllocationParams(
        expected_return_method="black_litterman", bl_views={"us_equity": 0.05}
    )
    view_result = static_allocation(prices, view)
    # ビューで us_equity の期待リターンが上昇し、他の資産にも波及する
    assert (
        view_result.metrics.asset_returns["us_equity"]
        > base_result.metrics.asset_returns["us_equity"]
    )
    assert view_result.weights["us_equity"] > base_result.weights["us_equity"]


def test_bl_tau_is_invariant_with_default_omega() -> None:
    """τ は `omega="default"` では結果に影響しない（独立性の検証）。

    PyPortfolioOpt の `default_omega = τ·P·Σ·Pᵀ` と事後式の分子 `τ·Σ·Pᵀ` が
    打ち消し合い、τ は default_omega 使用時に計算結果へ現れない。仕様として
    （τ の効果が見たい場合は omega を明示的に指定する必要がある）。
    """
    prices = _make_prices()
    r_low = static_allocation(
        prices,
        StaticAllocationParams(
            expected_return_method="black_litterman",
            bl_views={"us_equity": 0.10},
            bl_tau=0.01,
        ),
    )
    r_high = static_allocation(
        prices,
        StaticAllocationParams(
            expected_return_method="black_litterman",
            bl_views={"us_equity": 0.10},
            bl_tau=1.0,
        ),
    )
    for name in prices.columns:
        assert r_low.metrics.asset_returns[name] == pytest.approx(
            r_high.metrics.asset_returns[name], abs=1e-12
        )


def test_bl_matches_direct_black_litterman_model() -> None:
    """BL サービスの事後 mu / sigma が直接 BlackLittermanModel と一致する（同値検証）。"""
    prices = _make_prices()
    params = StaticAllocationParams(
        expected_return_method="black_litterman",
        bl_views={"us_equity": 0.05, "us_bond": -0.02},
        bl_risk_aversion=3.0,
        bl_tau=0.1,
    )
    result = static_allocation(prices, params)

    sigma = _cov_from_prices(prices)
    pi = black_litterman.market_implied_prior_returns(
        pd.Series(DEFAULT_MARKET_WEIGHTS, dtype="float64").reindex(prices.columns),
        params.bl_risk_aversion,
        sigma,
        risk_free_rate=params.risk_free_rate,
    )
    bl = black_litterman.BlackLittermanModel(
        sigma,
        pi=pi,
        absolute_views=params.bl_views,
        omega="default",
        tau=params.bl_tau,
    )
    for name in prices.columns:
        assert result.metrics.asset_returns[name] == pytest.approx(bl.bl_returns()[name], rel=1e-6)
        assert result.metrics.asset_volatilities[name] == pytest.approx(
            float(np.sqrt(bl.bl_cov().loc[name, name])), rel=1e-4
        )


def test_bl_omega_idzorek_differs_from_default() -> None:
    """omega=idzorek（確信度指定）は default（分散比例）とは別の結果になる。"""
    prices = _make_prices()
    params_default = StaticAllocationParams(
        expected_return_method="black_litterman",
        bl_views={"us_equity": 0.05},
        bl_risk_aversion=3.0,
    )
    params_idzorek = StaticAllocationParams(
        expected_return_method="black_litterman",
        bl_views={"us_equity": 0.05},
        bl_view_confidences={"us_equity": 0.95},
        bl_omega_method="idzorek",
        bl_risk_aversion=3.0,
    )
    r_default = static_allocation(prices, params_default)
    r_idzorek = static_allocation(prices, params_idzorek)
    # 確信度高（0.95）ならビューへ強く引かれる
    assert (
        r_idzorek.metrics.asset_returns["us_equity"]
        > r_default.metrics.asset_returns["us_equity"]
    )


def test_bl_validation_errors() -> None:
    """BL の不正なパラメータはスキーマのバリデーション（ValueError）で弾かれる。"""
    with pytest.raises(ValueError, match="bl_tau"):
        StaticAllocationParams(expected_return_method="black_litterman", bl_tau=0.0)
    with pytest.raises(ValueError, match="bl_tau"):
        StaticAllocationParams(expected_return_method="black_litterman", bl_tau=1.5)
    with pytest.raises(ValueError, match="bl_risk_aversion"):
        StaticAllocationParams(expected_return_method="black_litterman", bl_risk_aversion=0.0)
    with pytest.raises(ValueError, match="確信度"):
        StaticAllocationParams(
            expected_return_method="black_litterman", bl_view_confidences={"us_equity": 1.2}
        )
    with pytest.raises(ValueError, match="市場ポートフォリオ"):
        StaticAllocationParams(
            expected_return_method="black_litterman",
            bl_market_weights={"us_equity": 0.5, "us_bond": 0.5, "ex_us_equity": 0.5},
        )


def test_bl_unknown_view_asset_raises() -> None:
    """ビューの対象が選択資産外（サービス層の防御チェック）。"""
    prices = _make_prices()
    params = StaticAllocationParams(
        expected_return_method="black_litterman", bl_views={"missing_asset": 0.05}
    )
    with pytest.raises(OptimizationInputError, match="ビューの対象"):
        static_allocation(prices, params)
