"""CLI（fetch / export-csv）のテスト。

実ネットワーク・実データに触れないよう、pipeline と get_settings を差し替える。
"""

from __future__ import annotations

import pandas as pd
import pytest
from app.cli import main
from app.config.settings import Settings

EXPECTED_ASSETS = ["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"]


class FakePipeline:
    """呼び出しを記録する fake pipeline。"""

    def __init__(self, settings: Settings) -> None:
        self.calls: list[dict[str, object]] = []
        self.closed = False
        self.pipeline_kwargs: dict[str, object] = {}

    def run(
        self, asset_ids: list[str] | None = None, start: object = None, end: object = None
    ) -> dict[str, object]:
        self.calls.append({"asset_ids": asset_ids, "start": start, "end": end})
        return {
            "results": [
                {
                    "asset_id": aid,
                    "status": "succeeded",
                    "rows": 3,
                    "raw_snapshot_hash": "a" * 64,
                }
                for aid in (asset_ids or EXPECTED_ASSETS)
            ]
        }

    def close(self) -> None:
        self.closed = True


def _install(monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings) -> FakePipeline:
    fake = FakePipeline(tmp_settings)

    def _factory(settings: Settings, **kwargs: object) -> FakePipeline:
        fake.pipeline_kwargs.update(kwargs)
        return fake

    monkeypatch.setattr("app.cli.get_settings", lambda: tmp_settings)
    monkeypatch.setattr("app.cli.PricePipeline", _factory)
    return fake


def test_fetch_defaults_to_all_assets(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings, capsys: pytest.CaptureFixture
) -> None:
    """--asset 未指定で全4資産を対象に fetch する。"""
    fake = _install(monkeypatch, tmp_settings)
    code = main(["fetch"])
    out = capsys.readouterr().out
    assert code == 0
    assert fake.calls[0]["asset_ids"] is None
    assert fake.closed
    for label in ("米国株式", "米国債券", "米国を除く株式", "米国を除く債券"):
        assert label in out


def test_fetch_with_assets_and_dates(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings
) -> None:
    """--asset と --start/--end が渡される。"""
    fake = _install(monkeypatch, tmp_settings)
    code = main(["fetch", "--asset", "us_equity", "--start", "2024-01-01", "--end", "2024-06-30"])
    assert code == 0
    call = fake.calls[0]
    assert call["asset_ids"] == ["us_equity"]
    assert call["start"].isoformat() == "2024-01-01"
    assert call["end"].isoformat() == "2024-06-30"


def test_fetch_unknown_asset_returns_2(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings
) -> None:
    """未知の asset_id は終了コード 2。"""
    _install(monkeypatch, tmp_settings)
    code = main(["fetch", "--asset", "nope"])
    assert code == 2


def test_export_csv_writes_files(
    monkeypatch: pytest.MonkeyPatch,
    tmp_settings: Settings,
    capsys: pytest.CaptureFixture,
) -> None:
    """export-csv が processed から CSV を書き出す。"""
    _install(monkeypatch, tmp_settings)
    # processed に1資産ぶんだけ置いておく
    from app.data.repository import ParquetPriceRepository

    repo = ParquetPriceRepository(tmp_settings.processed_dir)
    repo.save_series(
        "us_equity",
        pd.DataFrame({"date": pd.to_datetime(["2024-01-02"]), "asset_id": ["us_equity"]}),
    )

    code = main(["export-csv", "--out", str(tmp_settings.processed_dir)])
    out = capsys.readouterr().out
    assert code == 0
    assert "us_equity.csv" in out
    assert (tmp_settings.processed_dir / "us_equity.csv").exists()


def test_export_csv_unknown_asset_returns_2(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings
) -> None:
    """export-csv の未知 asset_id も終了コード 2。"""
    _install(monkeypatch, tmp_settings)
    code = main(["export-csv", "--asset", "nope"])
    assert code == 2


def test_fetch_jp_set_selects_jp_assets(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings, capsys: pytest.CaptureFixture
) -> None:
    """--set jp --asset jp_equity で日本モードの資産を取得する。"""
    fake = _install(monkeypatch, tmp_settings)
    code = main(["fetch", "--set", "jp", "--asset", "jp_equity"])
    out = capsys.readouterr().out
    assert code == 0
    assert fake.pipeline_kwargs["asset_set"] == "jp"
    assert "日本株式" in out


def test_fetch_infers_set_from_asset(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings
) -> None:
    """--set 未指定でも jp 資産IDから日本モードを推定する。"""
    fake = _install(monkeypatch, tmp_settings)
    code = main(["fetch", "--asset", "jp_bond"])
    assert code == 0
    assert fake.pipeline_kwargs["asset_set"] == "jp"


def test_fetch_mixed_sets_without_set_returns_2(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings
) -> None:
    """モードをまたぐ資産IDは --set 無しではエラー。"""
    _install(monkeypatch, tmp_settings)
    code = main(["fetch", "--asset", "us_equity", "--asset", "jp_equity"])
    assert code == 2


def test_fetch_asset_not_in_set_returns_2(
    monkeypatch: pytest.MonkeyPatch, tmp_settings: Settings
) -> None:
    """--set と異なるモードの資産IDはエラー。"""
    _install(monkeypatch, tmp_settings)
    code = main(["fetch", "--set", "jp", "--asset", "us_equity"])
    assert code == 2
