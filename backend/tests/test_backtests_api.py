"""`POST /api/backtests` の配線テスト。

2資産の processed Parquet を保存した後にエンドポイントを呼び、
固定ウェイト・バックテストの結果（metrics / equity_curve / trades / params echo /
JSON に NaN が無いこと）と、400（未取得資産・期間外）・422（ウェイト合計・キー不一致）
を検証する。実データ・ネットワークは使わない。
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest
from app.config import Settings
from app.data.repository import ParquetPriceRepository
from fastapi.testclient import TestClient

_DATES = pd.date_range("2020-01-01", periods=120, freq="B")
_MEANS = {"us_equity": 0.0004, "us_bond": 0.0001}
_VOLS = {"us_equity": 0.008, "us_bond": 0.002}


def _make_prices_df(asset_ids: list[str]) -> pd.DataFrame:
    """固定シードの GBM 価格行列（test_optimizations_api.py と同ロジック）。"""
    rng = np.random.default_rng(42)
    prices: dict[str, np.ndarray] = {}
    for asset_id in asset_ids:
        rets = rng.normal(_MEANS[asset_id], _VOLS[asset_id], size=len(_DATES))
        prices[asset_id] = 100.0 * np.cumprod(1.0 + rets)
    return pd.DataFrame(prices, index=_DATES)


def _save_assets(repo: ParquetPriceRepository, asset_ids: list[str]) -> None:
    """GBM 価格行列を資産ごとの Parquet に保存する。"""
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


def _backtest_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "asset_ids": ["us_equity", "us_bond"],
        "weights": {"us_equity": 0.6, "us_bond": 0.4},
        "rebalance_frequency": "M",
        "initial_capital": 1_000_000.0,
        "cost_rate": 0.001,
        "risk_free_rate": 0.0,
        "annualization_factor": 252,
        "lookback": 252,
    }
    payload.update(overrides)
    return payload


def test_backtest_success(client: TestClient, tmp_settings: Settings) -> None:
    """正常系: metrics/equity_curve/trades/params echo/warnings が返り、JSON に NaN が無い。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post("/api/backtests", json=_backtest_payload())
    assert resp.status_code == 200
    body = resp.json()

    # asset_ids / params echo
    assert body["asset_ids"] == ["us_equity", "us_bond"]
    assert body["params"]["weights"] == {"us_equity": 0.6, "us_bond": 0.4}
    assert body["params"]["rebalance_frequency"] == "M"
    assert body["params"]["initial_capital"] == 1_000_000.0

    # metrics: 数値 or null（NaN でない）
    metrics = body["metrics"]
    assert isinstance(metrics["cumulative_return"], float)
    assert metrics["total_fees"] >= 0
    for key in [
        "annual_return",
        "annual_volatility",
        "sharpe_ratio",
        "sortino_ratio",
        "calmar_ratio",
        "max_drawdown",
        "win_rate",
        "turnover",
    ]:
        v = metrics[key]
        assert v is None or isinstance(v, float)

    # equity_curve: 日付が昇順・値が有限（NaN が無い）
    curve = body["equity_curve"]
    assert len(curve) == len(_DATES)
    values = [p["value"] for p in curve]
    assert all(math.isfinite(v) for v in values)
    assert values[0] == pytest.approx(1_000_000.0, rel=1e-9)
    assert values[-1] > 0

    # trades: 初期投資 2件 + リバランス分
    trades = body["trades"]
    assert len(trades) >= 2
    assert trades[0]["side"] == "BUY"

    # warnings は list
    assert isinstance(body["warnings"], list)


