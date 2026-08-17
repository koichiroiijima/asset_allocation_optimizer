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

import math

import numpy as np
import pandas as pd
from pypfopt import (  # type: ignore[import-untyped]
    CovarianceShrinkage,
    EfficientFrontier,
    black_litterman,
    expected_returns,
    risk_models,
)
from pypfopt.exceptions import OptimizationError  # type: ignore[import-untyped]

from app.schemas.optimization import (
    DEFAULT_MARKET_WEIGHTS,
    CovarianceMethod,
    OptimizationMetrics,
    OptimizationResult,
    StaticAllocationParams,
)
from app.schemas.series import Frequency


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


def _resolve_market_weights(
    assets: list[str],
    market_weights: dict[str, float] | None,
    *,
    warnings: list[str],
) -> pd.Series:
    """市場ポートフォリオのウェイト Series（列=選択資産）を返す。

    `market_weights` が None なら `DEFAULT_MARKET_WEIGHTS` を使い、選択資産に無い
    キーは 0 に落とす。指定値は合計が 1 になるよう正規化する（浮動小数点誤差対策）。
    0 に落ちた資産・デフォルトの外挿が起きた場合は警告を積む。
    """
    base = DEFAULT_MARKET_WEIGHTS if market_weights is None else market_weights
    w = pd.Series(base, dtype="float64").reindex(assets, fill_value=0.0)
    total = w.sum()
    if total <= 0.0:
        raise OptimizationInputError(
            "市場ポートフォリオのウェイトの合計が 0 です（黒字のウェイトを指定してください）"
        )
    w = w / total
    zero_assets = [a for a in assets if w[a] <= 0.0]
    if zero_assets:
        warnings.append(
            "市場ポートフォリオにウェイトが設定されていない資産（0%）: " + "、".join(zero_assets)
        )
    return w


def _market_implied_risk_aversion(
    prices: pd.DataFrame,
    market_weights: pd.Series,
    *,
    annualization_factor: int,
    risk_free_rate: float,
) -> float:
    """市場ポートフォリオの超過リターンと分散からリスク回避度を逆算する。

    実際の想定超過リターン（年率）を想定分散（年率）で割った値。
    BL の先行情報 Π = δ·Σ·w_mkt を作るための δ。観測期間が不安定な場合や
    リターンがリスクフリー以下・分散が 0 のときは算出できないため
    `OptimizationInputError`（明示的な bl_risk_aversion を案内）を投げる。
    """
    rets = prices.pct_change().dropna()
    if rets.empty:
        raise OptimizationInputError(
            "リスク回避度を市場ポートフォリオから逆算できません。データが不足しています。"
            "bl_risk_aversion を明示的に指定してください。"
        )
    weighted = (rets * market_weights).sum(axis=1)
    annual_mean = float(weighted.mean()) * annualization_factor
    annual_var = float(weighted.var()) * annualization_factor
    if annual_var <= 0.0 or annual_mean <= risk_free_rate:
        raise OptimizationInputError(
            "リスク回避度を市場ポートフォリオから逆算できません"
            "（市場リターンがリスクフリ金利を下回る、または分散が 0 以下）。"
            "bl_risk_aversion を明示的に指定してください。"
        )
    return (annual_mean - risk_free_rate) / annual_var


