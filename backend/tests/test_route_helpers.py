"""`load_price_matrix` の未調整株式分割（分割前除外）のテスト。"""

from __future__ import annotations

import pandas as pd
from app.api.route_helpers import load_price_matrix
from app.config import Settings
from app.data.repository import ParquetPriceRepository


def _save(repo: ParquetPriceRepository, asset_id: str, values: list[float]) -> None:
    index = pd.date_range("2015-01-01", periods=len(values), freq="D")
    repo.save_series(
        asset_id,
        pd.DataFrame(
            {
                "date": index,
                "asset_id": [asset_id] * len(values),
                "raw_close": [float(v) for v in values],
                "adjusted_close": [float(v) / 2.0 for v in values],
                "distribution": [0.0] * len(values),
                "currency": ["JPY"] * len(values),
            }
        ),
    )


def test_excludes_pre_split_rows_and_warns(tmp_settings: Settings) -> None:
    """10:1 分割がある資産は分割前の行を除外し、日本語警告を添える。"""
    repo = ParquetPriceRepository(tmp_settings.processed_dir)
    _save(repo, "jp_equity", [1000.0] * 30 + [100.0] * 30)

    matrix, warnings = load_price_matrix(repo, ["jp_equity"])

    assert list(matrix.columns) == ["jp_equity"]
    assert matrix.index.min() == pd.Timestamp("2015-01-31")  # 分割後の最初の観測
    assert len(matrix) == 30
    assert any("株式分割" in w and "jp_equity" in w for w in warnings)


def test_other_assets_keep_their_own_history(tmp_settings: Settings) -> None:
    """分割のある資産だけ分割前が NaN になり、他資産の履歴は残る。"""
    repo = ParquetPriceRepository(tmp_settings.processed_dir)
    _save(repo, "jp_equity", [1000.0] * 30 + [100.0] * 30)
    _save(repo, "ex_jp_equity", [50.0] * 60)  # 分割なし

    matrix, _ = load_price_matrix(repo, ["jp_equity", "ex_jp_equity"])

    # ex_jp_equity は全期間残る
    assert matrix["ex_jp_equity"].notna().all()
    # jp_equity は分割前が NaN（外側 join）
    assert matrix.loc[: pd.Timestamp("2015-01-30"), "jp_equity"].isna().all()
    assert matrix.loc[pd.Timestamp("2015-01-31") :, "jp_equity"].notna().all()
