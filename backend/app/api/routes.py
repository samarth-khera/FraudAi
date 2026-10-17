"""HTTP routes. Thin layer: validate input, call services, shape responses."""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Depends, HTTPException, Query

from app.repositories.case_repository import CaseRepository, InMemoryCaseRepository
from app.schemas.trace import (
    CaseListResponse,
    ErrorResponse,
    GraphResponse,
    HealthResponse,
    TraceResult,
    TransactionListResponse,
)
from app.models.domain import FraudCase
from app.services.graph import build_graph
from app.services.tracer import DEFAULT_MAX_DEPTH, TraceError, trace_case

router = APIRouter()

_ERRORS = {404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 422: {"model": ErrorResponse}}


@lru_cache(maxsize=1)
def get_repository() -> CaseRepository:
    return InMemoryCaseRepository.from_json()


MaxDepth = Query(
    DEFAULT_MAX_DEPTH, ge=0, le=50,
    description="Maximum downstream hops from the origin transaction (origin = hop 0).")


def _require_case(repo: CaseRepository, case_id: str) -> FraudCase:
    case = repo.get_case(case_id)
    if case is None:
        raise HTTPException(status_code=404, detail={"code": "case_not_found",
                                                     "message": f"Case {case_id!r} not found."})
    return case


def _run_trace(repo: CaseRepository, case_id: str, max_depth: int) -> TraceResult:
    case = _require_case(repo, case_id)
    try:
        return trace_case(case, repo.get_transactions(), repo.get_accounts(),
                          repo.get_review_statuses(case_id), max_depth=max_depth)
    except TraceError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="fraudshield-ai-backend", phase="1-synthetic")


@router.get("/api/cases", response_model=CaseListResponse, tags=["cases"])
def list_cases(repo: CaseRepository = Depends(get_repository)) -> CaseListResponse:
    cases = repo.list_cases()
    return CaseListResponse(count=len(cases), cases=cases)


@router.get("/api/cases/{case_id}", response_model=FraudCase, responses=_ERRORS, tags=["cases"])
def get_case(case_id: str, repo: CaseRepository = Depends(get_repository)) -> FraudCase:
    return _require_case(repo, case_id)


@router.get("/api/cases/{case_id}/transactions", response_model=TransactionListResponse,
            responses=_ERRORS, tags=["cases"])
def get_case_transactions(case_id: str, max_depth: int = MaxDepth,
                          repo: CaseRepository = Depends(get_repository)) -> TransactionListResponse:
    """Chronological transactions in the traced network (origin included)."""
    result = _run_trace(repo, case_id, max_depth)
    return TransactionListResponse(case_id=case_id, count=len(result.traced_transactions),
                                   transactions=result.traced_transactions, warnings=result.warnings)


@router.get("/api/cases/{case_id}/graph", response_model=GraphResponse, responses=_ERRORS, tags=["cases"])
def get_case_graph(case_id: str, max_depth: int = MaxDepth,
                   repo: CaseRepository = Depends(get_repository)) -> GraphResponse:
    """Nodes/edges for network rendering."""
    result = _run_trace(repo, case_id, max_depth)
    return build_graph(result, repo.get_accounts(), repo.get_review_statuses(case_id))


@router.get("/api/cases/{case_id}/trace", response_model=TraceResult, responses=_ERRORS, tags=["cases"])
def get_case_trace(case_id: str, max_depth: int = MaxDepth,
                   repo: CaseRepository = Depends(get_repository)) -> TraceResult:
    """Paths, per-account exposure/review info, and attribution summary."""
    return _run_trace(repo, case_id, max_depth)
