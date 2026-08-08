"""実行結果（Run）エンドポイント（プレースホルダー）。

バックテスト／最適化の実行結果は後続工程で設定・データバージョンと共に保存する。
ここではレスポンス形状のみを提供する。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas.job import RunEquitySeries, RunSummary, RunTrades

router = APIRouter(tags=["runs"])

# メモリ内ストア（後続工程で SQLite へ移行）
_runs: dict[str, RunSummary] = {}


def _get_run_or_404(run_id: str) -> RunSummary:
    run = _runs.get(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"実行結果が見つかりません: {run_id}")
    return run


@router.get("/runs/{run_id}", response_model=RunSummary)
def get_run(run_id: str) -> RunSummary:
    """実行結果の概要を返す。"""
    return _get_run_or_404(run_id)


@router.get("/runs/{run_id}/equity-curve", response_model=RunEquitySeries)
def get_equity_curve(run_id: str) -> RunEquitySeries:
    """累積損益（equity curve）を返す（プレースホルダー）。"""
    result = _get_run_or_404(run_id)
    return RunEquitySeries.model_validate(result.model_dump())


@router.get("/runs/{run_id}/trades", response_model=RunTrades)
def get_trades(run_id: str) -> RunTrades:
    """取引一覧を返す（プレースホルダー）。"""
    result = _get_run_or_404(run_id)
    return RunTrades.model_validate(result.model_dump())


__all__ = ["router"]
