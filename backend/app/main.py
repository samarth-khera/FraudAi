"""FastAPI application entrypoint (Phase 1: synthetic fund tracing)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.risk import router as risk_router
from app.api.routes import router
from app.services.risk_scoring import get_risk_service


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the saved model once at startup. Never trains. A failure is cached and the
    # rest of the API (case tracing) keeps working; /api/risk/score then returns 503.
    get_risk_service().load()
    yield


def _error(status: int, code: str, message: str, details=None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details}}
    return JSONResponse(status_code=status, content=body)


def create_app() -> FastAPI:
    app = FastAPI(
        title="FraudShield AI - Phase 1 Backend",
        description="Synthetic fund-tracing demo. Connection to a reported fraud is NOT a "
                    "finding of guilt. All data is synthetic; not production-bank ready.",
        version="0.2.0",
        lifespan=lifespan,
    )
    app.include_router(router)
    app.include_router(risk_router)

    @app.exception_handler(StarletteHTTPException)
    async def http_exc(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict) and "code" in exc.detail:
            return _error(exc.status_code, exc.detail["code"], exc.detail.get("message", ""))
        code = "not_found" if exc.status_code == 404 else "http_error"
        return _error(exc.status_code, code, str(exc.detail))

    @app.exception_handler(RequestValidationError)
    async def validation_exc(_: Request, exc: RequestValidationError) -> JSONResponse:
        details = [{"loc": [str(x) for x in e["loc"]], "msg": e["msg"]} for e in exc.errors()]
        return _error(422, "validation_error", "Invalid request parameters.", details)

    return app


app = create_app()
