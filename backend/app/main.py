"""FastAPI アプリケーションエントリポイント。

`create_app(settings=...)` のファクトリでアプリを組み立てる。テストでは設定を注入して
独立したアプリを起動できる（DI）。
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.api.router import api_router
from app.config import Settings, get_settings, validate_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """設定を注入して FastAPI アプリを構築する。"""
    if settings is None:
        settings = get_settings()
    validate_settings(settings)

    app = FastAPI(
        title="アセット配分最適化",
        description=(
            "4資産（米国株式・米国債券・米国を除く株式・米国を除く債券）の"
            "データ収集・ポートフォリオ最適化・バックテストを行う研究用アプリ。"
            "投資助言や将来リターンの保証を行うものではない。"
        ),
        version=__version__,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.settings = settings
    app.include_router(api_router)
    return app


app = create_app()

__all__ = ["app", "create_app"]
