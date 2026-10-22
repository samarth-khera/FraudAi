"""FastAPI route handlers for FraudShield AI V2 Forensic Intelligence."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

try:
    from app.api.v2.schemas import (
        AccountAssessmentResponse,
        AccountLiveAnalysisResponse,
        AccountMLAssessmentResponse,
        AccountProfileResponse,
        AccountTransactionsResponse,
        ModelStatusResponse,
        TraceGraphResponse,
    )
    from app.db.v2.session import get_v2_db
    from app.services.v2.account_service import AccountService
    from app.services.v2.graph_tracer import ForensicGraphTracer
    from app.services.v2.live_analysis import AccountLiveAnalysisService
    from app.services.v2.ml_service import ModelUnavailableException, V2MLInferenceService
    from app.services.v2.risk_assessment import AccountRiskAssessor
except ModuleNotFoundError:
    from backend.app.api.v2.schemas import (
        AccountAssessmentResponse,
        AccountLiveAnalysisResponse,
        AccountMLAssessmentResponse,
        AccountProfileResponse,
        AccountTransactionsResponse,
        ModelStatusResponse,
        TraceGraphResponse,
    )
    from backend.app.db.v2.session import get_v2_db
    from backend.app.services.v2.account_service import AccountService
    from backend.app.services.v2.graph_tracer import ForensicGraphTracer
    from backend.app.services.v2.live_analysis import AccountLiveAnalysisService
    from backend.app.services.v2.ml_service import ModelUnavailableException, V2MLInferenceService
    from backend.app.services.v2.risk_assessment import AccountRiskAssessor

router = APIRouter()


@router.get(
    "/accounts/{account_id}",
    response_model=AccountProfileResponse,
    summary="Retrieve Account 360° Profile",
    description="Returns KYC metadata, current balance, and calculated ledger summary metrics.",
)
def get_account(
    account_id: str,
    db: Session = Depends(get_v2_db),
) -> AccountProfileResponse:
    profile = AccountService.get_account_profile(db, account_id)
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "account_not_found",
                "message": f"Account '{account_id}' was not found in the V2 ledger.",
            },
        )
    return profile


@router.get(
    "/accounts/{account_id}/transactions",
    response_model=AccountTransactionsResponse,
    summary="Retrieve Account Transaction Ledger",
    description="Returns paginated chronological transactions with running balance and counterparty relationships.",
)
def get_account_transactions(
    account_id: str,
    direction: str = Query("all", pattern="^(all|inbound|outbound)$", description="Filter by flow direction"),
    channel: Optional[str] = Query(None, description="Filter by payment rail (UPI, IMPS, NEFT, RTGS, etc.)"),
    limit: int = Query(50, ge=1, le=500, description="Page limit"),
    offset: int = Query(0, ge=0, description="Page offset"),
    order: str = Query("desc", pattern="^(asc|desc)$", description="Chronological ordering"),
    db: Session = Depends(get_v2_db),
) -> AccountTransactionsResponse:
    txns = AccountService.get_account_transactions(
        db,
        account_id=account_id,
        direction=direction,
        channel=channel,
        limit=limit,
        offset=offset,
        order=order,
    )
    if not txns:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "account_not_found",
                "message": f"Account '{account_id}' was not found in the V2 ledger.",
            },
        )
    return txns


@router.get(
    "/accounts/{account_id}/assessment",
    response_model=AccountAssessmentResponse,
    summary="Compute Explainable Account Risk Assessment",
    description="Calculates transparent behavioral signals (velocity, pass-through, spikes, dormancy) and advisory risk score.",
)
def get_account_assessment(
    account_id: str,
    db: Session = Depends(get_v2_db),
) -> AccountAssessmentResponse:
    assessment = AccountRiskAssessor.assess_account(db, account_id)
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "account_not_found",
                "message": f"Account '{account_id}' was not found in the V2 ledger.",
            },
        )
    return assessment


@router.get(
    "/trace",
    response_model=TraceGraphResponse,
    summary="Forensic Multi-Hop Fund Tracing",
    description="Traverses multi-hop transaction graphs with cycle-detection, chronological ordering, and exposure bounding.",
)
def trace_funds(
    account_id: str = Query(..., description="Root account identifier to start traversal from"),
    direction: str = Query("outgoing", pattern="^(outgoing|incoming|both)$", description="Flow direction"),
    max_depth: int = Query(3, ge=1, le=6, description="Maximum traversal hop depth"),
    max_nodes: int = Query(50, ge=1, le=200, description="Maximum accounts in returned graph"),
    min_amount: float = Query(0.0, ge=0.0, description="Minimum transaction amount filter"),
    time_window_hours: Optional[float] = Query(None, ge=0.5, le=720.0, description="Maximum window relative to parent transfer"),
    db: Session = Depends(get_v2_db),
) -> TraceGraphResponse:
    graph = ForensicGraphTracer.trace_account_funds(
        db,
        account_id=account_id,
        direction=direction,
        max_depth=max_depth,
        max_nodes=max_nodes,
        min_amount=min_amount,
        time_window_hours=time_window_hours,
    )
    if not graph:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "account_not_found",
                "message": f"Root account '{account_id}' was not found in the V2 ledger.",
            },
        )
    return graph


@router.get(
    "/models/status",
    response_model=ModelStatusResponse,
    summary="V2 Machine Learning Models Status",
    description="Returns availability, versions, feature dimensions, and evaluation metrics for V2 models.",
)
def get_models_status() -> ModelStatusResponse:
    return V2MLInferenceService.get_model_status()


@router.get(
    "/accounts/{account_id}/ml-assessment",
    response_model=AccountMLAssessmentResponse,
    summary="Machine Learning Account Risk Assessment",
    description="Evaluates account using the V2 tabular gradient boosting model with local TreeSHAP attribution.",
)
def get_account_ml_assessment(
    account_id: str,
    db: Session = Depends(get_v2_db),
) -> AccountMLAssessmentResponse:
    try:
        assessment = V2MLInferenceService.assess_account(db, account_id)
    except ModelUnavailableException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "model_unavailable",
                "message": str(e),
            },
        )

    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "account_not_found",
                "message": f"Account '{account_id}' was not found in the V2 ledger.",
            },
        )
    return assessment


@router.post(
    "/accounts/{account_id}/analyze",
    response_model=AccountLiveAnalysisResponse,
    summary="Execute Fresh Live Account Risk Analysis",
    description="Orchestrates on-demand real-time feature extraction, rule assessment, ML inference, TreeSHAP explanation, and advisory recommendation generation.",
)
def run_live_account_analysis(
    account_id: str,
    db: Session = Depends(get_v2_db),
) -> AccountLiveAnalysisResponse:
    try:
        analysis = AccountLiveAnalysisService.run_analysis(db, account_id)
    except ModelUnavailableException as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "model_unavailable",
                "message": str(e),
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "analysis_failed",
                "message": f"Live account analysis failed: {e}",
            },
        )

    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "account_not_found",
                "message": f"Account '{account_id}' was not found in the V2 ledger.",
            },
        )

    return analysis

