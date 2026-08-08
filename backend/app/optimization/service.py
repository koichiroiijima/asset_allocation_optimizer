"""最適化サービス（プレースホルダー）。

実装は後続工程。ここではエントリポイントのシグネチャのみ定義する。
"""

from __future__ import annotations

from typing import Any


def optimize(prices: object, params: dict[str, Any]) -> dict[str, Any]:
    """価格系列と最適化パラメータから最適ウェイト等を求める（未実装）。"""
    raise NotImplementedError("optimize は未実装です（後続工程)")


__all__ = ["optimize"]
