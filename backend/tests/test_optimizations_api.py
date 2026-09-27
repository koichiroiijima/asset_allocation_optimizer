"""`POST /api/optimizations` の配線テスト。

2資産の processed Parquet を repo で保存した後にエンドポイントを呼び、
最適配分（ウェイト合計・上下限）・指標・日本語警告を検証する。
未取得資産・期間外・非正価格・制約矛盾は 400 になることを確認する。
実データ・ネットワークは使わない（GBM 生成を test_optimization.py と同様に再利用）。
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd
import pytest
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from fastapi.testclient import TestClient

# test_optimization.py と同一シード・同一生成ロジック（再現可能）
_DATES = pd.date_range("2020-01-01", periods=300, freq="D")
_MEANS = {"us_equity": 0.0004, "us_bond": 0.0001, "ex_us_equity": 0.0003, "ex_us_bond": 0.0002}
_VOLS = {"us_equity": 0.008, "us_bond": 0.002, "ex_us_equity": 0.009, "ex_us_bond": 0.003}


def _make_prices_df(asset_ids: list[str]) -> pd.DataFrame:
    """`test_optimization.py::_make_prices` と同じ固定シードの GBM 価格 DataFrame。

    単一の `rng` を asset_ids 順に消費する（test_optimization.py と同一の乱数列）。
    列=資産、行=日付。
    """
    rng = np.random.default_rng(42)
    prices: dict[str, np.ndarray] = {}
    for asset_id in asset_ids:
        rets = rng.normal(_MEANS[asset_id], _VOLS[asset_id], size=len(_DATES))
        prices[asset_id] = 100.0 * np.cumprod(1.0 + rets)
    return pd.DataFrame(prices, index=_DATES)


def _save_assets(repo: ParquetPriceRepository, asset_ids: list[str]) -> None:
    """GBM 価格行列を資産ごとの Parquet 保存用 DataFrame に分けて保存する。"""
    prices = _make_prices_df(asset_ids)
    for asset_id in asset_ids:
        repo.save_series(
            asset_id,
            pd.DataFrame(
                {
                    "date": prices.index,
                    "asset_id": [asset_id] * len(prices),
                    "raw_close": prices[asset_id].to_numpy(),
                    "adjusted_close": prices[asset_id].to_numpy(),
                    "distribution": [0.0] * len(prices),
                    "currency": ["USD"] * len(prices),
                    "source": ["test"] * len(prices),
                    "source_symbol": ["T"] * len(prices),
                    "price_type": ["adjusted_close"] * len(prices),
                }
            ),
        )


def _optimize_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "asset_ids": ["us_equity", "us_bond"],
        "optimization_method": "max_sharpe",
        "expected_return_method": "mean_historical_return",
        "covariance_method": "sample_cov",
        "risk_free_rate": 0.0,
        "annualization_factor": 252,
        "weight_bounds": [0.0, 1.0],
    }
    payload.update(overrides)
    return payload


def test_optimization_returns_weights_and_metrics(
    client: TestClient, tmp_settings: Settings
) -> None:
    """max_sharpe: 生ウェイト合計1・0-1収まり・指標が有限値で返る。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post("/api/optimizations", json=_optimize_payload())
    assert resp.status_code == 200
    body = resp.json()

    assert set(body["weights"]) == {"us_equity", "us_bond"}
    assert sum(body["weights"].values()) == pytest.approx(1.0, abs=1e-6)
    for value in body["weights"].values():
        assert 0.0 <= value <= 1.0
    assert set(body["clean_weights"]) == {"us_equity", "us_bond"}
    assert np.isfinite(body["metrics"]["expected_annual_return"])
    assert np.isfinite(body["metrics"]["annual_volatility"])
    assert np.isfinite(body["metrics"]["sharpe_ratio"])
    # 手法・パラメータが応答に含まれる（params の再現）
    assert body["params"]["optimization_method"] == "max_sharpe"
    assert body["params"]["risk_free_rate"] == 0.0
    # 個別資産ごとの年率リターン／ボラが含まれる
    assert set(body["metrics"]["asset_returns"]) == {"us_equity", "us_bond"}
    assert set(body["metrics"]["asset_volatilities"]) == {"us_equity", "us_bond"}
    for v in body["metrics"]["asset_volatilities"].values():
        assert v > 0.0


def test_optimization_min_volatility_prefers_bond(
    client: TestClient, tmp_settings: Settings
) -> None:
    """min_volatility: 低ボラ資産（us_bond）に有意な配分が入る。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(optimization_method="min_volatility"),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["weights"]["us_bond"] > 0.4


def test_optimization_respects_date_range(client: TestClient, tmp_settings: Settings) -> None:
    """start/end で期間を絞って最適化できる（ルックアヘッドを回避する入力インターフェース）。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            start=date(2020, 1, 1).isoformat(),
            end=date(2020, 6, 30).isoformat(),
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert sum(body["weights"].values()) == pytest.approx(1.0, abs=1e-6)


def test_optimization_missing_asset_returns_400(
    client: TestClient, tmp_settings: Settings
) -> None:
    """未取得資産がある場合は 400・日本語 detail（除外せず明示）。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(asset_ids=["us_equity", "us_bond"]),
    )
    assert resp.status_code == 400
    assert "未取得" in resp.json()["detail"]
    assert "us_bond" in resp.json()["detail"]


def test_optimization_single_asset_returns_400(
    client: TestClient, tmp_settings: Settings
) -> None:
    """1資産のみは最適化不能（2資産以上）として 400。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(asset_ids=["us_equity"]),
    )
    assert resp.status_code == 400
    assert "2資産以上" in resp.json()["detail"]


