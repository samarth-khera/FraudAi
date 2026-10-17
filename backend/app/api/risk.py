"""POST /api/risk/score: ML risk scoring for a single transaction (decision support only)."""

from __future__ import annotations

import logging
from typing import Literal

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
