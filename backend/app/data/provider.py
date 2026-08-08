"""データプロバイダー抽象。

実際の取得処理は実装しない。プロバイダー毎のアダプターはこの Protocol を実装する。
CLAUDE.md: まずプロバイダー抽象化とローカルCSV／Parquetアダプターを作る。
実データ取得前には利用規約・Adjusted Close 定義・履歴長・キー要件を比較表で記録する。
"""

from __future__ import annotations

from datetime import date
from typing import Protocol, runtime_checkable

from app.schemas.dataseries import PriceRecord


@runtime_checkable
class PriceProvider(Protocol):
    """価格系列の取得を提供するアダプターの契約。"""

    def fetch_history(
        self, asset_id: str, start: date | None = None, end: date | None = None
    ) -> list[PriceRecord]: ...

    def get_available_history(self, asset_id: str) -> tuple[date, date] | None: ...

    @property
    def name(self) -> str: ...


class LocalFixtureProvider:
    """data/fixtures 配下の保存済み CSV／Parquet を読み込むローカルアダプター。

    実データソース確定前の既定プロバイダー。取得・ネットワークは行わない。
    """

    def __init__(self, fixtures_dir: object) -> None:
        # fixtures_dir は現段階では記録のみ。読み込みロジックは後続工程。
        self._fixtures_dir = fixtures_dir

    @property
    def name(self) -> str:
        return "local-fixture"

    def fetch_history(
        self, asset_id: str, start: date | None = None, end: date | None = None
    ) -> list[PriceRecord]:
        raise NotImplementedError("fixture 読み込みは未実装です（後続工程)")

    def get_available_history(self, asset_id: str) -> tuple[date, date] | None:
        raise NotImplementedError("fixture 読み込みは未実装です（後続工程)")


__all__ = ["LocalFixtureProvider", "PriceProvider"]
