"""ジョブエンドポイント（プレースホルダー）。

CLAUDE.md: 最適化・バックテストはジョブIDを返す非同期方式とする。
インプロセスキューの配線は後続工程。ここでは状態遷移の契約だけを提供する。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.schemas.job import JobCreate, JobSummary

router = APIRouter(tags=["jobs"])

# メモリ内ジョブストア（後続工程で SQLite / プロセス間キューへ移行）
_jobs: dict[str, JobSummary] = {}


@router.post("/jobs", response_model=JobSummary, status_code=201)
def create_job(payload: JobCreate) -> JobSummary:
    """ジョブを作成し、queued 状態で返す。"""
    job = JobSummary(job_id=uuid.uuid4().hex, type=payload.type, status="queued")
    _jobs[job.job_id] = job
    return job


@router.get("/jobs/{job_id}", response_model=JobSummary)
def get_job(job_id: str) -> JobSummary:
    """ジョブの状態を返す。"""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"ジョブが見つかりません: {job_id}")
    return job


@router.post("/jobs/{job_id}/cancel", response_model=JobSummary)
def cancel_job(job_id: str) -> JobSummary:
    """queued/running 中のジョブをキャンセルする。"""
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"ジョブが見つかりません: {job_id}")
    if job.status in ("succeeded", "failed", "cancelled"):
        raise HTTPException(status_code=409, detail="完了済みジョブはキャンセルできません")
    job.status = "cancelled"
    return job


__all__ = ["router"]
