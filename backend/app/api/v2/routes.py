"""FastAPI route handlers for FraudShield AI V2 Forensic Intelligence."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

logger = logging.getLogger("fraudshield.v2.api")

V2AccountIdPath = Path(
    ...,
    min_length=1,
    max_length=64,
    pattern=r"^[A-Za-z0-9_\-\.]+$",
    description="Account identifier",
)

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
    from app.api.v2.investigation_schemas import DataSourceInfo, InvestigationRequest, InvestigationResponse
    from app.db.v2.session import get_v2_db
    from app.services.v2 import data_source
    from app.services.v2.investigation import AccountNotFound, InvestigationService
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
    from backend.app.api.v2.investigation_schemas import DataSourceInfo, InvestigationRequest, InvestigationResponse
    from backend.app.db.v2.session import get_v2_db
    from backend.app.services.v2 import data_source
    from backend.app.services.v2.investigation import AccountNotFound, InvestigationService
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
    account_id: str = V2AccountIdPath,
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
    account_id: str = V2AccountIdPath,
    direction: str = Query("all", pattern="^(all|inbound|outbound)$", description="Filter by flow direction"),
    channel: Optional[str] = Query(None, max_length=32, pattern=r"^[A-Za-z0-9_\-]+$", description="Filter by payment rail (UPI, IMPS, NEFT, RTGS, etc.)"),
    limit: int = Query(50, ge=1, le=500, description="Page limit"),
    offset: int = Query(0, ge=0, le=100000, description="Page offset"),
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
    account_id: str = V2AccountIdPath,
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
    account_id: str = Query(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-\.]+$", description="Root account identifier to start traversal from"),
    direction: str = Query("outgoing", pattern="^(outgoing|incoming|both)$", description="Flow direction"),
    max_depth: int = Query(3, ge=1, le=6, description="Maximum traversal hop depth"),
    max_nodes: int = Query(50, ge=1, le=200, description="Maximum accounts in returned graph"),
    min_amount: float = Query(0.0, ge=0.0, le=1_000_000_000.0, description="Minimum transaction amount filter"),
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
    account_id: str = V2AccountIdPath,
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
    description="Orchestrates on-demand real-time feature extraction, rule assessment, ML inference, TreeSHAP explanation, and advisory recommendation generation. Read-only: computes from the ledger and stores nothing, so it needs no write permission.",
)
def run_live_account_analysis(
    account_id: str = V2AccountIdPath,
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
        logger.error("Live account analysis failed for %s: %s", account_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "code": "analysis_failed",
                "message": "Live account analysis failed. Please verify account data and retry.",
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



def _source_unavailable(exc: "data_source.DataSourceUnavailable") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": exc.code, "message": exc.message}
    )


@router.get(
    "/data-source",
    response_model=DataSourceInfo,
    summary="Configured Transaction Ledger",
    description="Which ledger the V2 APIs query, whether it is synthetic, and how fresh it is (from a fresh query).",
)
def get_data_source(db: Session = Depends(get_v2_db)) -> DataSourceInfo:
    try:
        return DataSourceInfo.model_validate(data_source.describe(db))
    except data_source.DataSourceUnavailable as exc:
        raise _source_unavailable(exc)


@router.post(
    "/investigations",
    response_model=InvestigationResponse,
    summary="Run a Victim-First Investigation",
    description=(
        "Starts from the entered account, flags its unusual transfers against its own history, traces where the funds "
        "went and came from, assesses each linked account with the rules and the account model, and returns an "
        "evidence-referenced report. Computed on request from the configured ledger; nothing is stored, so it needs "
        "no write permission. If the AI analyst is enabled and the privacy policy allows it, a Gemini explanation is "
        "added in `ai_analysis`; its `state` says whether it ran, and an AI failure never fails the investigation."
    ),
)
async def run_investigation(req: InvestigationRequest, db: Session = Depends(get_v2_db)) -> InvestigationResponse:
    try:
        return await InvestigationService.run_async(db, req)
    except AccountNotFound:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "code": "account_not_found",
                "message": f"Account '{req.account_id}' is not in the configured ledger. Check the ID (for example ACC-000001).",
            },
        )
    except data_source.DataSourceUnavailable as exc:
        raise _source_unavailable(exc)
    except Exception as e:  # noqa: BLE001 - report a failure, never a partial report
        logger.error("Investigation failed for %s: %s", req.account_id, e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "investigation_failed", "message": "The investigation could not be completed. No report was produced."},
        )
