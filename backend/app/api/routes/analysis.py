"""分析データエンドポイント。

processed Parquet から複数資産の価格推移・累積リターン・ローリングボラティリティ・
相関行列をまとめて返し、分析画面へ配線する。数値計算はドメイン層の純粋関数を
再利用し、ここでは配線・NaN 除外・頻度リサンプリングのみ行う（series ルートと同一方針）。
実データ未取得は例外を握りつぶさず、日本語警告として顕在化し、対象資産から除外する。
"""

from __future__ import annotations

from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends, Query

from app.api.deps import get_settings
from app.api.route_helpers import load_price_matrix
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from app.domain.returns import (
    correlation_matrix,
    cumulative_return,
    resample_prices,
    rolling_volatility,
    simple_return,
)
from app.schemas.analysis import AnalysisRequest, AnalysisResponse, AssetSeries, CorrelationMatrix
from app.schemas.series import SeriesPoint

router = APIRouter(tags=["data"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


def _to_points(series: pd.Series) -> list[SeriesPoint]:
    """NaN を除いた（date, value）点列を返す。値を推測補完しない。"""
    clean = series.dropna()
    return [
        SeriesPoint(date=d.date(), value=float(v))
        for d, v in zip(clean.index, clean.values, strict=True)
    ]


def _correlation_matrix_or_none(matrix: pd.DataFrame) -> CorrelationMatrix:
    """リターン行列から相関行列を返す。空行列は空の構造（例外にしない）。"""
    if matrix.empty:
        return CorrelationMatrix()
    corr = correlation_matrix(matrix)
    rows: list[list[float | None]] = []
    for _, row in corr.iterrows():
        rows.append([None if pd.isna(v) else float(v) for v in row.to_list()])
    return CorrelationMatrix(assets=list(corr.columns), matrix=rows)


@router.get("/data/analysis", response_model=AnalysisResponse)
def get_analysis(
    settings: SettingsDep,
    asset_ids: Annotated[list[str], Query(min_length=1)],
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    frequency: str = Query(default="D", pattern="^(D|W|M)$"),
    window: int = Query(default=60, ge=5, le=1000),
) -> AnalysisResponse:
    """分析画面用データを返す。未取得資産は除外し、日本語警告を添える。"""
    request = AnalysisRequest(
        asset_ids=asset_ids,
        start=pd.Timestamp(start).date() if start else None,
        end=pd.Timestamp(end).date() if end else None,
        frequency=frequency,  # type: ignore[arg-type]
        window=window,
    )
    warnings: list[str] = []
    repo = ParquetPriceRepository(settings.processed_dir)

    prices, load_warnings = load_price_matrix(
        repo, request.asset_ids, start=request.start, end=request.end
    )
    warnings.extend(load_warnings)
    used_assets = list(prices.columns)

    if not used_assets:
        # 全資産が未取得・期間外の場合は空レスポンス＋警告（例外にしない）。
        return AnalysisResponse(
            currency=settings.portfolio_base_currency,
            assets_used=[],
            window=request.window,
            correlation=CorrelationMatrix(),
            warnings=warnings,
        )

    # frequency が D 以外（W/M）のとき価格を先に再サンプリングする。
    # 価格 → 各期間の最終観測値（resample_prices）。その後リターン・累積・vol・相関を
    # 「期間リターン」から計算する（vol を複利合成する等の無意味な再サンプリングを避ける）。
    if request.frequency != "D":
        prices = prices.apply(resample_prices, frequency=request.frequency)  # type: ignore[call-arg]

    # 価格行列 → リターン系列（列=資産）。先頭は NaN。
    returns = prices.apply(simple_return)
    cumulative: pd.DataFrame = returns.apply(cumulative_return)
    vol: pd.DataFrame = returns.apply(
        rolling_volatility,
        window=request.window,
        annualization_factor=settings.annualization_factor,
    )

    # 相関は共通日付に整列したリターン行列から計算。単一資産は 1×1。
    corr = _correlation_matrix_or_none(returns)
    if len(used_assets) < 2:
        warnings.append("相関の解釈には2資産以上必要です。")

    return AnalysisResponse(
        currency=settings.portfolio_base_currency,
        assets_used=used_assets,
        window=request.window,
        prices=[AssetSeries(asset_id=a, points=_to_points(prices[a])) for a in used_assets],
        cumulative=[
            AssetSeries(asset_id=a, points=_to_points(cumulative[a])) for a in used_assets
        ],
        rolling_volatility=[
            AssetSeries(asset_id=a, points=_to_points(vol[a])) for a in used_assets
        ],
        correlation=corr,
        warnings=warnings,
    )


__all__ = ["router"]