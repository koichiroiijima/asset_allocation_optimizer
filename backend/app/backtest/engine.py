"""固定ウェイト・バックテストエンジン。

HTTP・DB に依存しない純粋計算層。`run_backtest(prices, params)` が日次の
ポートフォリオ評価・リバランス・評価指標を計算し、`BacktestResult` を返す。
ルックアヘッド回避は構造的に成立する:

1. 入力は `static_allocation` と同じ「price 系列（列=資産、行=日次調整済み終値、
   DatetimeIndex）」。リターン系列と混同しない。
2. 固定ウェイトのため配分計算にデータ窓（lookback）を使わない。`lookback` は
   予約パラメータとしてスキーマに保持し、将来の `rebalance_allocation` 導入時に
   「シグナル日より後のデータを使わない」を保証する層として利用する。
3. 約定日は「シグナル日の翌観測日」。シグナル日時点で翌日の売買内容が確定し、
   その約定日の価格でのみ売買をサイズ付けするため、未来情報を入力に使わない。

CLAUDE.md: 高い成績を「最適」「将来も有効」と表現しない。売買コスト・税金・
流動性・為替・価格インパクトの再現は限定的であることを設計仕様に記録する。
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from app.domain.returns import (
    annualize_return,
    annualize_volatility,
    simple_return,
)
from app.schemas.backtest import (
    AllocationPoint,
    BacktestMetrics,
    BacktestParams,
    BacktestResult,
    EquityPoint,
    Trade,
    YearlyPerformance,
)

# 売買の「変化なし」とみなす絶対値しきい値（浮動小数誤差対策）。
_DELTA_EPS = 1e-12


class BacktestInputError(ValueError):
    """バックテスト入力が不正（資産不足・データ不足・非正価格）のときに投げる。

    `message` はユーザーに理解可能な日本語、内部の例外は `origin` に保持して
    握りつぶさない。
    """

    def __init__(self, message: str, *, origin: Exception | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.origin = origin


def _ordered_assets(prices: pd.DataFrame) -> list[str]:
    """列順を崩さない資産リスト（空・重複はエラー）。"""
    if prices is None or prices.empty:
        raise BacktestInputError("価格データが空です")
    if prices.columns.has_duplicates:
        raise BacktestInputError("価格データの列（資産）名が重複しています")
    return list(prices.columns)


def _usable_prices(prices: pd.DataFrame, assets: list[str]) -> tuple[pd.DataFrame, list[str]]:
    """バックテストに使える価格行列へ整える。

    全資産が有効価格を持つ観測日のみに絞る（NaN 行は除外して警告に積み、
    推測補完しない）。非正価格・選択資産欠如・観測不足は `BacktestInputError`。
    """
    missing = [a for a in assets if a not in prices.columns]
    if missing:
        raise BacktestInputError(
            "バックテスト対象の資産が価格データにありません: " + "、".join(missing)
        )
    selected = prices.loc[:, assets].astype("float64")
    if (selected <= 0).any().any():
        raise BacktestInputError("価格データに 0 以下の値が含まれます。データを確認してください。")

    warnings: list[str] = []
    n_before = len(selected)
    clean = selected.dropna(axis=0)
    n_dropped = n_before - len(clean)
    if n_dropped:
        warnings.append(f"全資産の価格が揃わない行 {n_dropped} 行を除外しました")
    if len(clean) < 2:
        raise BacktestInputError(
            "バックテストに使える観測が少なすぎます（少なくとも2時点の価格が必要です）"
        )
    # index を元の DatetimeIndex として保証する（mypy: dropna 後は Index に退化するため）。
    clean.index = pd.DatetimeIndex(clean.index)
    return clean, warnings


def _normalize_weights(weights: dict[str, float]) -> dict[str, float]:
    """合計 1 へ正規化したウェイトを返す。"""
    total = sum(weights.values())
    if total <= 0:
        raise BacktestInputError("ウェイトの合計が 0 以下です")
    return {a: w / total for a, w in weights.items()}


def _rebalance_signal_dates(dates: pd.DatetimeIndex, freq: str) -> list[pd.Timestamp]:
    """リバランスのシグナル日（判定日）を返す。

    - `D`: 初日を除く全観測日。
    - `W`/`M`: 各期間（週/月）の最終観測日（`resample_*` と同じ集約規則。
      pandas 既定アンカーに委ねる。design.md の保留事項）。
    """
    if freq == "D":
        return [pd.Timestamp(d) for d in dates[1:]]
    grouper_freq = "W" if freq == "W" else "ME"
    series = pd.Series(dates, index=dates)
    signals: list[pd.Timestamp] = []
    for _, grp in series.groupby(pd.Grouper(freq=grouper_freq)):
        if len(grp):
            last = pd.Timestamp(grp.index[-1])
            if last > dates[0]:
                signals.append(last)
    return signals


def _execution_dates(signals: list[pd.Timestamp], dates: pd.DatetimeIndex) -> list[pd.Timestamp]:
    """シグナル日の「次の観測日」を約定日とする。シグナル日以後に観測が無ければ不発火。"""
    arr = np.asarray(dates, dtype="datetime64[ns]")
    result: list[pd.Timestamp] = []
    for s in signals:
        nxt = arr[arr > np.datetime64(s)]
        if len(nxt):
            result.append(pd.Timestamp(nxt[0]))
    return result


def _simulate(
    prices: pd.DataFrame,
    weights: dict[str, float],
    execution_dates: set[pd.Timestamp],
    initial_capital: float,
    cost_rate: float,
) -> tuple[np.ndarray, list[Trade], float, list[dict[str, float]]]:
    """ポートフォリオを前進ループで評価し、equity・取引・回転率寄与・配分を返す。

    - 初日 t0 は初期投資（全資産を BUY。初期手数料も賦課し取引一覧に記録）。
    - 約定日は保有をターゲットウェイトへ戻す（差額のみ売買・両建て手数料）。
    - リバランス日以外は shares/cash を不変に保ち、日次で評価額を記録する。
    """
    assets = list(weights)
    dates = prices.index
    n = len(dates)

    prices_array = prices.to_numpy(dtype="float64")  # (n_obs, n_assets)

    # 初日 t0: 初期投資
    p0 = prices_array[0]
    shares: dict[str, float] = {}
    trades: list[Trade] = []
    cash = initial_capital
    for j, a in enumerate(assets):
        target_value = initial_capital * weights[a]
        if target_value < _DELTA_EPS:
            shares[a] = 0.0
            continue
        price0 = float(p0[j])
        shares[a] = target_value / price0
        trades.append(
            Trade(
                date=dates[0].date(),
                asset_id=a,
                side="BUY",
                quantity=shares[a],
                price=price0,
                value=target_value,
                fee=cost_rate * target_value,
            )
        )
        cash -= target_value

    turnover_contrib = 0.0

    equity = np.empty(n, dtype="float64")
    allocation: list[dict[str, float]] = []

    for i, d in enumerate(dates):
        row = prices_array[i]
        mktval = {a: shares[a] * float(row[j]) for j, a in enumerate(assets)}
        equity_i = sum(mktval.values()) + cash
        equity[i] = equity_i
        allocation.append({a: (mktval[a] / equity_i) if equity_i > 0 else 0.0 for a in assets})

        if d in execution_dates:
            targets = {a: equity_i * weights[a] for a in assets}
            deltas = {a: targets[a] - mktval[a] for a in assets}
            if equity_i > 0:
                turnover_contrib += 0.5 * sum(abs(v) for v in deltas.values()) / equity_i
            for j, a in enumerate(assets):
                delta = deltas[a]
                if abs(delta) < _DELTA_EPS:
                    continue
                side = "BUY" if delta > 0 else "SELL"
                price = float(row[j])
                new_shares = targets[a] / price
                quantity = abs(new_shares - shares[a])
                shares[a] = new_shares
                trades.append(
                    Trade(
                        date=d.date(),
                        asset_id=a,
                        side=side,
                        quantity=quantity,
                        price=price,
                        value=abs(delta),
                        fee=cost_rate * abs(delta),
                    )
                )
            # 手数料を現金から差し引く（売買の size は equity_i ベースで決定済みのため後付）
            fee_total = cost_rate * sum(abs(v) for v in deltas.values())
            cash -= fee_total

    return equity, trades, turnover_contrib, allocation


def _to_optional(value: float) -> float | None:
    """非有限・NaN は None へ変換（JSON 不正を避ける）。"""
    if value is None or not math.isfinite(value):
        return None
    return float(value)


def _drawdown_series(equity: np.ndarray, dates: pd.DatetimeIndex) -> list[EquityPoint]:
    """ドローダウン率（負値）系列を返す。"""
    s = pd.Series(equity, index=dates)
    dd = s / s.cummax() - 1.0
    return [
        EquityPoint(date=d.date(), value=float(v))
        for d, v in zip(dd.index, dd.values, strict=True)
    ]


def _yearly_performances(equity: np.ndarray, dates: pd.DatetimeIndex) -> list[YearlyPerformance]:
    """暦年の複利リターン（前年最終観測日基準）を返す。"""
    s = pd.Series(equity, index=pd.DatetimeIndex(dates))
    years_index = s.index.year  # type: ignore[attr-defined]
    results: list[YearlyPerformance] = []
    prev_last: float | None = None
    for year, grp in s.groupby(years_index):
        cur_last = float(grp.iloc[-1])
        if prev_last is not None:
            results.append(
                YearlyPerformance(year=int(year), period_return=cur_last / prev_last - 1.0)
            )
        prev_last = cur_last
    return results


def _compute_metrics(
    equity: np.ndarray,
    params: BacktestParams,
    total_fees: float,
    turnover: float,
    warnings: list[str],
) -> BacktestMetrics:
    """日次ポートフォリオリターンから評価指標を計算する。未定義は None。

    - `warnings`: 未定義になった指標を日本語で追記する（呼び出し側のリストを破壊）。
    """
    factor = params.annualization_factor
    risk_free_rate = params.risk_free_rate
    series = pd.Series(equity, dtype="float64")

    cumulative = float(series.iloc[-1] / params.initial_capital - 1.0)

    ret = simple_return(series).dropna()
    annual_return = _to_optional(annualize_return(ret, factor, method="geometric"))
    annual_vol = _to_optional(annualize_volatility(ret, factor))
    max_dd = _to_optional(float((series / series.cummax() - 1.0).min()))

    sharpe: float | None = None
    if annual_return is not None and annual_vol is not None and annual_vol > 0:
        sharpe = (annual_return - risk_free_rate) / annual_vol
    else:
        warnings.append("シャープレシオは定義できません（年率ボラティリティが 0 または計算不能）")

    sortino: float | None = None
    negative = ret[ret < 0]
    if len(negative) > 0:
        downside_dev = math.sqrt(float((negative**2).mean())) * math.sqrt(factor)
        if annual_return is not None and downside_dev > 0:
            sortino = (annual_return - risk_free_rate) / downside_dev
        else:
            warnings.append("ソルティノレシオは定義できません（下方偏差が 0 または計算不能）")

    calmar: float | None = None
    if annual_return is not None and max_dd is not None and max_dd != 0:
        calmar = annual_return / abs(max_dd)
    else:
        warnings.append("カルマーレシオは定義できません（最大ドローダウンが 0 または計算不能）")

    valid = ret[ret.abs() > 1e-12]
    win_rate: float | None = None
    if len(valid) > 0:
        win_rate = float((valid > 0).mean())

    return BacktestMetrics(
        cumulative_return=cumulative,
        annual_return=annual_return,
        annual_volatility=annual_vol,
        sharpe_ratio=sharpe,
        sortino_ratio=sortino,
        calmar_ratio=calmar,
        max_drawdown=max_dd,
        win_rate=win_rate,
        turnover=turnover,
        total_fees=total_fees,
    )


def run_backtest(
    prices: pd.DataFrame,
    params: BacktestParams,
    *,
    currency: str = "",
) -> BacktestResult:
    """固定ウェイト・バックテストを実行し、結果一式を返す。

    - `prices`: 列=資産、行=日次 adjusted_close（DatetimeIndex 昇順）。
    - `params`: 固定ウェイト・リバランス頻度・初期資金・コスト率など。
    - ルックアヘッド回避は「約定日=シグナル日の翌観測日」構造により保証される。
    """
    assets = _ordered_assets(prices)
    usable, load_warnings = _usable_prices(prices, assets)
    weights = _normalize_weights(params.weights)

    dates = pd.DatetimeIndex(usable.index)
    signals = _rebalance_signal_dates(dates, params.rebalance_frequency)
    exec_dates = _execution_dates(signals, dates)

    equity, trades, turnover_contrib, allocation = _simulate(
        usable,
        weights,
        set(exec_dates),
        params.initial_capital,
        params.cost_rate,
    )

    total_fees = sum(t.fee for t in trades)

    years = (dates[-1] - dates[0]).days / 365.25
    turnover = turnover_contrib / years if years > 0 else 0.0

    warnings = list(load_warnings)
    metrics = _compute_metrics(equity, params, total_fees, turnover, warnings)

    return BacktestResult(
        asset_ids=assets,
        params=params,
        currency=currency,
        metrics=metrics,
        equity_curve=[
            EquityPoint(date=d.date(), value=float(v))
            for d, v in zip(dates, equity, strict=True)
        ],
        drawdown=_drawdown_series(equity, dates),
        yearly=_yearly_performances(equity, dates),
        allocation=[
            AllocationPoint(date=d.date(), weights=w)
            for d, w in zip(dates, allocation, strict=True)
        ],
        trades=trades,
        warnings=warnings,
    )


__all__ = ["BacktestInputError", "run_backtest"]