def _compute_black_litterman(
    prices: pd.DataFrame,
    params: StaticAllocationParams,
    *,
    warnings: list[str],
) -> tuple[pd.Series, pd.DataFrame]:
    """Black-Litterman の事後期待リターン mu（年率）と事後共分散 sigma（年率）を返す。

    - 先行情報 pi は市場ポートフォリオのウェイト（`bl_market_weights`）と共分散から
      `market_implied_prior_returns`（= δ·Σ·w_m + rf）で算出。
    - 絶対ビュー（`bl_views`、年率期待リターン（r_f込み）の水準）を `absolute_views` として渡す。
    - ビューのない場合は市場均衡と同一の事後分布になる（Π がそのまま mu）。
    - omega は `bl_omega_method`（default=分散に比例／idzorek=確信度から）。idzorek は
      ビューキー順に `view_confidences` を並べて渡す。
    """
    assets = list(prices.columns)
    sigma = _compute_covariance(
        prices, params.covariance_method, annualization_factor=params.annualization_factor
    )
    w_mkt = _resolve_market_weights(assets, params.bl_market_weights, warnings=warnings)

    delta = params.bl_risk_aversion
    if delta is None:
        delta = _market_implied_risk_aversion(
            prices,
            w_mkt,
            annualization_factor=params.annualization_factor,
            risk_free_rate=params.risk_free_rate,
        )
    elif delta <= 0.0:
        raise OptimizationInputError("bl_risk_aversion は正の値で指定してください")

    pi = black_litterman.market_implied_prior_returns(
        w_mkt, delta, sigma, risk_free_rate=params.risk_free_rate
    )

    views = dict(params.bl_views or {})
    unknown = set(views) - set(assets)
    if unknown:
        raise OptimizationInputError(
            "ビューの対象が選択資産に含まれません: " + "、".join(sorted(unknown))
        )
    if params.bl_omega_method == "idzorek":
        view_confidences = [params.bl_view_confidences[a] for a in views]
        omega: object = "idzorek"
    else:
        view_confidences = None
        omega = params.bl_omega_method

    try:
        if not views:
            # ビューが 0 件のとき市場均衡と事後は一致（mu=Π, 事後共分散=元の covariance）。
            # PyPortfolioOpt は空ビュー（k=0）非対応のため model を介さない。
            mu = pi.astype("float64")
            mu = mu.reindex(assets, fill_value=np.nan)
            posterior_cov = sigma
        else:
            bl = black_litterman.BlackLittermanModel(
                sigma,
                pi=pi,
                absolute_views=views,
                omega=omega,
                view_confidences=view_confidences,
                tau=params.bl_tau,
            )
            mu = bl.bl_returns()
            posterior_cov = bl.bl_cov()
    except (ValueError, TypeError, np.linalg.LinAlgError) as exc:
        raise OptimizationInputError(
            f"Black-Litterman の計算に失敗しました（手法: {params.optimization_method}）。"
            "ビュー・τ・市場ポートフォリオの設定を確認してください。",
            origin=exc,
        ) from exc

    # ビュー対象外の資産は mu が NaN になるため、先行情報（pi）で補填する。
    mu = mu.astype("float64").reindex(assets, fill_value=np.nan)
    for a in assets:
        if np.isnan(mu[a]):
            mu[a] = float(pi[a])
    sigma_out = posterior_cov.reindex(index=assets, columns=assets).astype("float64")
    return mu, sigma_out


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
        if params.expected_return_method == "black_litterman":
            mu, sigma = _compute_black_litterman(usable, params, warnings=warnings)
        else:
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

    # 個別資産ごとの年率期待リターン（mu）／年率ボラ（sqrt 対角）を返す。
    # 最適化に使った推定アルゴリズム（期待リターン方式・共分散方式）と一致する。
    mu_aligned = mu.reindex(assets).astype("float64")
    sigma_aligned = sigma.reindex(index=assets, columns=assets).astype("float64")
    mu_vals = mu_aligned.to_dict()
    sigma_diag = np.diag(sigma_aligned.to_numpy(dtype="float64"))
    asset_returns = {a: float(mu_vals[a]) for a in assets}
    asset_vols = {
        a: float(math.sqrt(max(0.0, float(sigma_diag[i])))) for i, a in enumerate(assets)
    }

    return OptimizationResult(
        method=params.optimization_method,
        weights=raw_weights,
        clean_weights=clean,
        metrics=OptimizationMetrics(
            expected_annual_return=float(expected_return),
            annual_volatility=float(volatility),
            sharpe_ratio=float(sharpe),
            asset_returns=asset_returns,
            asset_volatilities=asset_vols,
        ),
        params=params,
        warnings=warnings,
    )


