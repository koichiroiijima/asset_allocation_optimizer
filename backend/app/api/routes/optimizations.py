"""ポートフォリオ最適化エンドポイント。

`POST /api/optimizations` は `static_allocation`（HTTP 非依存の純粋計算）へ配線し、
同期で最適配分を返す。ここではパラメータの受け渡し・価格行列の整列・エラー変換のみ行い、
最適化計算はサービス層に委ねる。

エラー方針:
- `OptimizationInputError`（データ不足・制約矛盾・非正価格など）は 400
  （日本語 message）へ変換する。
- 未取得資産（`FileNotFoundError`）は最適化が資産集合の揃って初めて成立するため 400 で
  応答する（分析 API と異なり除外しない）。ルックアヘッドは `start`/`end` 入力で回避し、
  既定では全期間を使う。
"""

from __future__ import annotations

from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_settings
from app.api.route_helpers import load_price_matrix
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from app.optimization.service import OptimizationInputError, static_allocation
from app.schemas.optimization import OptimizationRequest, OptimizationResult

router = APIRouter(tags=["optimization"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


def _missing_assets_message(missing: list[str]) -> str:
    return "データが未取得の資産があるため最適化を実行できません: " + "、".join(missing)


@router.post("/optimizations", response_model=OptimizationResult)
def create_optimization(
    settings: SettingsDep,
    request: OptimizationRequest,
) -> OptimizationResult:
    """`static_allocation` を実行し、最適配分・指標・警告を返す。"""
    repo = ParquetPriceRepository(settings.processed_dir)
    prices: pd.DataFrame
    prices, load_warnings = load_price_matrix(
        repo, request.asset_ids, start=request.start, end=request.end
    )

    # 未取得・期間外の資産がある場合、資産集合が揃わないため 400（除外しない）。
    missing = [asset_id for asset_id in request.asset_ids if asset_id not in prices.columns]
    if missing:
        raise HTTPException(status_code=400, detail=_missing_assets_message(missing))
    if prices.empty:
        raise HTTPException(
            status_code=400, detail="指定期間に価格データがありません。期間を確認してください。"
        )

    try:
        result = static_allocation(prices, request)
    except OptimizationInputError as exc:
        # ユーザーに理解可能な日本語メッセージのままエラーを顕在化させる。
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ルート層で検出した警告（欠落行情報など）をサービス層の警告に連結して UI に返す。
    if load_warnings:
        result.warnings = load_warnings + list(result.warnings)
    return result


__all__ = ["router"]