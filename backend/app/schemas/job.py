"""ジョブ／実行の API スキーマ。

CLAUDE.md: 最適化・バックテストは初期版からジョブIDを返す非同期方式とする。
ここではジョブと実行結果（Run）の型契約を定義する。
"""

from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

JobType = Literal["data_fetch", "optimization", "backtest"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


def _utcnow() -> datetime:
    return datetime.now(UTC)


class JobCreate(BaseModel):
    """`POST /api/jobs` のリクエスト。"""

    type: JobType
    payload: dict[str, Any] = Field(default_factory=dict)


class JobSummary(BaseModel):
    """ジョブの進捗・状態サマリー。"""

    job_id: str
    type: JobType
    status: JobStatus
    progress: float = Field(default=0.0, ge=0.0, le=1.0)
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)
    error: str | None = None


class JobRunRequest(BaseModel):
    """`POST /api/jobs/{job_id}/cancel` 用のリクエスト型（現在は空）。"""


class RunSummary(BaseModel):
    """`GET /api/runs/{run_id}` のレスポンス。実行結果の概要。"""

    run_id: str
    job_id: str | None = None
    status: JobStatus
    warnings: list[str] = Field(default_factory=list)
    logs: list[str] = Field(default_factory=list)
    settings: dict[str, Any] = Field(default_factory=dict)
    data_snapshot_refs: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_utcnow)


class RunEquitySeries(RunSummary):
    """`GET /api/runs/{run_id}/equity-curve` のレスポンス（スタブ）。"""


class RunTrades(RunSummary):
    """`GET /api/runs/{run_id}/trades` のレスポンス（スタブ）。"""

    trades: list[dict[str, Any]] = Field(default_factory=list)


__all__ = [
    "JobCreate",
    "JobStatus",
    "JobSummary",
    "JobType",
    "RunEquitySeries",
    "RunSummary",
    "RunTrades",
]