def test_backtest_daily_rebalance_has_more_trades(
    client: TestClient, tmp_settings: Settings
) -> None:
    """D 頻度は M 頻度より取引が多い。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    monthly = client.post("/api/backtests", json=_backtest_payload()).json()
    daily = client.post(
        "/api/backtests", json=_backtest_payload(rebalance_frequency="D")
    ).json()
    assert len(daily["trades"]) > len(monthly["trades"])


def test_backtest_single_asset_ok(client: TestClient, tmp_settings: Settings) -> None:
    """単一資産・ウェイト1.0 でも実行できる。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(
            asset_ids=["us_equity"],
            weights={"us_equity": 1.0},
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["asset_ids"] == ["us_equity"]
    assert len(body["trades"]) >= 1  # 初期投資のみの場合もあり


def test_backtest_missing_asset_returns_400(client: TestClient, tmp_settings: Settings) -> None:
    """未取得資産は 400（日本語 detail）。

    asset_ids と weights キーは一致させた状態で、未取得資産のみを追加して送る。
    """
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(
            asset_ids=["us_equity", "us_bond", "ex_us_equity"],
            weights={"us_equity": 0.6, "us_bond": 0.4, "ex_us_equity": 0.0},
        ),
    )
    assert resp.status_code == 400
    assert "未取得" in resp.json()["detail"]


def test_backtest_no_data_in_range_returns_400(
    client: TestClient, tmp_settings: Settings
) -> None:
    """指定期間にデータがない場合は 400。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(end="1990-01-01"),  # データより前の期間 → データなし
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]


def test_backtest_weights_sum_not_one_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """ウェイト合計が 1 でない場合は 422（Pydantic）。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(weights={"us_equity": 0.2, "us_bond": 0.2}),
    )
    assert resp.status_code == 422


def test_backtest_weights_keys_mismatch_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """weights のキーが asset_ids と一致しない場合は 422。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(weights={"us_equity": 1.0}),  # us_bond のキーが無い
    )
    assert resp.status_code == 422


def test_backtest_negative_weight_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """負のウェイトは 422。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(weights={"us_equity": 1.2, "us_bond": -0.2}),
    )
    assert resp.status_code == 422


def test_backtest_annual_frequency_ok(client: TestClient, tmp_settings: Settings) -> None:
    """年次（Y）リバランスでも実行できる。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests", json=_backtest_payload(rebalance_frequency="Y")
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["params"]["rebalance_frequency"] == "Y"
    # 年次は月次よりリバランス取引が少ない（初期投資のみの可能性も）
    assert len(body["trades"]) <= len(
        client.post("/api/backtests", json=_backtest_payload()).json()["trades"]
    )


def _opt_params_payload() -> dict[str, object]:
    """再最適化で使う最適化パラメータ（保存済み最適化の再現）。"""
    return {
        "asset_ids": ["us_equity", "us_bond"],
        "optimization_method": "max_sharpe",
        "expected_return_method": "mean_historical_return",
        "covariance_method": "sample_cov",
        "risk_free_rate": 0.0,
        "annualization_factor": 252,
        "weight_bounds": [0.0, 1.0],
    }


def test_backtest_reoptimize_returns_rebalance_weights(
    client: TestClient, tmp_settings: Settings
) -> None:
    """再最適化バックテスト: rebalance_weights が返り、警告に再最適化失敗が無い。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(
            reoptimize=True,
            optimization_params=_opt_params_payload(),
        ),
    )
    assert resp.status_code == 200
    body = resp.json()
    # 再最適化時は採用したターゲットウェイト一覧が返る
    assert body["rebalance_weights"] is not None
    assert len(body["rebalance_weights"]) >= 1
    assert not any("失敗" in w for w in body["warnings"])


def test_backtest_reoptimize_missing_asset_returns_400(
    client: TestClient, tmp_settings: Settings
) -> None:
    """再最適化対象資産が未取得だと 400。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(
            asset_ids=["us_equity"],
            weights={"us_equity": 1.0},
            reoptimize=True,
            optimization_params=_opt_params_payload(),  # us_bond が未取得
        ),
    )
    assert resp.status_code == 400
    assert "再最適化" in resp.json()["detail"]


def test_backtest_reoptimize_without_params_returns_422(
    client: TestClient, tmp_settings: Settings
) -> None:
    """reoptimize=True なのに optimization_params が無いと 422。"""
    _save_assets(ParquetPriceRepository(tmp_settings.processed_dir), ["us_equity", "us_bond"])
    resp = client.post(
        "/api/backtests",
        json=_backtest_payload(reoptimize=True),
    )
    assert resp.status_code == 422