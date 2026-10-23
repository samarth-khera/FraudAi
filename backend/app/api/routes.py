"""HTTP routes for cases, fund tracing, reviews, and audit trails."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db.models import utc_now
from app.db.session import SessionLocal, get_db
from app.models.domain import AccountReviewStatus, FraudCase, Transaction
from app.repositories.case_repository import CaseRepository
from app.repositories.sql_case_repository import (
    DuplicateEntityError,
    EntityNotFoundError,
    SqlCaseRepository,
)
from app.schemas.case_management import (
    AccountAssessmentResponse,
    AccountReviewUpdateRequest,
    AuditEventResponse,
    AuditIntegrityStatus,
    AuditSummaryMetrics,
    AuditTrailResponse,
    CaseAccountAssessmentsResponse,
    CaseCreateRequest,
    CaseTransactionsAddRequest,
    CaseUpdateRequest,
    GlobalAuditResponse,
)
from app.schemas.trace import (
    CaseListResponse,
    ErrorResponse,
    GraphResponse,
    HealthResponse,
    TraceResult,
    TransactionListResponse,
)
from app.services.account_assessment import (
    assess_all_case_accounts,
    assess_case_account,
)
from app.services.graph import build_graph
from app.services.tracer import DEFAULT_MAX_DEPTH, TraceError, trace_case

router = APIRouter()

_ERRORS = {
    404: {"model": ErrorResponse},
    409: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
}


def get_repository(db: Optional[Session] = Depends(get_db)) -> CaseRepository:
    """FastAPI dependency for the case repository. Uses SQL-backed repository."""
    if db is None:
        db = SessionLocal()
    return SqlCaseRepository(db)


MaxDepth = Query(
    DEFAULT_MAX_DEPTH,
    ge=0,
    le=50,
    description="Maximum downstream hops from the origin transaction (origin = hop 0).",
)


def _require_case(repo: CaseRepository, case_id: str) -> FraudCase:
    case = repo.get_case(case_id)
    if case is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "case_not_found", "message": f"Case {case_id!r} not found."},
        )
    return case


def _run_trace(repo: CaseRepository, case_id: str, max_depth: int) -> TraceResult:
    case = _require_case(repo, case_id)
    try:
        result = trace_case(
            case,
            repo.get_transactions(case_id),
            repo.get_accounts(),
            repo.get_review_statuses(case_id),
            max_depth=max_depth,
        )
        # Persist calculated trace paths
        repo.save_trace_paths(case_id, result.paths)
        return result
    except TraceError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


# ---------------- System ----------------
@router.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", service="fraudshield-ai-backend", phase="1-synthetic")


# ---------------- Case Management ----------------
@router.get("/api/cases", response_model=CaseListResponse, tags=["cases"])
def list_cases(
    skip: int = Query(0, ge=0, description="Offset for pagination"),
    limit: int = Query(50, ge=1, le=100, description="Limit for pagination"),
    repo: CaseRepository = Depends(get_repository),
) -> CaseListResponse:
    """List all cases with pagination."""
    cases, total = repo.list_cases(skip=skip, limit=limit)
    return CaseListResponse(count=len(cases), total=total, skip=skip, limit=limit, cases=cases)


@router.post(
    "/api/cases",
    response_model=FraudCase,
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
    tags=["cases"],
)
def create_case(
    req: CaseCreateRequest,
    repo: CaseRepository = Depends(get_repository),
) -> FraudCase:
    """Create a new fraud investigation case and record an append-only audit event."""
    case = FraudCase(
        case_id=req.case_id,
        reported_origin_transaction_id=req.reported_origin_transaction_id,
        reported_amount=req.reported_amount,
        currency=req.currency,
        reported_at=req.reported_at or utc_now(),
        investigation_status=req.investigation_status,
        description=req.description,
    )
    try:
        return repo.create_case(case, initial_audit_user=req.created_by)
    except DuplicateEntityError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


@router.get("/api/cases/{case_id}", response_model=FraudCase, responses=_ERRORS, tags=["cases"])
def get_case(case_id: str, repo: CaseRepository = Depends(get_repository)) -> FraudCase:
    """Retrieve details for a specific case."""
    return _require_case(repo, case_id)


@router.patch("/api/cases/{case_id}", response_model=FraudCase, responses=_ERRORS, tags=["cases"])
def update_case(
    case_id: str,
    req: CaseUpdateRequest,
    repo: CaseRepository = Depends(get_repository),
) -> FraudCase:
    """Update case status or description. Appends an audit event."""
    try:
        return repo.update_case(
            case_id=case_id,
            status=req.investigation_status,
            description=req.description,
            user_id=req.updated_by,
        )
    except EntityNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": exc.message})


@router.post(
    "/api/cases/{case_id}/transactions",
    response_model=list[Transaction],
    status_code=status.HTTP_201_CREATED,
    responses=_ERRORS,
    tags=["cases"],
)
def add_case_transactions(
    case_id: str,
    req: CaseTransactionsAddRequest,
    repo: CaseRepository = Depends(get_repository),
) -> list[Transaction]:
    """Add observed transactions to the case transaction store. Rejects conflicting duplicates."""
    _require_case(repo, case_id)
    try:
        return repo.add_transactions(req.transactions, user_id=req.added_by, case_id=case_id)
    except DuplicateEntityError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


@router.put(
    "/api/cases/{case_id}/accounts/{account_id}/review",
    response_model=AccountReviewStatus,
    responses=_ERRORS,
    tags=["cases"],
)
def record_account_review(
    case_id: str,
    account_id: str,
    req: AccountReviewUpdateRequest,
    repo: CaseRepository = Depends(get_repository),
) -> AccountReviewStatus:
    """Record an account review decision with reviewer identity and append-only audit event."""
    try:
        return repo.update_account_review(
            case_id=case_id,
            account_id=account_id,
            review_state=req.review_state,
            evidence_quality=req.evidence_quality,
            notes=req.notes,
            reviewer_id=req.reviewer_id,
            decision_reasons=req.decision_reasons,
            supporting_transaction_ids=req.supporting_transaction_ids,
            additional_info_needed=req.additional_info_needed,
        )
    except EntityNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": exc.message})


@router.get(
    "/api/cases/{case_id}/accounts",
    response_model=CaseAccountAssessmentsResponse,
    responses=_ERRORS,
    tags=["cases"],
)
def list_case_account_assessments(
    case_id: str,
    max_depth: int = MaxDepth,
    repo: CaseRepository = Depends(get_repository),
) -> CaseAccountAssessmentsResponse:
    """Retrieve evidence-aware assessments for all accounts in the case's traced network."""
    case = _require_case(repo, case_id)
    try:
        return assess_all_case_accounts(
            case=case,
            transactions=repo.get_transactions(case_id),
            accounts=repo.get_accounts(),
            review_statuses=repo.get_review_statuses(case_id),
            audit_events=repo.get_audit_events(case_id),
            max_depth=max_depth,
        )
    except TraceError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


