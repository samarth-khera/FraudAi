"""Google Gemini provider for the AI analyst (official `google-genai` SDK).

The only module that talks to Gemini. It returns raw text plus the finish state, or raises ProviderError with a
fixed reason code. Error messages, response bodies and the prompt are never logged or passed on, because they can
echo request content.
"""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from typing import Optional

import httpx
from google import genai
from google.genai import errors, types

logger = logging.getLogger("fraudshield.v2.gemini")


class ProviderError(Exception):
    """`reason` is one of the fixed codes documented on AIAnalysis.unavailable_reason."""

    def __init__(self, reason: str, http_code: Optional[int] = None):
        super().__init__(reason)
        self.reason = reason
        self.http_code = http_code


@dataclass(frozen=True)
class ProviderOutput:
    text: Optional[str]
    finish_reason: Optional[str]
    blocked: bool


def _reason_for_api_error(exc: errors.APIError) -> str:
    code = getattr(exc, "code", None)
    if code in (401, 403):
        return "auth_failed"
    if code == 429:
        return "rate_limited"
    if code == 404:
        return "model_not_found"
    if isinstance(exc, errors.ServerError) or (isinstance(code, int) and code >= 500):
        return "upstream_error"
    return "request_rejected"


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
            temperature=0.2,
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
            raise ProviderError(_reason_for_api_error(exc), getattr(exc, "code", None))
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
