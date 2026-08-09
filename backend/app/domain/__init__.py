"""ドメイン層。

HTTP・DB・外部依存を持たない純粋な計算／資産ロジックを置く。
CLAUDE.md: 数値計算ロジックはUIから分離し、テスト可能な純粋なサービス層として実装する。
現在は資産の論理定義とリターン計算・年率換算を提供する。
"""

from app.domain.returns import (
    annualize_log_return,
    annualize_return,
    annualize_volatility,
    correlation_matrix,
    cumulative_return,
    log_return,
    resample_prices,
    resample_returns,
    rolling_volatility,
    simple_return,
)

__all__ = [
    "annualize_log_return",
    "annualize_return",
    "annualize_volatility",
    "correlation_matrix",
    "cumulative_return",
    "log_return",
    "resample_prices",
    "resample_returns",
    "rolling_volatility",
    "simple_return",
]
