"""Dataset listing, in-dataset account lookup and the dynamic (model-driven) investigation."""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

try:
    from app.api.v2.dynamic_schemas import DatasetId, DatasetSummary, DynamicInvestigationRequest, DynamicInvestigationResponse
    from app.api.v2.investigation_schemas import DataSourceInfo, InvestigationExplanationResponse
    from app.db.v2.models import AccountModel, TransactionModel
    from app.db.v2.session import get_v2_db
    from app.intelligence import models as mdl
    from app.intelligence.datasets import DATASETS, DatasetRegistry, get_dataset_registry
    from app.intelligence.engine import DynamicInvestigation
    from app.intelligence.features import MIN_ACCOUNT_TRANSACTIONS
    from app.services.v2 import ai_analyst, data_source
    from app.services.v2.investigation import AccountNotFound, InvestigationService
except ModuleNotFoundError:
    from backend.app.api.v2.dynamic_schemas import DatasetId, DatasetSummary, DynamicInvestigationRequest, DynamicInvestigationResponse
    from backend.app.api.v2.investigation_schemas import DataSourceInfo, InvestigationExplanationResponse
    from backend.app.db.v2.models import AccountModel, TransactionModel
    from backend.app.db.v2.session import get_v2_db
    from backend.app.intelligence import models as mdl
    from backend.app.intelligence.datasets import DATASETS, DatasetRegistry, get_dataset_registry
    from backend.app.intelligence.engine import DynamicInvestigation
    from backend.app.intelligence.features import MIN_ACCOUNT_TRANSACTIONS
    from backend.app.services.v2 import ai_analyst, data_source
    from backend.app.services.v2.investigation import AccountNotFound, InvestigationService

logger = logging.getLogger("fraudshield.v2.dynamic")
router = APIRouter()
AccountIdPath = Path(..., min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_\-\.]+$")


def _not_found(account_id: str, dataset_id: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={
        "code": "account_not_found",
        "message": f"Account '{account_id}' is not in the {DATASETS[dataset_id].title.lower()}. Account IDs can only be "
                   "searched inside the selected synthetic dataset; FraudShield cannot look up real-world bank accounts.",
    })


def _unavailable(exc: data_source.DataSourceUnavailable) -> HTTPException:
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail={"code": exc.code, "message": exc.message})


def _session(registry: DatasetRegistry, dataset_id: str, demo_db: Session) -> Session:
    ok, why = registry.available(dataset_id)
    if not ok:
        raise data_source.DataSourceUnavailable("dataset_unavailable", why)
    return demo_db if dataset_id == "demo-ledger" else registry.open(dataset_id)


@router.get("/datasets", response_model=list[DatasetSummary], summary="Datasets an investigation can search")
def list_datasets(db: Session = Depends(get_v2_db), registry: DatasetRegistry = Depends(get_dataset_registry)) -> list[DatasetSummary]:
    out = []
    for ds_id, spec in DATASETS.items():
        item = {"dataset_id": ds_id, "title": spec.title, "description": spec.description,
                "evaluation_labels_note": spec.evaluation_labels_note, "available": False}
        try:
            s = _session(registry, ds_id, db)
            try:
                item["source"] = DataSourceInfo.model_validate(registry.describe(ds_id, s))
                item["available"] = True
            finally:
                if s is not db:
                    s.close()
        except data_source.DataSourceUnavailable as exc:
            item["unavailable_reason"] = exc.message
        out.append(DatasetSummary.model_validate(item))
    return out


@router.get("/datasets/{dataset_id}/accounts/{account_id}",
            summary="Account lookup inside one dataset (history coverage only; no prediction, no personal data)")
