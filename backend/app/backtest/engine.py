"""バックテストエンジン（プレースホルダー）。

実装は後続工程。ここではエントリポイントのシグネチャのみ定義する。
"""

from __future__ import annotations

from typing import Any


def run_backtest(config: dict[str, Any]) -> Any:
    """バックテストを実行する（未実装）。"""
    raise NotImplementedError("run_backtest は未実装です（後続工程)")


__all__ = ["run_backtest"]
