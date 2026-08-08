"""ヘルスチェックエンドポイント。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app import __version__
from app.api.deps import get_settings
from app.config import Settings

router = APIRouter(tags=["health"])

SettingsDep = Annotated[Settings, Depends(get_settings)]


@router.get("/health")
def health(settings: SettingsDep) -> dict[str, str]:
    """サービス稼働状態を返す。"""
    return {
        "status": "ok",
        "app": "asset-allocation-optimizer",
        "version": __version__,
        "app_env": settings.app_env,
    }


__all__ = ["router"]