def dataset_account(dataset_id: DatasetId, account_id: str = AccountIdPath, db: Session = Depends(get_v2_db),
                    registry: DatasetRegistry = Depends(get_dataset_registry)) -> dict:
    try:
        s = _session(registry, dataset_id, db)
    except data_source.DataSourceUnavailable as exc:
        raise _unavailable(exc)
    try:
        acc = s.scalar(select(AccountModel).where(AccountModel.account_id == account_id))
        if acc is None:
            raise _not_found(account_id, dataset_id)
        involves = or_(TransactionModel.origin_account_id == account_id, TransactionModel.destination_account_id == account_id)
        n, first, last = s.execute(select(func.count(), func.min(TransactionModel.timestamp), func.max(TransactionModel.timestamp)).where(involves)).one()
        n_out = s.scalar(select(func.count()).where(TransactionModel.origin_account_id == account_id)) or 0
        models = {}
        for name in ("transaction_model", "account_model"):
            try:
                models[name] = {"available": True, "model_version": mdl.load(name).version}
            except mdl.ModelArtifactUnavailable as exc:
                models[name] = {"available": False, "reason": str(exc)}
        return {
            "dataset_id": dataset_id, "dataset_title": DATASETS[dataset_id].title, "account_id": account_id, "exists": True,
            "customer_type": acc.customer_type, "account_opened_at": acc.account_opened_at.isoformat() if acc.account_opened_at else None,
            "transactions": int(n), "outgoing": int(n_out), "incoming": int(n - n_out),
            "first_transaction_at": first.isoformat() if first else None, "last_transaction_at": last.isoformat() if last else None,
            "history_sufficient": int(n) >= MIN_ACCOUNT_TRANSACTIONS, "minimum_history": MIN_ACCOUNT_TRANSACTIONS,
            "coverage_note": ("Enough history for the account behaviour model." if int(n) >= MIN_ACCOUNT_TRANSACTIONS else
                              f"Fewer than {MIN_ACCOUNT_TRANSACTIONS} transfers: models will abstain and report insufficient history."),
            "models": models, "synthetic": True,
            # Whether the models' outputs count as evidence on this dataset; when not, they are shown for reference only.
            "models_validated": DATASETS[dataset_id].model_support == "validated_in_distribution",
            "model_support": DATASETS[dataset_id].model_support, "model_note": DATASETS[dataset_id].model_note,
        }
    finally:
        if s is not db:
            s.close()


@router.get("/datasets/{dataset_id}/sample-accounts",
            summary="A few accounts with notable observable activity, as starting points (not findings)")
def sample_accounts(dataset_id: DatasetId, db: Session = Depends(get_v2_db),
                    registry: DatasetRegistry = Depends(get_dataset_registry)) -> dict:
    """Chosen only from recorded transfers (largest outgoing transfer relative to the balance it was paid from, 10,000
    or more, personal accounts). Scenario labels are not used, so a suggestion says nothing about the account."""
    try:
        s = _session(registry, dataset_id, db)
    except data_source.DataSourceUnavailable as exc:
        raise _unavailable(exc)
    try:
        ratio = func.max(TransactionModel.amount / TransactionModel.origin_balance_before)
        rows = s.execute(
            select(TransactionModel.origin_account_id, ratio.label("r"), func.max(TransactionModel.amount).label("a"))
            .join(AccountModel, AccountModel.account_id == TransactionModel.origin_account_id)
            .where(AccountModel.customer_type.in_(("retail", "student")), TransactionModel.amount >= 10_000,
                   TransactionModel.origin_balance_before > 0)
            .group_by(TransactionModel.origin_account_id).order_by(ratio.desc(), TransactionModel.origin_account_id).limit(6)
        ).all()
        return {"dataset_id": dataset_id,
                "basis": "Personal accounts whose largest outgoing transfer (10,000 or more) took the biggest share of the "
                         "balance it was paid from. Observable activity only; not a finding about any account.",
                "accounts": [{"account_id": a, "reason": f"One transfer took {r:.0%} of its balance (largest transfer {amt:,.0f})."}
                             for a, r, amt in rows]}
    finally:
        if s is not db:
            s.close()


