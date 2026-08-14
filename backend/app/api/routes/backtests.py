"""バックテストエンドポイント。

`POST /api/backtests` は固定ウェイト・リバランスのバックテスト（HTTP 非依存の
純粋計算）へ配線し、同期で結果を返す。ここではパラメータの受け渡し・価格行列の
整列・エラー変換のみ行い、計算はエンジン層に委ねる。

エラー方針:
- `BacktestInputError`（データ不足・非正価格など）は 400（日本語 message）へ変換。
- 未取得資産（`FileNotFoundError`）は資産集合が揃って初めて成立するため 400 で
  応答する（分析 API と異なり除外しない）。
- スキーマのバリデーション違反（ウェイト合計・キー不一致など）は 422。
"""

from __future__ import annotations

from typing import Annotated

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_settings
from app.api.route_helpers import load_price_matrix
from app.backtest.engine import BacktestInputError, run_backtest
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from app.optimization.service import (
    OptimizationInputError,
    rebalance_allocation,
)
from app.schemas.backtest import BacktestRequest, BacktestResult

router = APIRouter(tags=["backtest"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


def _verify_opt_assets(prices: pd.DataFrame, opt_asset_ids: list[str]) -> None:
    """再最適化で使う最適化対象資産が価格行列にあるか検証する。

    `optimization_params.asset_ids` が未取得・期間外の場合、価格行列に列が無く、
    再最適化が成立しないため 400 で中断する（除外しない）。
    """
    missing = [a for a in opt_asset_ids if a not in prices.columns]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="再最適化対象の資産が価格データにありません: " + "、".join(missing),
        )


@router.post("/backtests", response_model=BacktestResult)
def create_backtest(
    settings: SettingsDep,
    request: BacktestRequest,
) -> BacktestResult:
    """固定ウェイト・バックテストを実行し、結果一式を返す。

    `request.reoptimize=True` のときは、各リバランスシグナル日までスライスした
    データで `rebalance_allocation` を実行し、そのターゲットウェイトでリバランス
    する（ルックアヘッド回避）。失敗した時点は直前ウェイト継続＋警告。
    """
    repo = ParquetPriceRepository(settings.processed_dir)
    prices, load_warnings = load_price_matrix(
        repo, request.asset_ids, start=request.start, end=request.end
    )

    # 未取得・期間外の資産がある場合、資産集合が揃わないため 400（除外しない）。
    missing = [asset_id for asset_id in request.asset_ids if asset_id not in prices.columns]
    if missing:
        raise HTTPException(
            status_code=400,
            detail="データが未取得の資産があるためバックテストを実行できません: "
            + "、".join(missing),
        )
    if prices.empty:
        raise HTTPException(
            status_code=400, detail="指定期間に価格データがありません。期間を確認してください。"
        )

    weights_by_exec: dict[pd.Timestamp, dict[str, float]] = {}
    reopt_warnings: list[str] = []
    if request.reoptimize and request.optimization_params is not None:
        _verify_opt_assets(prices, request.optimization_params.asset_ids)
        try:
            weights_by_exec, reopt_warnings = rebalance_allocation(
                prices,
                request.optimization_params,
                request.optimization_params.asset_ids,
                request.rebalance_frequency,
            )
        except OptimizationInputError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        result = run_backtest(
            prices,
            request,
            currency=settings.instrument_trading_currency,
            weights_by_exec=weights_by_exec or None,
        )
    except BacktestInputError as exc:
        # ユーザーに理解可能な日本語メッセージのままエラーを顕在化させる。
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ルート層で検出した警告（欠落行情報・再最適化失敗など）をエンジン層の警告に連結。
    warnings_merged = list(load_warnings) + reopt_warnings + list(result.warnings)
    result.warnings = warnings_merged
    return result


__all__ = ["router"]