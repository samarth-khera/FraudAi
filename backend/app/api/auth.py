"""API security and authentication dependencies.

Provides access control for state-changing write operations and distinguishes
verified identity from client-asserted local-development identity.
"""

from __future__ import annotations

import os
import secrets
from typing import Optional

from fastapi import Header, HTTPException, status
from pydantic import BaseModel


class AuthContext(BaseModel):
    """Context describing the authorization status of the incoming request."""

    is_authenticated: bool
    actor_id: str
    auth_method: str  # "api_key" | "local_development"
    verified: bool


def verify_write_permission(
    authorization: Optional[str] = Header(None, alias="Authorization"),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> AuthContext:
    """Verifies write permissions for state-changing endpoints.

    If ADMIN_API_KEY or FRAUDSHIELD_API_KEY is configured in the environment,
    a valid matching key must be supplied via 'X-API-Key' or 'Authorization: Bearer <key>'.

    If no API key is configured (local development default), requests are permitted
    under a local development context, with explicit audit disclosure that reviewer
    identity is client-asserted and unverified.
    """
    configured_key = os.getenv("ADMIN_API_KEY") or os.getenv("FRAUDSHIELD_API_KEY")

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
        return AuthContext(
            is_authenticated=True,
            actor_id="api_key_admin",
            auth_method="api_key",
            verified=True,
        )

    # Local development safeguard: permitted, but flagged as unverified client identity
    return AuthContext(
        is_authenticated=False,
        actor_id="local_dev_user",
        auth_method="local_development",
        verified=False,
    )