def _rebalance_signal_dates(dates: pd.DatetimeIndex, freq: str) -> list[pd.Timestamp]:
    """リバランスのシグナル日（判定日）を返す（バックテストエンジンと同規則）。

    - `D`: 初日を除く全観測日。
    - `W`/`M`/`Y`: 各期間（週/月/年）の最終観測日（`resample_*` と同じ集約規則）。
    """
    if freq == "D":
        return [pd.Timestamp(d) for d in dates[1:]]
    grouper_freq = {"W": "W", "M": "ME", "Y": "YE"}[freq]
    series = pd.Series(dates, index=dates)
    signals: list[pd.Timestamp] = []
    for _, grp in series.groupby(pd.Grouper(freq=grouper_freq)):
        if len(grp):
            last = pd.Timestamp(grp.index[-1])
            if last > dates[0]:
                signals.append(last)
    return signals


def _execution_dates(
    signals: list[pd.Timestamp], dates: pd.DatetimeIndex
) -> list[pd.Timestamp]:
    """シグナル日の「次の観測日」を約定日とする。以後に観測が無ければ不発火。"""
    arr = np.asarray(dates, dtype="datetime64[ns]")
    result: list[pd.Timestamp] = []
    for s in signals:
        nxt = arr[arr > np.datetime64(s)]
        if len(nxt):
            result.append(pd.Timestamp(nxt[0]))
    return result


def rebalance_allocation(
    prices: pd.DataFrame,
    params: StaticAllocationParams,
    asset_ids: list[str],
    rebalance_frequency: Frequency,
) -> tuple[dict[pd.Timestamp, dict[str, float]], list[str]]:
    """リバランス時に再最適化するための、実行日→ターゲットウェイトを返す。

    - 各シグナル日（頻度 D/W/M/Y の最終観測日）まで `prices.loc[:sig]` に
      スライスして `static_allocation` を実行する。スライスによりシグナル日以降の
      データを使わないためルックアヘッドを構造的に回避する（`static_allocation` は
      内部で時系列スライスしない設計を維持）。
    - 最適化に失敗（データ不足・達成不能な目標値など）した時点はスキップし、
      **直前のウェイトを継続**する。その旨を日本語警告に積む（ユーザー決定）。
    - `params`: 再最適化で使う最適化パラメータ。`asset_ids`: 最適化の対象資産
      （保存済み最適化の再現パラメータから渡す）。
    - 戻り値は「実行日（=シグナル日の翌観測日）→ウェイト」マップと警告一覧。
    """
    warnings: list[str] = []
    dates = pd.DatetimeIndex(prices.index)
    signals = _rebalance_signal_dates(dates, rebalance_frequency)
    exec_dates = _execution_dates(signals, dates)

    # 対象資産のみの列に限定しない場合は外側 union に他資産が混ざるため、
    # asset_ids の列だけを最適化に渡す（価格は外側 union でも構わない）。
    sub = prices[asset_ids].dropna(how="all")

    weights_by_exec: dict[pd.Timestamp, dict[str, float]] = {}
    failed = 0
    for sig, execd in zip(signals, exec_dates, strict=False):
        try:
            slice_df = sub.loc[:sig]
            result = static_allocation(slice_df, params)
        except OptimizationInputError as exc:
            failed += 1
            warnings.append(
                f"{sig.date().isoformat()} の再最適化に失敗したため、"
                f"直前のウェイトを継続しました: {exc.message}"
            )
            continue
        weights_by_exec[execd] = dict(result.clean_weights)

    if failed:
        warnings.insert(
            0,
            f"{failed} リバランス時点で再最適化に失敗したため、直前のウェイトを継続しました。",
        )
    return weights_by_exec, warnings


# 下位互換のため静的エイリアスを提供（ドメイン層のエントリポイント）。
optimize = static_allocation

__all__ = [
    "OptimizationInputError",
    "StaticAllocationParams",
    "optimize",
    "rebalance_allocation",
    "static_allocation",
]
