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
ExpectedReturnMethod = Literal[
    "mean_historical_return", "capm_return", "ema_historical_return", "black_litterman"
]
CovarianceMethod = Literal["sample_cov", "semicovariance", "ledoit_wolf"]
BlOmegaMethod = Literal["default", "idzorek"]

# Black-Litterman の既定市場ポートフォリオウェイト（ユーザー設定）。
# 米国株式/債券と除く株式/債券の時価総額(126.7/145.1兆USD)と株式/債券配分から合成した
# 4資産ウェイト。GUI のデフォルト入力としても使用する（設計: docs/design.md）。
DEFAULT_MARKET_WEIGHTS: dict[str, float] = {
    "us_equity": 0.2288,
    "us_bond": 0.2140,
    "ex_us_equity": 0.2373,
    "ex_us_bond": 0.3198,
}

# 日本モード（jp）の BL 既定市場ポートフォリオウェイト（**仮値**・研究用）。
# 日本株/日本債券/外国株/外国債の配分はユーザーが後で調整する前提の暫定値。
# UI と docs で「仮」と明記する（docs/design.md）。
DEFAULT_MARKET_WEIGHTS_JP: dict[str, float] = {
    "jp_equity": 0.25,
    "jp_bond": 0.35,
    "ex_jp_equity": 0.25,
    "ex_jp_bond": 0.15,
}

DEFAULT_MARKET_WEIGHTS_BY_SET: dict[str, dict[str, float]] = {
    "us": DEFAULT_MARKET_WEIGHTS,
    "jp": DEFAULT_MARKET_WEIGHTS_JP,
}


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
    # --- Black-Litterman 用（expected_return_method="black_litterman" のときのみ使用） ---
    # 市場ポートフォリオのウェイト（資産ID→比率、合計1）。None なら DEFAULT_MARKET_WEIGHTS。
    bl_market_weights: dict[str, float] | None = None
    # 絶対ビュー（年率期待リターン（r_f込み）の水準。資産ID→率）。
    bl_views: dict[str, float] = Field(default_factory=dict)
    # ビューの確信度（0-1）。bl_omega_method="idzorek" のとき必須。
    bl_view_confidences: dict[str, float] = Field(default_factory=dict)
    # ビュー不確実性の決定方法（default=分散に比例／idzorek=確信度から算出）。
    bl_omega_method: BlOmegaMethod = "default"
    bl_tau: float = 0.05
    # リスク回避度。None=市場ポートフォリオのリターンから逆算。
    bl_risk_aversion: float | None = None

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

    @model_validator(mode="after")
    def _validate_black_litterman(self) -> "StaticAllocationParams":
        """BL 用パラメータの値域・整合を検証する（資産照合はリクエスト層で行う）。"""
        if not (0.0 < self.bl_tau <= 1.0):
            raise ValueError("bl_tau は 0 より大きく 1 以下で指定してください")
        if self.bl_risk_aversion is not None and self.bl_risk_aversion <= 0.0:
            raise ValueError("bl_risk_aversion は正の値で指定してください")
        for name, conf in self.bl_view_confidences.items():
            if not (0.0 <= conf <= 1.0):
                raise ValueError(f"ビュー確信度は 0〜1 で指定してください（{name}: {conf}）")
        if self.bl_market_weights is not None:
            for name, w in self.bl_market_weights.items():
                if w < 0.0 or w > 1.0:
                    raise ValueError(
                        f"市場ポートフォリオのウェイトは 0〜1 で指定してください（{name}: {w}）"
                    )
            total = sum(self.bl_market_weights.values())
            if abs(total - 1.0) > 1e-3:
                raise ValueError(
                    f"市場ポートフォリオのウェイトの合計が 1 になりません（合計: {total:.4f}）"
                )
        if (
            self.bl_omega_method == "idzorek"
            and self.bl_views
            and not set(self.bl_view_confidences).issuperset(self.bl_views)
        ):
            raise ValueError("bl_omega_method=idzorek のときは全てのビューに確信度が必要です")
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

    @model_validator(mode="after")
    def _validate_bl_assets(self) -> "OptimizationRequest":
        """BL のビュー・市場ポートフォリオのキーが選択資産内であることを検証する。"""
        if self.expected_return_method != "black_litterman":
            return self
        unknown_views = set(self.bl_views) - set(self.asset_ids)
        if unknown_views:
            raise ValueError(
                "ビューの対象は選択資産内で指定してください: " + "、".join(sorted(unknown_views))
            )
        if self.bl_market_weights is not None:
            unknown_mkt = set(self.bl_market_weights) - set(self.asset_ids)
            if unknown_mkt:
                raise ValueError(
                    "市場ポートフォリオの対象は選択資産内で指定してください: "
                    + "、".join(sorted(unknown_mkt))
                )
        return self


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
    # 基準通貨（us モード=USD / jp モード=JPY）。ルート層で選択資産から設定する。
    base_currency: str = ""
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "BlOmegaMethod",
    "CovarianceMethod",
    "DEFAULT_MARKET_WEIGHTS",
    "DEFAULT_MARKET_WEIGHTS_BY_SET",
    "DEFAULT_MARKET_WEIGHTS_JP",
    "ExpectedReturnMethod",
    "OptimizationMethod",
    "OptimizationMetrics",
    "OptimizationRequest",
    "OptimizationResult",
    "StaticAllocationParams",
]
