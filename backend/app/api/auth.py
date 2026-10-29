"""API write access and how actor identity is recorded.

What this module does and does not establish:

* With ``ADMIN_API_KEY`` (or ``FRAUDSHIELD_API_KEY``) set, every state-changing endpoint requires that key
  in ``X-API-Key`` or ``Authorization: Bearer``. A valid key proves only that the caller holds the shared key.
* No endpoint verifies *who* the reviewer is. ``reviewer_id`` / ``updated_by`` / ``created_by`` / ``added_by``
  are self-reported names. They are recorded as such and never marked as verified identities.
* Without a key, writes are open. That is the local-development mode; it is refused when
  ``ENVIRONMENT=production`` so an unconfigured deployment fails closed instead of accepting anonymous writes.
* There are no roles or user accounts.
"""

from __future__ import annotations

import logging
import os
import secrets
from typing import Any, Optional

from fastapi import Header, HTTPException, status
from pydantic import BaseModel

logger = logging.getLogger("fraudshield.auth")

# Names the application itself writes into the audit trail. A caller may not claim them.
RESERVED_ACTOR_IDS = frozenset({"system_seeder", "tracer_service", "api_key_admin", "local_dev_user"})

WRITE_ACCESS_API_KEY = "api_key_required"
WRITE_ACCESS_OPEN_LOCAL = "open_local_development"
WRITE_ACCESS_DISABLED = "disabled_no_key_configured"


class AuthContext(BaseModel):
    """Context describing the authorization status of the incoming request."""

    is_authenticated: bool
    actor_id: str
    auth_method: str  # "api_key" | "local_development"
    # Always False: no mechanism here verifies a person's identity (see module docstring).
    verified: bool = False


def _configured_key() -> Optional[str]:
    return os.getenv("ADMIN_API_KEY") or os.getenv("FRAUDSHIELD_API_KEY") or None


def _is_production() -> bool:
    return os.getenv("ENVIRONMENT", "development").strip().lower() == "production"


def write_access_mode() -> str:
    """How state-changing endpoints are protected in the current configuration."""
    if _configured_key():
        return WRITE_ACCESS_API_KEY
    return WRITE_ACCESS_DISABLED if _is_production() else WRITE_ACCESS_OPEN_LOCAL


def log_write_access_mode() -> None:
    mode = write_access_mode()
    if mode == WRITE_ACCESS_OPEN_LOCAL:
        logger.warning(
            "Write endpoints are OPEN (no API key configured). Local development only; "
            "do not expose this server publicly. Set ADMIN_API_KEY to require a key."
        )
    elif mode == WRITE_ACCESS_DISABLED:
        logger.error("ENVIRONMENT=production but no API key is configured: all write endpoints are disabled.")


def is_reserved_actor(name: Optional[str]) -> bool:
    return bool(name) and name.strip().lower() in RESERVED_ACTOR_IDS


def reject_reserved_actor(name: str) -> str:
    """Pydantic field validator body: callers may not record actions as the application itself."""
    if is_reserved_actor(name):
        raise ValueError("This name is reserved for actions recorded by the application itself.")
    return name


def audit_identity_fields(auth_context: Optional[AuthContext]) -> dict[str, Any]:
    """Identity facts written into every audit event for a client write.

    ``reviewer_identity_verified`` and ``actor_identity_verified`` are kept for older readers and are
    always False: an API key authenticates the request, not the name typed into it.
    """
    authenticated = bool(auth_context and auth_context.is_authenticated)
    return {
        "reviewer_name_source": "self_reported",
        "reviewer_identity_verified": False,
        "actor_identity_verified": False,
        "request_authenticated": authenticated,
        "auth_method": auth_context.auth_method if auth_context else "local_development",
        "auth_context": auth_context.auth_method if auth_context else "local_development",
    }


def verify_write_permission(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> AuthContext:
    """Dependency for every state-changing endpoint. See the module docstring for what it guarantees."""
    configured_key = _configured_key()

    provided_key: Optional[str] = None
    if x_api_key:
        provided_key = x_api_key.strip()
    elif authorization and authorization.lower().startswith("bearer "):
        provided_key = authorization[7:].strip()
    elif authorization:
        provided_key = authorization.strip()

    if configured_key:
        if not provided_key or not secrets.compare_digest(provided_key, configured_key):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={
                    "code": "unauthorized",
                    "message": "Valid API key or authorization token required for state-changing operations.",
                },
                headers={"WWW-Authenticate": "Bearer"},
            )
        return AuthContext(is_authenticated=True, actor_id="api_key_holder", auth_method="api_key")

    if _is_production():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "write_access_not_configured",
                "message": "Changes are disabled on this server because no API key is configured.",
            },
        )

    # Local development: permitted, and recorded as an unauthenticated request.
    return AuthContext(is_authenticated=False, actor_id="local_dev_user", auth_method="local_development")
