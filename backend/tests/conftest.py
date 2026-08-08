"""テスト共通フィクスチャ。

実データ/出力ディレクトリに触れないよう、全テストは tmp_path 配下の設定を使う。
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from app.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient


@pytest.fixture
def tmp_settings(tmp_path: Path) -> Settings:
    """一時ディレクトリを指す Settings を返す。"""
    asset_mapping = Path(__file__).parent.parent / "app" / "config" / "assets.default.json"
    return Settings(
        app_env="test",
        data_root=tmp_path / "data",
        output_root=tmp_path / "outputs",
        sqlite_path=tmp_path / "data" / "app.db",
        asset_mapping_file=asset_mapping,
        cors_origins=[],
    )


@pytest.fixture
def asset_mapping_file() -> Path:
    """コミット済みの既定資産マッピングファイルのパス。"""
    return Path(__file__).parent.parent / "app" / "config" / "assets.default.json"


@pytest.fixture
def client(tmp_settings: Settings) -> Iterator[TestClient]:
    """設定注入済みアプリの TestClient を返す。"""
    with TestClient(create_app(tmp_settings)) as c:
        yield c
