"""FastAPI application entrypoint (Phase 1: synthetic fund tracing)."""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.risk import router as risk_router
from app.api.routes import router
from app.db.seed import seed_demo_data
from app.db.session import Base, SessionLocal, engine
from app.services.risk_scoring import get_risk_service

try:
    from app.api.v2.routes import router as v2_router
except ModuleNotFoundError:
    from backend.app.api.v2.routes import router as v2_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Initialize database tables and seed demo scenario idempotently
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_data(db)

    # Load the saved model once at startup. Never trains. A failure is cached and the
    # rest of the API (case tracing) keeps working; /api/risk/score then returns 503.
    get_risk_service().load()
    yield


def _error(status: int, code: str, message: str, details=None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "details": details}}
    return JSONResponse(status_code=status, content=body)


def create_app() -> FastAPI:
    # Ensure database tables exist and seed demo data
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_demo_data(db)

    app = FastAPI(
        title="FraudShield AI - Backend",
        description="Synthetic fund-tracing demo and ML risk scoring backend. Connection to a "
                    "reported fraud is NOT a finding of guilt. All data is synthetic; not production-bank ready.",
        version="0.3.0",
        lifespan=lifespan,
    )

    allowed_origins = [
        o.strip()
        for o in os.getenv(
            "CORS_ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:4173,http://127.0.0.1:4173",
        ).split(",")
        if o.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins if "*" not in allowed_origins else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router)
    app.include_router(risk_router)
    app.include_router(v2_router, prefix="/api/v2", tags=["v2-investigations"])

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
