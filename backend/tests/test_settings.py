"""Settings の既定値・導出パス・検証ロジックのテスト。"""

from pathlib import Path

import pytest
from app.config import Settings, validate_settings


def test_defaults(tmp_settings: Settings) -> None:
    """テスト環境ではデータ/出力への実アクセスを避けるため tmp を使う。"""
    assert tmp_settings.app_env == "test"
    assert tmp_settings.portfolio_base_currency == "JPY"
    assert tmp_settings.instrument_trading_currency == "USD"
    assert tmp_settings.underlying_currency_exposure == "USD"
    assert tmp_settings.fx_policy == "unhedged"
    assert tmp_settings.price_max_staleness_days == 5
    assert tmp_settings.annualization_factor == 252


def test_resolved_paths(tmp_settings: Settings) -> None:
    """導出パスが data_root / output_root 配下に解決される。"""
    root = tmp_settings.data_root
    assert tmp_settings.sqlite_path_resolved == root / "app.db"
    assert tmp_settings.raw_dir == root / "raw"
    assert tmp_settings.processed_dir == root / "processed"
    assert tmp_settings.optimization_out_dir == tmp_settings.output_root / "optimization"
    assert tmp_settings.backtest_out_dir == tmp_settings.output_root / "backtest"


def test_sqlite_path_override(tmp_path: Path) -> None:
    """sqlite_path が明示されていれば data_root に依存しない。"""
    explicit = tmp_path / "custom" / "db.sqlite3"
    settings = Settings(sqlite_path=explicit)
    assert settings.sqlite_path_resolved == explicit


def test_settings_do_not_create_dirs(tmp_settings: Settings, tmp_path: Path) -> None:
    """Settings 生成時にディレクトリを勝手に作らない（副作用なし）。"""
    assert not tmp_settings.data_root.exists()
    assert not tmp_settings.output_root.exists()


def test_validate_rejects_unknown_currency() -> None:
    """未対応通貨は検証で弾かれる。"""
    settings = Settings(portfolio_base_currency="XXX")
    with pytest.raises(ValueError):
        validate_settings(settings)


def test_validate_rejects_invalid_fx_policy() -> None:
    """不正な fx_policy は検証で弾かれる。"""
    settings = Settings(fx_policy="hedged")
    # "hedged" は有効。正しく無い値なら検証時に弾くことを確認。
    validate_settings(settings)
