"""バックテストの API スキーマ（固定ウェイト・リバランス）。

設計判断（docs/design.md §7.3）:
- `weights` は全資産分のキーを必須とし、合計が 1 に近いこと（浮動小数誤差許容）を検証する。
- `lookback` は予約パラメータ（既定 252）。固定ウェイトではエンジンは配分計算に使わないが、
  入力・再現性のために保持し、将来の rebalance_allocation 導入時に使用する。
- 評価指標は未定義（観測不足・ゼロ除算）の場合 `null`（`float | None`）で返し、フロントは「—」表示。
"""

from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.optimization import OptimizationRequest
from app.schemas.series import Frequency

RebalanceFrequency = Frequency


class BacktestParams(BaseModel):
    """固定ウェイト・バックテストの入力（手法・コスト・初期資金）。

    - `weights`: 資産ID→固定ウェイト（合計 1・各 0〜1）。
    - `rebalance_frequency`: D/W/M。約定日はシグナル日の翌観測日。
    - `cost_rate`: 売買手数料率（両建てレッグ通貨ベース。0.001 = 0.1%）。
    - `lookback`: 予約パラメータ（固定ウェイトでは未使用・echo 用）。
    """

    weights: dict[str, float] = Field(min_length=1)
    rebalance_frequency: RebalanceFrequency = "M"
    initial_capital: float = Field(default=1_000_000, gt=0)
    cost_rate: float = Field(default=0.0, ge=0.0, lt=1.0)
    risk_free_rate: float = 0.0
    annualization_factor: int = Field(default=252, ge=1)
    lookback: int = Field(default=252, ge=1)
    reoptimize: bool = False
    optimization_params: OptimizationRequest | None = None

    @model_validator(mode="after")
    def _validate_weights(self) -> BacktestParams:
        """ウェイトが 0〜1・合計 1（誤差許容）を検証する。"""
        for asset_id, w in self.weights.items():
            if not 0.0 <= w <= 1.0:
                raise ValueError(f"ウェイトは 0〜1 で指定してください（{asset_id}: {w}）")
        if abs(sum(self.weights.values()) - 1.0) > 1e-4:
            raise ValueError(
                f"ウェイトの合計が 1 になりません（現在: {sum(self.weights.values()):.6f}）"
            )
        return self

    @model_validator(mode="after")
    def _validate_reoptimize(self) -> BacktestParams:
        """再最適化フラグが立っているときは最適化パラメータの指定を必須にする。"""
        if self.reoptimize and self.optimization_params is None:
            raise ValueError(
                "reoptimize=True のときは optimization_params（再最適化に使う最適化パラメータ）"
                "が必要です"
            )
        return self


class BacktestRequest(BacktestParams):
    """`POST /api/backtests` のリクエストボディ。

    `BacktestParams` に、対象資産一覧と入力価格の期間をフラットに足したもの。
    ルックアヘッド回避はエンジンの「次営業日約定」が担い、期間（`start`/`end`）は
    使用する価格データの範囲を決める。
    """

    asset_ids: list[str] = Field(min_length=1)
    start: date | None = None
    end: date | None = None

    @model_validator(mode="after")
    def _validate_weights_keys(self) -> BacktestRequest:
        """`weights` のキーが `asset_ids` と一致することを検証する。"""
        if set(self.weights) != set(self.asset_ids):
            missing = sorted(set(self.asset_ids) - set(self.weights))
            extra = sorted(set(self.weights) - set(self.asset_ids))
            raise ValueError(
                "weights のキーは asset_ids と一致させる必要があります"
                f"（不足: {missing or 'なし'} / 余分: {extra or 'なし'}）"
            )
        return self


class BacktestMetrics(BaseModel):
    """バックテストの評価指標（年率換算あり。未定義は null）。"""

    cumulative_return: float | None = None
    annual_return: float | None = None
    annual_volatility: float | None = None
    sharpe_ratio: float | None = None
    sortino_ratio: float | None = None
    calmar_ratio: float | None = None
    max_drawdown: float | None = None
    win_rate: float | None = None
    turnover: float | None = None
    total_fees: float = 0.0


class Trade(BaseModel):
    """1 レッグの売買。約定日の値でサイズ付けされる。"""

    date: date
    asset_id: str
    side: Literal["BUY", "SELL"]
    quantity: float
    price: float
    value: float
    fee: float


class AllocationPoint(BaseModel):
    """日次の実測ウェイト（ドリフト含む）。"""

    date: date
    weights: dict[str, float]


class YearlyPerformance(BaseModel):
    """暦年の複利リターン（前年最終観測日基準）。"""

    year: int
    period_return: float


class EquityPoint(BaseModel):
    """日次の評価額（またはドローダウン率）の点。"""

    date: date
    value: float


class BacktestResult(BaseModel):
    """固定ウェイト・バックテストの結果一式。"""

    asset_ids: list[str] = Field(default_factory=list)
    params: BacktestParams
    currency: str = ""
    metrics: BacktestMetrics
    equity_curve: list[EquityPoint] = Field(default_factory=list)
    drawdown: list[EquityPoint] = Field(default_factory=list)
    yearly: list[YearlyPerformance] = Field(default_factory=list)
    allocation: list[AllocationPoint] = Field(default_factory=list)
    trades: list[Trade] = Field(default_factory=list)
    rebalance_weights: list[AllocationPoint] | None = None
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "AllocationPoint",
    "BacktestMetrics",
    "BacktestParams",
    "BacktestRequest",
    "BacktestResult",
    "EquityPoint",
    "RebalanceFrequency",
    "Trade",
    "YearlyPerformance",
]
