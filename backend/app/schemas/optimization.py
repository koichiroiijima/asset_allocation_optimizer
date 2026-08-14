"""最適化の API スキーマ（static_allocation 用）。

CLAUDE.md: 最適化サービスはデータ期間・リターン頻度（年率換算）・リスクフリー金利・
ウェイト上下限・合計ウェイト・取引コストを明示的な入力として受け取る。ここでは
`static_allocation`（現在ウェイトを使わない単発の資産配分）の入力と結果の型契約を定義する。
手法の選択肢は CLAUDE.md「最低限、以下を選択可能にする」に従う。
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

OptimizationMethod = Literal["max_sharpe", "min_volatility", "efficient_risk", "efficient_return"]
ExpectedReturnMethod = Literal["mean_historical_return", "capm_return", "ema_historical_return"]
CovarianceMethod = Literal["sample_cov", "semicovariance", "ledoit_wolf"]


class StaticAllocationParams(BaseModel):
    """`static_allocation` の入力（手法・推定方法・制約）。

    - `optimization_method`: Efficient Frontier の目的関数。
    - `expected_return_method`: 期待リターン推定。`capm_return` はベンチマーク系列が別途
      必要（サービス側で検証）。
    - `covariance_method`: 共分散推定。`ledoit_wolf` は収縮（shrinkage）推定。
    - `weight_bounds`: 全資産共通のウェイト上下限（既定 0–1、ロングオンリー）。
    - `asset_weight_bounds`: 資産ごとの上下限で `weight_bounds` を上書きする。
    - `target_return` / `target_volatility`: 各々 `efficient_return` / `efficient_risk`
      に必要な目標値。
    """

    optimization_method: OptimizationMethod = "max_sharpe"
    expected_return_method: ExpectedReturnMethod = "mean_historical_return"
    covariance_method: CovarianceMethod = "sample_cov"
    risk_free_rate: float = 0.0
    annualization_factor: int = Field(default=252, ge=1)
    weight_bounds: tuple[float, float] = (0.0, 1.0)
    asset_weight_bounds: dict[str, tuple[float, float]] = Field(default_factory=dict)
    target_return: float | None = None
    target_volatility: float | None = None

    @model_validator(mode="after")
    def _validate_bounds(self) -> "StaticAllocationParams":
        """ウェイト上下限の整合性（lower <= upper、負の下限を拒否）。"""
        low, high = self.weight_bounds
        if low < 0:
            raise ValueError("weight_bounds の下限を負にはできません")
        if low > high:
            raise ValueError(f"weight_bounds が不正: lower={low} > upper={high}")
        for name, (a, b) in self.asset_weight_bounds.items():
            if a < 0:
                raise ValueError(f"{name} のウェイト下限を負にはできません")
            if a > b:
                raise ValueError(f"{name} のウェイト上下限が不正: lower={a} > upper={b}")
        return self

    @model_validator(mode="after")
    def _validate_target(self) -> "StaticAllocationParams":
        """手法に応じた目標値の必須／不要の検証。"""
        if self.optimization_method == "efficient_return" and self.target_return is None:
            raise ValueError("efficient_return には target_return が必要です")
        if self.optimization_method == "efficient_risk" and self.target_volatility is None:
            raise ValueError("efficient_risk には target_volatility が必要です")
        return self


class OptimizationRequest(StaticAllocationParams):
    """`POST /api/optimizations` のリクエストボディ。

    `StaticAllocationParams` の最適化パラメータに、対象資産一覧と入力価格の期間を
    フラットに足したもの。期間（`start`/`end`）でルックアヘッドを防ぐ（サービスは
    時系列スライスを行わないため、将来データ混入は呼び出し側が排除して保証する）。
    """

    asset_ids: list[str] = Field(min_length=1)
    start: date | None = None
    end: date | None = None


class OptimizationMetrics(BaseModel):
    """最適配分の期待値指標（年率換算）。

    `asset_returns` / `asset_volatilities` は個別資産ごとの年率期待リターン／年率ボラ
    （最適化に使った期待リターン推定 `mu` と共分散 `sigma` の対角から算出）。
    """

    expected_annual_return: float
    annual_volatility: float
    sharpe_ratio: float
    asset_returns: dict[str, float] = Field(default_factory=dict)
    asset_volatilities: dict[str, float] = Field(default_factory=dict)


class OptimizationResult(BaseModel):
    """`static_allocation` の結果。

    `weights` は丸め**前**の生のウェイト（合計 1 に正規化済み）。`clean_weights` は
    表示用に丸めたウェイト。CLAUDE.md: 重みは丸める前の値を保存し、表示用に丸める。
    """

    method: OptimizationMethod
    weights: dict[str, float] = Field(default_factory=dict)
    clean_weights: dict[str, float] = Field(default_factory=dict)
    metrics: OptimizationMetrics
    params: StaticAllocationParams
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "CovarianceMethod",
    "ExpectedReturnMethod",
    "OptimizationMethod",
    "OptimizationMetrics",
    "OptimizationRequest",
    "OptimizationResult",
    "StaticAllocationParams",
]
