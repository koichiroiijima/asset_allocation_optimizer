"""データ系列エンドポイント。

processed Parquet から正規化済み系列（価格・リターン・累積）を返す。
数値計算はドメイン層（`app.domain.returns`）の純粋関数を再利用し、
ここでは配線・NaN 除外・回数再サンプリングを行う。実データ未取得は
例外を握りつぶさず、日本語警告として顕在化させる。
"""

from __future__ import annotations

from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends

from app.api.deps import get_settings
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from app.domain.assets import base_currency_for_assets
from app.domain.returns import (
    cumulative_return,
    resample_prices,
    resample_returns,
    simple_return,
)
from app.schemas.series import SeriesPoint, SeriesResponse, SeriesSpec

router = APIRouter(tags=["data"])

SettingsDep = Annotated[Settings, Depends(get_settings)]
SeriesSpecDep = Annotated[SeriesSpec, Depends()]

# 系列種別ごとの変換規則（価格系 → 列、リターン系 → ドメイン関数）
_TYPE_COLUMN = {"adjusted_close": "adjusted_close", "price": "raw_close"}


def _convert_series(series_type: str, adjusted: pd.Series, raw: pd.Series) -> pd.Series:
    """series_type に応じた系列へ変換して返す（昇順済み Series 入力想定）。"""
    if series_type in _TYPE_COLUMN:
        return adjusted if series_type == "adjusted_close" else raw
    if series_type == "return":
        return simple_return(adjusted)
    if series_type == "cumulative":
        return cumulative_return(simple_return(adjusted))
    raise ValueError(f"未知の series_type: {series_type!r}")


@router.get("/data/series", response_model=SeriesResponse)
def get_series(settings: SettingsDep, spec: SeriesSpecDep) -> SeriesResponse:
    """指定された系列仕様に応じた正規化済み系列を返す。"""
    warnings: list[str] = []
    repo = ParquetPriceRepository(settings.processed_dir)
    # 価格データの通貨を返す（実データの通貨。未取得時は資産の基準通貨へフォールバック）。
    fallback_currency = base_currency_for_assets([spec.asset_id])
    try:
        df = repo.load_series(spec.asset_id, spec.start, spec.end)
    except FileNotFoundError:
        # データ未取得：空系列＋警告で明示（例外を握りつぶさない）
        return SeriesResponse(
            asset_id=spec.asset_id,
            currency=fallback_currency,
            series_type=spec.series_type,
            warnings=[
                f"データが未取得です（{spec.asset_id}）。先にデータ取得 CLI を実行してください。"
            ],
        )

    if df.empty:
        return SeriesResponse(
            asset_id=spec.asset_id,
            currency=fallback_currency,
            series_type=spec.series_type,
            warnings=["指定期間にデータがありません。"],
        )

    df = df.sort_values("date")
    # データレコードの通貨列（例: USD）。同一資産で混在しない前提だが、不明な場合は設定値を用いる。
    data_currency = str(df["currency"].iloc[0]) if "currency" in df.columns else fallback_currency
    adjusted = df.set_index("date")["adjusted_close"].astype("float64")
    raw = df.set_index("date")["raw_close"].astype("float64")

    values: pd.Series = _convert_series(spec.series_type, adjusted, raw)

    # frequency が D 以外（W/M）のとき再サンプリング。
    # リターン系は複利合成（resample_returns）、価格系は最終観測値（resample_prices）。
    if spec.frequency != "D":
        if spec.series_type in ("return", "cumulative"):
            values = resample_returns(values, spec.frequency)
        else:
            values = resample_prices(values, spec.frequency)

    # NaN の点は JSON 出力から除外（欠損は missing 集計・警告で顕在化）。
    values = values.dropna()

    points = [
        SeriesPoint(date=d.date(), value=float(v))
        for d, v in zip(values.index, values.values, strict=True)
    ]

    return SeriesResponse(
        asset_id=spec.asset_id,
        currency=data_currency,
        series_type=spec.series_type,
        points=points,
        warnings=warnings,
    )


__all__ = ["router"]
