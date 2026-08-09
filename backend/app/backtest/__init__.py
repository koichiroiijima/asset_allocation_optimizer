"""バックテストレイヤー。

固定ウェイト・リバランスのバックテストエンジン（`run_backtest`）。
ルックアヘッド回避は「シグナル日/約定日の分離（次営業日約定）」で構造的に保証する。
CLAUDE.md: 学習期間（lookback）を明示し、リバランス時点より後のデータを入力に使わない。
"""

from app.backtest.engine import BacktestInputError, run_backtest

__all__ = ["BacktestInputError", "run_backtest"]
