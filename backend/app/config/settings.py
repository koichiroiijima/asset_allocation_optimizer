"""アプリ設定（Pydantic Settings）。

設定値は環境変数 `ASSET_ALLOC__*` または `.env` で上書きできる。
既定値はローカル開発用。データ/出力ディレクトリはリポジトリルートからの相対パス。
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_FX_POLICIES = ("unhedged", "hedged")
_CURRENCIES = ("USD", "JPY", "EUR")


class Settings(BaseSettings):
    """アプリ全体の設定。

    - `portfolio_base_currency`: ポートフォリオの基準通貨（初期版は必須）。
    - `instrument_trading_currency`: 各商品の取引通貨。
    - `underlying_currency_exposure`: 裏付け資産の通貨エクスポージャー。
    - `fx_policy`: 為替ヘッジ方針（`unhedged` / `hedged`）。
    """

    model_config = SettingsConfigDict(
        env_prefix="ASSET_ALLOC__",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        validate_default=True,
    )

    # ---- アプリ ----
    app_env: Literal["development", "test", "production"] = "development"
    app_port: int = Field(default=8000, ge=1, le=65535)
    log_level: str = "INFO"

    # ---- 通貨・FX 方針 ----
    portfolio_base_currency: str = Field(default="JPY", pattern="^[A-Z]{3}$")
    instrument_trading_currency: str = Field(default="USD", pattern="^[A-Z]{3}$")
    underlying_currency_exposure: str = Field(default="USD", pattern="^[A-Z]{3}$")
    fx_policy: Literal["unhedged", "hedged"] = "unhedged"

    # ---- ディレクトリ（リポジトリルートからの相対） ----
    data_root: Path = Path("../data")
    output_root: Path = Path("../outputs")
    sqlite_path: Path | None = None
    # 資産セット（モード）→ 資産マッピング JSON のパス。
    # 既定は us（米国モード）と jp（日本モード）。環境変数では JSON 文字列で上書きする。
    asset_mapping_files: dict[str, Path] = Field(
        default_factory=lambda: {
            "us": Path("./app/config/assets.default.json"),
            "jp": Path("./app/config/assets.jp.json"),
        }
    )
    default_asset_set: str = "us"

    # ---- データ正規化 ----
    price_max_staleness_days: int = Field(default=5, ge=1)
    annualization_factor: int = Field(default=252, ge=1)

    # ---- CORS（ローカル開発用。公開時は別途設計） ----
    cors_origins: list[str] = ["http://localhost:5173"]

    # ---- データ・出力の導出パス ----
    @property
    def sqlite_path_resolved(self) -> Path:
        """SQLite DB のパス。未指定なら data_root 配下に app.db を使う。"""
        return self.sqlite_path or (self.data_root / "app.db")

    @property
    def raw_dir(self) -> Path:
        return self.data_root / "raw"

    @property
    def processed_dir(self) -> Path:
        return self.data_root / "processed"

    @property
    def fixtures_dir(self) -> Path:
        return self.data_root / "fixtures"

    @property
    def optimization_out_dir(self) -> Path:
        return self.output_root / "optimization"

    @property
    def backtest_out_dir(self) -> Path:
        return self.output_root / "backtest"


def validate_settings(settings: Settings) -> None:
    """設定値の整合性を検証し、違反時は ValueError を投げる。

    既定の型バリデーションでは拾えない、値の間の整合性を検査する。
    """
    if settings.fx_policy not in _FX_POLICIES:
        raise ValueError(f"fx_policy が不正: {settings.fx_policy!r}")
    for name in (
        "portfolio_base_currency",
        "instrument_trading_currency",
        "underlying_currency_exposure",
    ):
        value = getattr(settings, name)
        if value not in _CURRENCIES:
            raise ValueError(f"{name} が未対応通貨: {value!r}")
    # 基準通貨は初期版で必ず設定する（既定値以外の空文字を拒否）
    if not settings.portfolio_base_currency:
        raise ValueError("portfolio_base_currency は必須です")
    if settings.default_asset_set not in settings.asset_mapping_files:
        raise ValueError(
            "default_asset_set が asset_mapping_files に存在しません: "
            f"{settings.default_asset_set!r}"
        )
    if not settings.asset_mapping_files:
        raise ValueError("asset_mapping_files が空です（少なくとも us が必要です）")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """プロセス内で一度だけ設定を読み込み、キャッシュする。"""
    settings = Settings()
    validate_settings(settings)
    return settings


__all__ = ["Settings", "get_settings", "validate_settings"]
