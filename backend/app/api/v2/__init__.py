"""FraudShield AI V2 API Module."""

try:
    from app.api.v2.routes import router
except ModuleNotFoundError:
    from backend.app.api.v2.routes import router

__all__ = ["router"]
