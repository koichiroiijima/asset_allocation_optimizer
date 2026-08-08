"""ポートフォリオ最適化レイヤー。

PyPortfolioOpt を使う最適化サービスを提供する。
CLAUDE.md: データ期間・リターン頻度・年率換算・リスクフリー金利・ウェイト上下限・
取引コストを明示的な入力として受ける。`static_allocation` と `rebalance_allocation` の
2モードを分離する（現在は `static_allocation` を実装済み）。
"""

from app.optimization.service import (
    OptimizationInputError,
    StaticAllocationParams,
    static_allocation,
)

__all__ = [
    "OptimizationInputError",
    "StaticAllocationParams",
    "static_allocation",
]
