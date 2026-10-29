"""Google Gemini provider for the AI analyst (official `google-genai` SDK).

The only module that talks to Gemini. It returns raw text plus the finish state, or raises ProviderError with a
fixed reason code and a few sanitised diagnostic fields for the server log. Raw response bodies and the prompt are
never logged or passed on, because they can echo request content.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

import httpx
from google import genai
from google.genai import errors, types

logger = logging.getLogger("fraudshield.v2.gemini")


class ProviderError(Exception):
    """`reason` is one of the fixed codes documented on AIAnalysis.unavailable_reason.

    `diagnostics` holds sanitised fields for the server log only (see diagnostics_of); it never reaches a client.
    """

    def __init__(self, reason: str, http_code: Optional[int] = None, diagnostics: Optional[dict] = None):
        super().__init__(reason)
        self.reason = reason
        self.http_code = http_code
        self.diagnostics = diagnostics or {}


@dataclass(frozen=True)
class ProviderOutput:
    text: Optional[str]
    finish_reason: Optional[str]
    blocked: bool


# Google's ErrorInfo reasons for a bad or unusable key. An invalid key comes back as HTTP 400, not 401.
_AUTH_REASONS = {"API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED",
                 "API_KEY_IP_ADDRESS_BLOCKED", "ACCESS_TOKEN_EXPIRED", "SERVICE_DISABLED", "CONSUMER_SUSPENDED"}
_REQUEST_ID_HEADERS = ("x-request-id", "x-goog-request-id", "request-id")


def _reason_for_api_error(exc: errors.APIError) -> str:
    code = getattr(exc, "code", None)
    google_status = getattr(exc, "status", None)
    # 504 / DEADLINE_EXCEEDED: Gemini stopped at its deadline. The SDK sends the configured timeout as the
    # X-Server-Timeout header, so a slow answer usually ends here rather than as a client-side timeout.
    if code == 504 or google_status == "DEADLINE_EXCEEDED":
        return "timeout"
    if (code in (401, 403) or google_status in ("UNAUTHENTICATED", "PERMISSION_DENIED")
            or _error_info(exc).get("reason") in _AUTH_REASONS):
        return "auth_failed"
    if code == 429 or google_status == "RESOURCE_EXHAUSTED":
        return "rate_limited"
    if code == 404:
        return "model_not_found"
    # 503 / UNAVAILABLE: Google documents it as "temporarily overloaded or down". Nothing about the request.
    if code == 503 or google_status == "UNAVAILABLE":
        return "service_unavailable"
    if isinstance(exc, errors.ServerError) or (isinstance(code, int) and code >= 500):
        return "upstream_error"
    return "request_rejected"


def _detail_list(exc: errors.APIError) -> list:
    body = getattr(exc, "details", None)
    if isinstance(body, dict):
        body = body.get("error", body)
        details = body.get("details") if isinstance(body, dict) else None
        if isinstance(details, list):
            return [d for d in details if isinstance(d, dict)]
    return []


def _error_info(exc: errors.APIError) -> dict:
    for d in _detail_list(exc):
        if str(d.get("@type", "")).endswith("google.rpc.ErrorInfo"):
            return d
    return {}


def _token(value, limit: int = 80) -> Optional[str]:
    """A short identifier-like value (status, reason, quota id, delay), with every other character removed."""
    if not isinstance(value, (str, int)):
        return None
    cleaned = re.sub(r"[^A-Za-z0-9_.:/-]", "", str(value))[:limit]
    return cleaned or None


def safe_message(message, limit: int = 160) -> Optional[str]:
    """Google's error message, reduced to something safe for one log line.

    Quoted values are removed because a validation message can quote request content; the configured key, key-like
    and other long opaque strings, and account/transfer IDs are masked; the result is one line, printable, and at
    most `limit` characters.
    """
    if not isinstance(message, str):
        return None
    text = " ".join(message.split())
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if len(key) >= 8:
        text = text.replace(key, "[key]")
    text = re.sub(r"AIza[0-9A-Za-z_-]{10,}", "[key]", text)
    text = re.sub(r"[A-Za-z0-9_-]{24,}", "[token]", text)  # any long opaque token, whatever its format
    text = re.sub(r'"[^"]*"', '"…"', text)
    text = re.sub(r"\b(?:ACC|TXN?|PA|PT)-[A-Za-z0-9]+\b", "[id]", text)
    text = "".join(ch for ch in text if ch.isprintable())[:limit]
    return text or None


def diagnostics_of(exc: errors.APIError) -> dict:
    """Sanitised fields from a Google error for the server log. Missing or malformed bodies give fewer fields."""
    diag = {
        "provider_status": _token(getattr(exc, "status", None)),
        "provider_reason": _token(_error_info(exc).get("reason")),
        "provider_message": safe_message(getattr(exc, "message", None)),
    }
    for d in _detail_list(exc):
        kind = str(d.get("@type", ""))
        if kind.endswith("google.rpc.RetryInfo"):
            diag["retry_after"] = _token(d.get("retryDelay"))
        elif kind.endswith("google.rpc.QuotaFailure"):
            violations = d.get("violations")
            if isinstance(violations, list) and violations and isinstance(violations[0], dict):
                diag["quota_id"] = _token(violations[0].get("quotaId"))
    headers = getattr(getattr(exc, "response", None), "headers", None)
    if headers is not None:
        try:
            for name in _REQUEST_ID_HEADERS:
                if headers.get(name):
                    diag["request_id"] = _token(headers.get(name))
                    break
            if not diag.get("retry_after") and headers.get("retry-after"):
                diag["retry_after"] = _token(headers.get("retry-after"))
        except Exception:  # noqa: BLE001 - headers are optional; diagnostics must never raise
            pass
    return {k: v for k, v in diag.items() if v}


def http_status_of(exc: errors.APIError) -> Optional[int]:
    code = getattr(exc, "code", None)
    return code if isinstance(code, int) else None


class GeminiProvider:
    name = "gemini"
    HARD_TIMEOUT_MARGIN = 2.0  # seconds beyond the HTTP timeout before the whole call is abandoned

    def __init__(self, model: str, timeout_seconds: float, thinking_level: Optional[str] = None):
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            raise ProviderError("not_configured")
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.thinking_level = thinking_level
        # One attempt only: automatic retries could drain the quota. Timeout is in milliseconds.
        self._client = genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(
                timeout=int(timeout_seconds * 1000),
                retry_options=types.HttpRetryOptions(attempts=1),
            ),
        )

    async def generate(
        self, *, system_instruction: str, contents: str, response_json_schema: dict, max_output_tokens: int
    ) -> ProviderOutput:
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            response_mime_type="application/json",
            response_json_schema=response_json_schema,
            max_output_tokens=max_output_tokens,
            # No temperature/top_p/top_k: Gemini 3.6+ models ignore them and Google advises omitting them.
            candidate_count=1,
            thinking_config=types.ThinkingConfig(thinking_level=self.thinking_level) if self.thinking_level else None,
        )
        try:
            # The SDK enforces the HTTP timeout; wait_for is a hard upper bound on the whole call.
            response = await asyncio.wait_for(
                self._client.aio.models.generate_content(model=self.model, contents=contents, config=config),
                timeout=self.timeout_seconds + self.HARD_TIMEOUT_MARGIN,
            )
        except (asyncio.TimeoutError, httpx.TimeoutException):
            raise ProviderError("timeout")
        except errors.APIError as exc:
            raise ProviderError(_reason_for_api_error(exc), http_status_of(exc), diagnostics_of(exc))
        except (httpx.HTTPError, OSError):
            raise ProviderError("upstream_error")

        feedback = getattr(response, "prompt_feedback", None)
        if feedback is not None and getattr(feedback, "block_reason", None):
            return ProviderOutput(text=None, finish_reason="BLOCKED", blocked=True)
        candidates = response.candidates or []
        finish = candidates[0].finish_reason if candidates else None
        finish_name = getattr(finish, "value", finish)
        try:
            text = response.text
        except Exception:  # noqa: BLE001 - a malformed candidate is treated as empty output
            text = None
        blocked = finish_name in ("SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION")
        return ProviderOutput(text=text, finish_reason=finish_name, blocked=blocked)