async def _dynamic(fn, req, db, registry):
    try:
        return await fn(req, db, registry)
    except AccountNotFound:
        raise _not_found(req.account_id, req.dataset_id)
    except data_source.DataSourceUnavailable as exc:
        raise _unavailable(exc)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - a failure, never a partial report
        logger.error("Dynamic investigation failed for %s: %s", req.account_id, e, exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail={"code": "investigation_failed", "message": "The investigation could not be completed. No report was produced."})


def _require_account(registry: DatasetRegistry, dataset_id: str, account_id: str, demo_db: Session) -> None:
    """Raises AccountNotFound (404) or DataSourceUnavailable (503); one indexed lookup, nothing computed."""
    s = _session(registry, dataset_id, demo_db)
    try:
        if s.scalar(select(AccountModel.account_id).where(AccountModel.account_id == account_id)) is None:
            raise AccountNotFound(account_id)
    finally:
        if s is not demo_db:
            s.close()


async def _run(req: DynamicInvestigationRequest, db, registry, provider=None) -> DynamicInvestigationResponse:
    out, base, clock = await run_in_threadpool(DynamicInvestigation.compute, registry, db, req)
    if req.ai_explanation == "separate":
        # 'deferred' only when the explanation request could produce one; otherwise the analyst's real state now, so the
        # client does not send a second request that recomputes the whole investigation for nothing.
        base["ai_analysis"] = ai_analyst.precheck(base, provider) or ai_analyst.deferred()
    else:
        base["ai_analysis"] = await ai_analyst.analyze(base, provider, dynamic=out)
    out["investigation"] = InvestigationService._finish(base, clock)
    return DynamicInvestigationResponse.model_validate(out)


async def _explain(req: DynamicInvestigationRequest, db, registry, provider=None) -> InvestigationExplanationResponse:
    clock = time.perf_counter()
    # An unknown account is a 404 whatever the AI state.
    await run_in_threadpool(_require_account, registry, req.dataset_id, req.account_id, db)
    early = ai_analyst.precheck(None, provider)
    if early is not None:
        # Nothing could be explained, so the investigation is not recomputed. No report was explained, hence no digest.
        return InvestigationExplanationResponse(account_id=req.account_id, report_digest="", data_as_of=None,
                                                duration_ms=int((time.perf_counter() - clock) * 1000), ai_analysis=early)
    out, base, _ = await run_in_threadpool(DynamicInvestigation.compute, registry, db, req)
    ai = await ai_analyst.analyze(base, provider, dynamic=out)
    return InvestigationExplanationResponse(account_id=base["victim"]["account_id"], report_digest=base["report_digest"],
                                            data_as_of=base["data_source"]["data_as_of"],
                                            duration_ms=int((time.perf_counter() - clock) * 1000), ai_analysis=ai)


@router.post("/dynamic-investigations", response_model=DynamicInvestigationResponse,
             summary="Model-driven investigation of one account in a chosen synthetic dataset",
             description="Looks the account up in the chosen dataset, scores its transfers with the transaction model "
                         "(point-in-time features), traces the money, assesses every connected account's possible role with "
                         "documented rules over model and network evidence, and returns an advisory restriction state. "
                         "Read-only: nothing is stored and no account is ever acted on.")
async def run_dynamic_investigation(req: DynamicInvestigationRequest, db: Session = Depends(get_v2_db),
                                    registry: DatasetRegistry = Depends(get_dataset_registry)) -> DynamicInvestigationResponse:
    return await _dynamic(_run, req, db, registry)


@router.post("/dynamic-investigations/explanation", response_model=InvestigationExplanationResponse,
             summary="AI explanation for a dynamic investigation",
             description="Recomputes the same investigation on the server and runs the optional AI analyst on it. Show the "
                         "result only next to a report whose investigation.report_digest matches.")
async def explain_dynamic_investigation(req: DynamicInvestigationRequest, db: Session = Depends(get_v2_db),
                                        registry: DatasetRegistry = Depends(get_dataset_registry)) -> InvestigationExplanationResponse:
    return await _dynamic(_explain, req, db, registry)
