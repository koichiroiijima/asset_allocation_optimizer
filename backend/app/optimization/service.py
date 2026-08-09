"""ポートフォリオ最適化サービス（PyPortfolioOpt を利用）。

`static_allocation`（現在ウェイトを使わない単発の資産配分）を実装する。
CLAUDE.md:
- 入力としてデータ期間・リターン頻度（年率換算）・リスクフリー金利・ウェイト上下限・
  合計ウェイト・取引コストを明示的に受け取る（取引コストは結果表示／別計算に回す）。
- PyPortfolioOpt の入力には価格系列とリターン系列を混同しない。
- 期待リターン・共分散・リスクフリー金利・ベンチマークは `available_at` を持つ。
  本サービスは「リバランス時点より後を使わない」ことは呼び出し側で保証された
  入力 series を前提とする（サービス自体は時系列スライスを行わない）。
- 最適化不可能・制約矛盾・推定が不安定・解が複数のときは、握りつぶさずに説明可能な
  エラーまたは警告を返す。
- 重みは丸める前の値（`weights`）を保存し、表示用に丸めたもの（`clean_weights`）を併記する。

このモジュールは HTTP・DB に依存しない純粋な計算層で、`prices`（DataFrame）から
最適化結果（`OptimizationResult`）を返す。末尾に静的エイリアス `optimize` を提供する
（後続工程の API ルートから利用）。
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pypfopt import (  # type: ignore[import-untyped]
    CovarianceShrinkage,
    EfficientFrontier,
    expected_returns,
    risk_models,
)
from pypfopt.exceptions import OptimizationError  # type: ignore[import-untyped]

from app.schemas.optimization import (
    CovarianceMethod,
    OptimizationMetrics,
    OptimizationResult,
    StaticAllocationParams,
)


class OptimizationInputError(ValueError):
    """入力系列が不正（資産不足・データ不足・非正価格）のときに投げる。

    `message` はユーザーに理解可能な日本語、内部の例外は `origin` に保持して
    握りつぶさない。
    """

    def __init__(self, message: str, *, origin: Exception | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.origin = origin


def _ordered_assets(prices: pd.DataFrame) -> list[str]:
    """列順を崩さない資産リスト（重複・空はエラー）。"""
    if prices is None or prices.empty:
        raise OptimizationInputError("価格データが空です")
    if prices.columns.has_duplicates:
        raise OptimizationInputError("価格データの列（資産）名が重複しています")
    return list(prices.columns)


def _compute_expected_return(
    prices: pd.DataFrame,
    params: StaticAllocationParams,
    *,
    benchmark: pd.Series | None = None,
) -> pd.Series:
    """期待リターンの推定を返す。

    `capm_return` はベンチマーク系列が必要。`market_prices` は price 系列で
    渡す（`returns_data=False` を貫く）。ema は `span` を固定で使う。
    """
    ts = prices.astype("float64")
    factor = params.annualization_factor
    method = params.expected_return_method
    if method == "mean_historical_return":
        return expected_returns.mean_historical_return(ts, frequency=factor)  # type: ignore[no-any-return]
    if method == "capm_return":
        if benchmark is None or benchmark.dropna().empty:
            raise OptimizationInputError("capm_return には市場（ベンチマーク）の価格系列が必要です")
        bench = benchmark.astype("float64").reindex(ts.index)
        if bench.dropna().empty:
            raise OptimizationInputError("capm_return のベンチマーク価格が全て欠損です")
        # capm_return の market_prices は DataFrame 形式を期待する
        # （Series を渡すと内部で RuntimeWarning が出るため）。
        market = bench.to_frame("benchmark")
        return expected_returns.capm_return(  # type: ignore[no-any-return]
            ts,
            market_prices=market,
            risk_free_rate=params.risk_free_rate,
            frequency=factor,
        )
    # ema_historical_return
    return expected_returns.ema_historical_return(ts, frequency=factor)  # type: ignore[no-any-return]


def _compute_covariance(
    prices: pd.DataFrame,
    method: CovarianceMethod,
    *,
    annualization_factor: int = 252,
) -> pd.DataFrame:
    """共分散行列の推定を返す（`ledoit_wolf` は収縮推定）。"""
    ts = prices.astype("float64")
    if method == "sample_cov":
        return risk_models.sample_cov(  # type: ignore[no-any-return]
            ts, frequency=annualization_factor
        )
    if method == "semicovariance":
        return risk_models.semicovariance(  # type: ignore[no-any-return]
            ts, frequency=annualization_factor
        )
    # ledoit_wolf
    estimator = CovarianceShrinkage(ts, frequency=annualization_factor, returns_data=False)
    return estimator.ledoit_wolf()  # type: ignore[no-any-return]


def _build_efficient_frontier(
    mu: pd.Series,
    sigma: pd.DataFrame,
    params: StaticAllocationParams,
) -> EfficientFrontier:
    """EfficientFrontier を構築し、検証済みのウェイト上下限を適用する。

    `asset_weight_bounds` があれば全資産共通の `weight_bounds` を上書きし、
    それ以外の資産は共通の上下限を使う。資産名（列名）は PyPortfolioOpt の
    表示名（`:asset`）毎に設定する。
    """
    assets = list(mu.index)
    if params.asset_weight_bounds:
        bounds: list[tuple[float, float]] = [
            params.asset_weight_bounds.get(a, params.weight_bounds) for a in assets
        ]
    else:
        bounds = [params.weight_bounds] * len(assets)
    return EfficientFrontier(mu, sigma, weight_bounds=bounds)


def _apply_method(ef: EfficientFrontier, params: StaticAllocationParams) -> None:
    """目的関数を実行する。解けないときは説明可能な OptimizationInputError を投げる。

    PyPortfolioOpt は達成不能な目標（efficient_risk の最小分散未満・efficient_return の
    最大リターン超過など）を `ValueError` で投げる。これを握りつぶさず、ユーザーに
    理解可能な日本語メッセージへ変換する。
    """
    method = params.optimization_method
    try:
        if method == "max_sharpe":
            ef.max_sharpe(risk_free_rate=params.risk_free_rate)
        elif method == "min_volatility":
            ef.min_volatility()
        elif method == "efficient_risk":
            ef.efficient_risk(params.target_volatility)  # type: ignore[arg-type]
        elif method == "efficient_return":
            ef.efficient_return(params.target_return)  # type: ignore[arg-type]
        else:  # pragma: no cover - Literal で到達不能
            raise OptimizationInputError(f"未知の最適化手法: {method!r}")
    except OptimizationError as exc:  # 最適化不可能・制約矛盾・推定不安定
        raise OptimizationInputError(
            f"最適化に失敗しました（手法: {method}）。"
            "制約の矛盾・データ不足・推定の不安定さが考えられます。"
            "ウェイト上下限・目標値・入力データを確認してください。",
            origin=exc,
        ) from exc
    except ValueError as exc:  # 達成不能な目標値（最小分散未満の目標ボラ等）
        raise OptimizationInputError(
            f"最適化できませんでした（手法: {method}）。"
            "目標値（リターン／ボラティリティ）が達成不能な範囲にあります。"
            "目標値を高く（ボラ）／低く（リターン）して再実行してください。",
            origin=exc,
        ) from exc


def static_allocation(
    prices: pd.DataFrame,
    params: StaticAllocationParams,
    *,
    benchmark: pd.Series | None = None,
) -> OptimizationResult:
    """`prices`（列=資産、行=日次調整済み終値）から単発の最適配分を求める。

    - 入力は price 系列（`returns_data=False` を貫く。リターン系列と混同しない）。
    - 逐次的に推定し、データ不足（非正価格・資産不足・欠損のみ）は説明可能なエラーを投げる。
    - 警告（NaN 補完・ゼロ分散など）は `warnings` に集める。
    """
    warnings: list[str] = []
    assets = _ordered_assets(prices)

    # 非正価格の検証（対数変換系／リターン算出の前提。推測補完しない）。
    float_prices = prices.astype("float64")
    if (float_prices <= 0).any().any():
        raise OptimizationInputError(
            "価格データに 0 以下の値が含まれます（リターン・最適化を計算できません）"
        )

    usable = float_prices.dropna(how="all")
    if len(usable) < 2:
        raise OptimizationInputError(
            "最適化に使える観測が少なすぎます（少なくとも2時点の価格が必要です）"
        )
    if usable.shape[1] < 2:
        raise OptimizationInputError(
            f"最適化には2資産以上が必要です（現在 {usable.shape[1]} 資産）"
        )

    n_dropped_rows = len(float_prices) - len(usable)
    if n_dropped_rows:
        warnings.append(f"価格の全列 NaN 行 {n_dropped_rows} 行を除外しました")

    # 中途の欠損は PyPortfolioOpt 内部の前fill に委ねる。その旨を警告で明示する。
    # （値自体は推測補完ではなく、リターン算出のための既存規約。欠損は集計で顕在化）
    if float_prices.isna().any().any():
        warnings.append(
            "欠損値はリターン算出のため前fill され、最適化に使用されます"
            "（欠損が多い場合は結果を慎重に解釈してください）"
        )

    try:
        mu = _compute_expected_return(usable, params, benchmark=benchmark)
        sigma = _compute_covariance(
            usable, params.covariance_method, annualization_factor=params.annualization_factor
        )
    except OptimizationInputError:
        raise
    except Exception as exc:  # 推定段階の例外を説明可能なエラーへ変換（握りつぶさない）
        raise OptimizationInputError(
            "期待リターン／共分散の推定に失敗しました。"
            "データの欠損・極端な値・観測不足を確認してください。",
            origin=exc,
        ) from exc

    # mu/sigma の名前列を揃える（PyPortfolioOpt は mu の index と sigma の列で照合）。
    mu = mu.reindex(assets)
    sigma = sigma.reindex(index=assets, columns=assets)

    if mu.dropna().empty:
        raise OptimizationInputError("期待リターンの推定値が全て欠損です")

    if not np.isfinite(sigma.to_numpy()).all():
        warnings.append("共分散行列に非有限値が含まれます（極端な推定値）")
    ef = _build_efficient_frontier(mu, sigma, params)
    _apply_method(ef, params)

    raw_weights = dict(zip(assets, np.asarray(ef.weights, dtype=float), strict=True))
    clean = dict(ef.clean_weights())
    expected_return, volatility, sharpe = ef.portfolio_performance(
        risk_free_rate=params.risk_free_rate, verbose=False
    )

    return OptimizationResult(
        method=params.optimization_method,
        weights=raw_weights,
        clean_weights=clean,
        metrics=OptimizationMetrics(
            expected_annual_return=float(expected_return),
            annual_volatility=float(volatility),
            sharpe_ratio=float(sharpe),
        ),
        params=params,
        warnings=warnings,
    )


# 下位互換のため静的エイリアスを提供（ドメイン層のエントリポイント）。
optimize = static_allocation

__all__ = [
    "OptimizationInputError",
    "StaticAllocationParams",
    "optimize",
    "static_allocation",
]
