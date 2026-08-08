"""API ルーター集約。`/api` プレフィックス配下に全サブルーターを集める。"""

from __future__ import annotations

from fastapi import APIRouter

from app.api import health
from app.api.routes import assets, jobs, runs, series

api_router = APIRouter(prefix="/api")
api_router.include_router(health.router)
api_router.include_router(assets.router)
api_router.include_router(series.router)
api_router.include_router(jobs.router)
api_router.include_router(runs.router)

__all__ = ["api_router"]
