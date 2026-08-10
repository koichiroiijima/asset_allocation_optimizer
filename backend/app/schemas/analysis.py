"""分析画面用データ（価格推移・累積リターン・ローリングボラ・相関）の API スキーマ。

`GET /api/data/analysis` のクエリとレスポンスを定義する。複数資産をまとめて返すため、
既存の単一資産 `SeriesResponse` の `points` 形状を資産ごとの `AssetSeries` に拡張する。
欠損値は補完せず JSON では `null` として明示する（CLAUDE.md: 推測補完しない）。
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field

from app.schemas.series import Frequency, SeriesPoint

# ローリング窓の許容範囲（日次観測の想定。設定と分離し API 契約に明示する）。
WINDOW_MIN = 5
WINDOW_MAX = 1000
WINDOW_DEFAULT = 60


class AnalysisRequest(BaseModel):
    """`GET /api/data/analysis` のクエリ条件。"""

    asset_ids: list[str] = Field(min_length=1)
    start: date | None = None
    end: date | None = None
    frequency: Frequency = "D"
    window: int = Field(default=WINDOW_DEFAULT, ge=WINDOW_MIN, le=WINDOW_MAX)


class AssetSeries(BaseModel):
    """単一資産の（date, value）系列。値は NaN を除いた実観測のみ。"""

    asset_id: str
    points: list[SeriesPoint] = Field(default_factory=list)


class CorrelationMatrix(BaseModel):
    """資産間のピアソン相関行列。欠損セルは null（補完しない）。"""

    assets: list[str] = Field(default_factory=list)
    matrix: list[list[float | None]] = Field(default_factory=list)


class AssetStats(BaseModel):
    """単一資産のリターン統計（分析画面の統計表用）。

    値は欠損を補完せず、観測不足・全 NaN は `null` で返す（金融データの推測補完を
    禁止する CLAUDE.md 方針と一致）。
    """

    asset_id: str
    mean_annual_return: float | None = None
    ema_annual_return: float | None = None
    annual_volatility: float | None = None
    sharpe_ratio: float | None = None


class AnalysisResponse(BaseModel):
    """分析画面が 1 リクエストで表示するデータ一式。"""

    currency: str
    assets_used: list[str] = Field(default_factory=list)
    window: int
    prices: list[AssetSeries] = Field(default_factory=list)
    cumulative: list[AssetSeries] = Field(default_factory=list)
    rolling_volatility: list[AssetSeries] = Field(default_factory=list)
    correlation: CorrelationMatrix
    stats: list[AssetStats] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


__all__ = [
    "AnalysisRequest",
    "AnalysisResponse",
    "AssetSeries",
    "AssetStats",
    "CorrelationMatrix",
    "SeriesPoint",
]