def test_optimization_no_data_in_range_returns_400(
    client: TestClient, tmp_settings: Settings
) -> None:
    """指定期間にデータが無い場合は 400・日本語 detail。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            start=date(2030, 1, 1).isoformat(),
            end=date(2030, 6, 30).isoformat(),
        ),
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]


def test_optimization_invalid_bounds_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """ウェイト下限が負などパラメータ検証違反は 422（pydantic）。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post("/api/optimizations", json=_optimize_payload(weight_bounds=[-0.1, 1.0]))
    assert resp.status_code == 422


def test_optimization_contradictory_constraints_returns_400(
    client: TestClient, tmp_settings: Settings
) -> None:
    """制約矛盾（達成不能な目標ボラ）は OptimizationInputError → 400。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    # 目標ボラを最小分散未満（達成不能）にし、最適化失敗を 400 化する。
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            optimization_method="efficient_risk",
            target_volatility=1e-9,
        ),
    )
    assert resp.status_code == 400
    assert "最適化" in resp.json()["detail"]


def test_optimization_warnings_forwarded(client: TestClient, tmp_settings: Settings) -> None:
    """サービス層の警告（前fill など）が応答に含まれる。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post("/api/optimizations", json=_optimize_payload())
    assert resp.status_code == 200
    assert isinstance(resp.json()["warnings"], list)


# ---------------------------------------------------------------- Black-Litterman ---


def test_optimization_black_litterman_returns_weights(
    client: TestClient, tmp_settings: Settings
) -> None:
    """BL 最適化: ビュー付きでウェイト・指標・params round-trip が返る。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            expected_return_method="black_litterman",
            bl_market_weights={"us_equity": 0.5, "us_bond": 0.5},
            bl_views={"us_equity": 0.03},
            bl_view_confidences={"us_equity": 0.8},
            bl_omega_method="idzorek",
            bl_tau=0.05,
            bl_risk_aversion=3.0,
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["weights"]) == {"us_equity", "us_bond"}
    assert sum(body["weights"].values()) == pytest.approx(1.0, abs=1e-6)
    assert np.isfinite(body["metrics"]["expected_annual_return"])
    # params の round-trip（保存済み最適化の再現に使う）
    assert body["params"]["expected_return_method"] == "black_litterman"
    assert body["params"]["bl_views"] == {"us_equity": 0.03}
    assert body["params"]["bl_omega_method"] == "idzorek"


def test_optimization_black_litterman_market_default_sums_to_one(
    client: TestClient, tmp_settings: Settings
) -> None:
    """BL で bl_market_weights を省略するとデフォルト（4資産合成）が使われる。"""
    _save_assets(
        ParquetPriceRepository(tmp_settings.processed_dir),
        ["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"],
    )
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            asset_ids=["us_equity", "us_bond", "ex_us_equity", "ex_us_bond"],
            expected_return_method="black_litterman",
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert sum(body["weights"].values()) == pytest.approx(1.0, abs=1e-6)


def test_optimization_black_litterman_invalid_tau_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """bl_tau の値域外はスキーマ検証で 422。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(expected_return_method="black_litterman", bl_tau=0.0),
    )
    assert resp.status_code == 422


def test_optimization_black_litterman_view_outside_assets_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """ビューの対象が選択資産外だと 422（OptimizationRequest 層の検証）。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            expected_return_method="black_litterman",
            bl_views={"ex_us_equity": 0.05},  # 未選択
        ),
    )
    assert resp.status_code == 422
    assert "ビューの対象は選択資産内" in resp.json()["detail"][0]["msg"]


def test_optimization_black_litterman_market_weights_mismatch_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """市場ポートフォリオのキーが選択資産外だと 422。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            expected_return_method="black_litterman",
            bl_market_weights={"us_equity": 0.5, "ex_us_bond": 0.5},
        ),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------- 日本モード（JPY） ---


def _save_jp_assets(repo: ParquetPriceRepository, asset_ids: list[str]) -> None:
    """日本モード2資産を JPY 建てで保存する（価格は us 生成を流用）。"""
    prices = _make_prices_df(["us_equity", "us_bond"])
    for i, asset_id in enumerate(asset_ids):
        values = prices.iloc[:, i].to_numpy()
        repo.save_series(
            asset_id,
            pd.DataFrame(
                {
                    "date": prices.index,
                    "asset_id": [asset_id] * len(prices),
                    "raw_close": values,
                    "adjusted_close": values,
                    "distribution": [0.0] * len(prices),
                    "currency": ["JPY"] * len(prices),
                    "source": ["test"] * len(prices),
                    "source_symbol": ["T"] * len(prices),
                    "price_type": ["adjusted_close"] * len(prices),
                }
            ),
        )


def test_optimization_jp_returns_jpy_base_currency(
    client: TestClient, tmp_settings: Settings
) -> None:
    """日本モードの最適化は base_currency=JPY を返す。"""
    _save_jp_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["jp_equity", "jp_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(asset_ids=["jp_equity", "jp_bond"]),
    )
    assert resp.status_code == 200
    assert resp.json()["base_currency"] == "JPY"


def test_optimization_black_litterman_jp_default_warns(
    client: TestClient, tmp_settings: Settings
) -> None:
    """日本モードの BL は仮の既定市場ウェイトを使い、警告で明示する。"""
    _save_jp_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["jp_equity", "jp_bond"])
    resp = client.post(
        "/api/optimizations",
        json=_optimize_payload(
            asset_ids=["jp_equity", "jp_bond"],
            expected_return_method="black_litterman",
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert sum(body["weights"].values()) == pytest.approx(1.0, abs=1e-6)
    assert any("仮値" in w for w in body["warnings"])