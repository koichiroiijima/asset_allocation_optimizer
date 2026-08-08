"""FastAPI の依存性（DI）プロバイダー。

`app.state` に生えた値を依存として注入する。
テストでは create_app(settings=...) で差し替え可能にする。
"""

from __future__ import annotations

from typing import Any, cast

from fastapi import Request

from app.config import Settings


def get_settings(request: Request) -> Settings:
    """アプリに設定された Settings を返す。"""
    return cast(Settings, request.app.state.settings)


def get_repositories(request: Request) -> dict[str, Any]:
    """リポジトリ群へのアクセスを提供する（未配線時は空辞書）。"""
    return dict(getattr(request.app.state, "repositories", {}))


__all__ = ["get_repositories", "get_settings"]