@router.get(
    "/api/cases/{case_id}/accounts/{account_id}/assessment",
    response_model=AccountAssessmentResponse,
    responses=_ERRORS,
    tags=["cases"],
)
def get_account_assessment(
    case_id: str,
    account_id: str,
    max_depth: int = MaxDepth,
    repo: CaseRepository = Depends(get_repository),
) -> AccountAssessmentResponse:
    """Retrieve an evidence-aware downstream account assessment for a specific account."""
    case = _require_case(repo, case_id)
    try:
        return assess_case_account(
            case=case,
            account_id=account_id,
            transactions=repo.get_transactions(case_id),
            accounts=repo.get_accounts(),
            review_statuses=repo.get_review_statuses(case_id),
            audit_events=repo.get_audit_events(case_id),
            max_depth=max_depth,
        )
    except EntityNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": exc.message})
    except TraceError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})



@router.get(
    "/api/cases/{case_id}/audit-trail",
    response_model=AuditTrailResponse,
    responses=_ERRORS,
    tags=["cases"],
)
def get_case_audit_trail(
    case_id: str,
    repo: CaseRepository = Depends(get_repository),
) -> AuditTrailResponse:
    """Retrieve the append-only audit trail for an investigation case."""
    try:
        events = repo.get_audit_events(case_id)
        return AuditTrailResponse(
            case_id=case_id,
            count=len(events),
            events=[
                AuditEventResponse(
                    event_id=e.event_id,
                    case_id=e.case_id,
                    timestamp=e.timestamp,
                    action=e.action,
                    performed_by=e.performed_by,
                    entity_type=e.entity_type,
                    entity_id=e.entity_id,
                    details=e.details,
                )
                for e in events
            ],
        )
    except EntityNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": exc.code, "message": exc.message})


def _sanitize_csv_cell(value: Any) -> str:
    if value is None:
        return ""
    s = str(value)
    # Neutralize spreadsheet formula injection (=, +, -, @, \t, \r)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return f"'{s}"
    return s


