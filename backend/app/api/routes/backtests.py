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

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_settings
from app.api.route_helpers import load_price_matrix
from app.backtest.engine import BacktestInputError, run_backtest
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from app.schemas.backtest import BacktestRequest, BacktestResult

router = APIRouter(tags=["backtest"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.post("/backtests", response_model=BacktestResult)
def create_backtest(
    settings: SettingsDep,
    request: BacktestRequest,
) -> BacktestResult:
    """固定ウェイト・バックテストを実行し、結果一式を返す。"""
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

    try:
        result = run_backtest(
            prices,
            request,
            currency=settings.instrument_trading_currency,
        )
    except BacktestInputError as exc:
        # ユーザーに理解可能な日本語メッセージのままエラーを顕在化させる。
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ルート層で検出した警告（欠落行情報など）をエンジン層の警告に連結して UI に返す。
    if load_warnings:
        result.warnings = load_warnings + list(result.warnings)
    return result


__all__ = ["router"]