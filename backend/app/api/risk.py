"""POST /api/risk/score and POST /api/risk/explain: ML risk scoring and local feature explanations (decision support only)."""

from __future__ import annotations

import logging
from typing import Literal, Union

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.trace import ErrorResponse
from app.services.risk_scoring import (
    DISCLAIMER, ModelUnavailableError, RiskScoringService, get_risk_service,
)

logger = logging.getLogger("fraudshield.risk")
router = APIRouter(prefix="/api/risk", tags=["risk"])


# Literal (not Enum): strict validation of JSON strings works with it, and the allowed values
# mirror `known_transaction_types` in the saved feature schema.
RiskTransactionType = Literal["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]
ContributionDirection = Literal["increases_risk", "decreases_risk", "neutral"]
EncodingKind = Literal["one_hot_summed", "numeric"]


class RiskScoreRequest(BaseModel):
    """Exactly the inputs of the saved ``pre_transaction`` feature schema. Extra fields,
    missing fields, strings-for-numbers and NaN/Infinity are rejected."""

    model_config = ConfigDict(extra="forbid", strict=True)

    step: int = Field(ge=1, description="Hour index of the transaction (1 = first simulated hour).")
    type: RiskTransactionType
    amount: float = Field(ge=0, allow_inf_nan=False)
    oldbalanceOrg: float = Field(ge=0, allow_inf_nan=False, description="Sender balance BEFORE the transaction.")
    oldbalanceDest: float = Field(ge=0, allow_inf_nan=False, description="Receiver balance BEFORE the transaction.")


class RiskScoreResponse(BaseModel):
    risk_score: float = Field(ge=0, le=1)
    threshold: float
    review_recommended: bool
    model_version: str
    feature_set: str
    decision_support_only: bool = True
    automated_action_taken: str = "none"
    disclaimer: str = DISCLAIMER


class FeatureContribution(BaseModel):
    feature: str
    label: str
    value: Union[float, str]
    contribution: float = Field(
        description="Additive contribution to raw log-odds output. Positive values push risk higher; negative values push risk lower."
    )
    direction: ContributionDirection
    encoding: EncodingKind


class EncodedFeatureContribution(BaseModel):
    feature: str
    encoded_value: float
    contribution: float


class RiskExplainResponse(BaseModel):
    risk_score: float = Field(ge=0, le=1)
    threshold: float
    review_recommended: bool
    model_version: str
    feature_set: str
    explanation_method: str
    prediction_scale: str = "log_odds"
    base_value: float = Field(description="Baseline expected log-odds output before feature contributions.")
    raw_margin: float = Field(description="Total log-odds output (base_value + sum of feature contributions).")
    feature_contributions: list[FeatureContribution]
    encoded_contributions: list[EncodedFeatureContribution]
    representation_notes: str
    limitations: list[str]
    decision_support_only: bool = True
    automated_action_taken: str = "none"
    disclaimer: str = DISCLAIMER


@router.post("/score", response_model=RiskScoreResponse,
             responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
def score_transaction(req: RiskScoreRequest,
                      service: RiskScoringService = Depends(get_risk_service)) -> RiskScoreResponse:
    """Score one transaction. Returns a risk score, the saved threshold and a review recommendation."""
    try:
        result = service.score({**req.model_dump(mode="json")})
    except ModelUnavailableError:
        raise HTTPException(status_code=503, detail={
            "code": "model_unavailable",
            "message": "The risk model is currently unavailable."})
    except Exception as exc:
        logger.error("Scoring failed (%s: %s)", type(exc).__name__, exc)
        raise HTTPException(status_code=500, detail={
            "code": "scoring_failed", "message": "The transaction could not be scored."})
    return RiskScoreResponse(**result)


@router.post("/explain", response_model=RiskExplainResponse,
             responses={422: {"model": ErrorResponse}, 503: {"model": ErrorResponse}})
def explain_transaction(req: RiskScoreRequest,
                        service: RiskScoringService = Depends(get_risk_service)) -> RiskExplainResponse:
    """Score and explain one transaction using exact local feature contributions (TreeSHAP / log-odds)."""
    try:
        result = service.explain({**req.model_dump(mode="json")})
    except ModelUnavailableError:
        raise HTTPException(status_code=503, detail={
            "code": "model_unavailable",
            "message": "The risk model is currently unavailable."})
    except Exception as exc:
        logger.error("Explanation failed (%s: %s)", type(exc).__name__, exc)
        raise HTTPException(status_code=500, detail={
            "code": "explanation_failed", "message": "The transaction prediction could not be explained."})
    return RiskExplainResponse(**result)