@router.get(
    "/api/audit",
    response_model=GlobalAuditResponse,
    responses=_ERRORS,
    tags=["audit"],
)
def get_global_audit_events(
    case_id: Optional[str] = Query(None, description="Filter by case ID"),
    action: Optional[str] = Query(None, description="Filter by exact action name"),
    category: Optional[str] = Query(None, description="Filter by category (reviews, case_changes, traces, transactions)"),
    performed_by: Optional[str] = Query(None, description="Filter by actor / reviewer identity"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    search: Optional[str] = Query(None, description="Search across case_id, action, actor, entity_id, and details"),
    start_date: Optional[datetime] = Query(None, description="Start date filter"),
    end_date: Optional[datetime] = Query(None, description="End date filter"),
    skip: int = Query(0, ge=0, description="Offset"),
    limit: int = Query(50, ge=1, le=500, description="Page limit"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order"),
    repo: CaseRepository = Depends(get_repository),
) -> GlobalAuditResponse:
    """Retrieve global audit trail across all cases with server-side filtering, pagination, and integrity metrics."""
    events, total_filtered, summary = repo.list_global_audit_events(
        case_id=case_id,
        action=action,
        category=category,
        performed_by=performed_by,
        entity_type=entity_type,
        search=search,
        start_date=start_date,
        end_date=end_date,
        skip=skip,
        limit=limit,
        sort_order=sort_order,
    )

    integrity = AuditIntegrityStatus(
        storage_backend="SQLite Relational (audit_events)",
        append_only_enforced=True,
        cryptographic_signatures=False,
        server_timestamps=True,
        last_verified_at=utc_now(),
        integrity_disclosure=(
            "Application-enforced append-only audit trail in SQLite. "
            "Server-generated UTC timestamps. No cryptographic hash-chaining or WORM hardware."
        ),
    )

    return GlobalAuditResponse(
        total_count=total_filtered,
        filtered_count=len(events),
        skip=skip,
        limit=limit,
        events=[
            AuditEventResponse(
                event_id=e.event_id,
                case_id=e.case_id,
                timestamp=e.timestamp,
                action=e.action,
                performed_by=e.performed_by,
                entity_type=e.entity_type,
                entity_id=e.entity_id,
                details=e.details,
            )
            for e in events
        ],
        summary=AuditSummaryMetrics(**summary),
        integrity_status=integrity,
    )


@router.get(
    "/api/audit/export.csv",
    tags=["audit"],
)
def export_audit_events_csv(
    case_id: Optional[str] = Query(None, description="Filter by case ID"),
    action: Optional[str] = Query(None, description="Filter by exact action name"),
    category: Optional[str] = Query(None, description="Filter by category"),
    performed_by: Optional[str] = Query(None, description="Filter by actor / reviewer identity"),
    entity_type: Optional[str] = Query(None, description="Filter by entity type"),
    search: Optional[str] = Query(None, description="Search across fields"),
    start_date: Optional[datetime] = Query(None, description="Start date filter"),
    end_date: Optional[datetime] = Query(None, description="End date filter"),
    limit: int = Query(5000, ge=1, le=10000, description="Export limit"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order"),
    repo: CaseRepository = Depends(get_repository),
) -> Response:
    """Stream an RFC-4180 compliant CSV export with formula injection mitigation."""
    events, total_filtered, _ = repo.list_global_audit_events(
        case_id=case_id,
        action=action,
        category=category,
        performed_by=performed_by,
        entity_type=entity_type,
        search=search,
        start_date=start_date,
        end_date=end_date,
        skip=0,
        limit=limit,
        sort_order=sort_order,
    )

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)

    # Header Row
    writer.writerow([
        "Event ID",
        "Timestamp (UTC)",
        "Case ID",
        "Action",
        "Performed By",
        "Entity Type",
        "Entity ID",
        "Details JSON",
    ])

    for e in events:
        details_str = json.dumps(e.details) if e.details else ""
        writer.writerow([
            _sanitize_csv_cell(e.event_id),
            _sanitize_csv_cell(e.timestamp.isoformat() if e.timestamp else ""),
            _sanitize_csv_cell(e.case_id),
            _sanitize_csv_cell(e.action),
            _sanitize_csv_cell(e.performed_by),
            _sanitize_csv_cell(e.entity_type),
            _sanitize_csv_cell(e.entity_id),
            _sanitize_csv_cell(details_str),
        ])

    csv_data = output.getvalue()
    date_str = utc_now().strftime("%Y%m%d_%H%M%S")
    filename = f"fraudshield_audit_export_{date_str}.csv"

    return Response(
        content=csv_data,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-cache",
        },
    )


# ---------------- Fund Tracing & Graph ----------------
@router.get(
    "/api/cases/{case_id}/transactions",
    response_model=TransactionListResponse,
    responses=_ERRORS,
    tags=["cases"],
)
def get_case_transactions(
    case_id: str,
    max_depth: int = MaxDepth,
    repo: CaseRepository = Depends(get_repository),
) -> TransactionListResponse:
    """Chronological transactions in the traced downstream network (origin included)."""
    result = _run_trace(repo, case_id, max_depth)
    return TransactionListResponse(
        case_id=case_id,
        count=len(result.traced_transactions),
        transactions=result.traced_transactions,
        warnings=result.warnings,
    )


@router.get(
    "/api/cases/{case_id}/graph",
    response_model=GraphResponse,
    responses=_ERRORS,
    tags=["cases"],
)
def get_case_graph(
    case_id: str,
    max_depth: int = MaxDepth,
    repo: CaseRepository = Depends(get_repository),
) -> GraphResponse:
    """Nodes/edges formatted for frontend graph visualizers."""
    result = _run_trace(repo, case_id, max_depth)
    return build_graph(result, repo.get_accounts(), repo.get_review_statuses(case_id))


@router.get(
    "/api/cases/{case_id}/trace",
    response_model=TraceResult,
    responses=_ERRORS,
    tags=["cases"],
)
def get_case_trace(
    case_id: str,
    max_depth: int = MaxDepth,
    repo: CaseRepository = Depends(get_repository),
) -> TraceResult:
    """Paths, per-account fund exposure, review info, and attribution summary."""
    return _run_trace(repo, case_id, max_depth)
