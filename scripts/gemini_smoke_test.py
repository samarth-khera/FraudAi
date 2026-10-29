#!/usr/bin/env python3
"""Opt-in smoke test: ONE real Gemini call through the real investigation flow. Never run by tests, builds or deploys.

It spends one request of your Gemini quota. It refuses to run unless GEMINI_SMOKE_TEST=1 is set, and it uses the
same privacy policy as the server (synthetic demo ledger only by default). The key is read from the environment and
never printed.

Usage (repository root, with the synthetic ledger built and GEMINI_API_KEY already in your environment):
    GEMINI_SMOKE_TEST=1 GEMINI_ANALYST_ENABLED=true backend/.venv/bin/python scripts/gemini_smoke_test.py [ACCOUNT_ID]

Exit code 0 only if the AI analysis state is "completed".
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))


def main() -> int:
    if os.environ.get("GEMINI_SMOKE_TEST") != "1":
        print("Refusing to run: set GEMINI_SMOKE_TEST=1 to make one real (quota-consuming) Gemini request.")
        return 2
    if not os.environ.get("GEMINI_API_KEY", "").strip():
        print("GEMINI_API_KEY is not set in this environment.")
        return 2
    os.environ.setdefault("GEMINI_ANALYST_ENABLED", "true")

    from app.api.v2.investigation_schemas import InvestigationRequest
    from app.db.v2.session import get_v2_sessionmaker
    from app.services.v2.investigation import InvestigationService

    account = sys.argv[1] if len(sys.argv) > 1 else "ACC-000001"
    with get_v2_sessionmaker()() as db:
        result = InvestigationService.run(db, InvestigationRequest(account_id=account))
    ai = result.ai_analysis
    print(f"data source:   {result.data_source.source_kind} (synthetic={result.data_source.is_synthetic})")
    print(f"ai state:      {ai.state}  (legacy status {ai.status})")
    print(f"model:         {ai.model}")
    print(f"reason:        {ai.unavailable_reason}")
    print(f"latency_ms:    {ai.latency_ms}")
    print(f"message:       {ai.message}")
    if ai.report:
        print(f"observations:  {len(ai.report.key_observations)}  references: {len(ai.report.evidence_references)}  dropped: {ai.rejected_claims}")
        if result.data_source.is_synthetic:  # only print model text for synthetic data
            print(f"summary:       {ai.report.summary}")
    return 0 if ai.state == "completed" else 1


if __name__ == "__main__":
    sys.exit(main())
