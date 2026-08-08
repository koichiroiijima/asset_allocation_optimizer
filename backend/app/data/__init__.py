"""データレイヤー。

外部データプロバイダーの抽象と実装、raw/processed の保存、正規化、取得パイプライン、
CSV エクスポートを提供する。実データ取得は CLI（`app.cli`）経由で行う。
"""

from app.data.calendar import TradingCalendar, trading_calendar
from app.data.export import export_csv_for_asset, export_csv_processed
from app.data.normalize import normalize_prices
from app.data.pipeline import PricePipeline, build_dataframe
from app.data.provider import LocalFixtureProvider, PriceProvider
from app.data.providers.yahoo import ProviderDataError, YahooPriceProvider
from app.data.raw import RawParquetWriter
from app.data.repository import (
    SERIES_COLUMNS,
    ParquetPriceRepository,
    SeriesStore,
    SqliteIndexRepository,
)

__all__ = [
    "SERIES_COLUMNS",
    "LocalFixtureProvider",
    "ParquetPriceRepository",
    "PricePipeline",
    "PriceProvider",
    "ProviderDataError",
    "RawParquetWriter",
    "SeriesStore",
    "SqliteIndexRepository",
    "TradingCalendar",
    "YahooPriceProvider",
    "build_dataframe",
    "export_csv_for_asset",
    "export_csv_processed",
    "normalize_prices",
    "trading_calendar",
]
