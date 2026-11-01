#!/usr/bin/env bash
# Render build for the FastAPI backend. Run from the repository root.
#
# 1. Install pinned dependencies.
# 2. Fetch and checksum-verify the model binaries (git-ignored; published as release assets).
# 3. Regenerate the synthetic V2 account ledger from its fixed seed (the 190 MB SQLite file is not in git).
# 4. Build the forensic scenario ledger (seed 303, ~45 MB, ~10 s). The v3 models are committed text artifacts
#    (ml/artifacts/v3/*/model.json); nothing is trained here.
# 5. Verify: the FS-2001 sample case still matches the ledger, the models load, and the app starts.
# Any failure stops the build; nothing is skipped silently.
set -euo pipefail

echo "== Python: $(python --version)"
pip install --no-cache-dir -r backend/requirements.txt

echo "== Model artifacts"
python scripts/fetch_model_artifacts.py

echo "== Synthetic V2 ledger (seed 42)"
python scripts/generate_synthetic_bank_data.py --seed 42 --output-dir data/v2_synthetic
python scripts/ingest_v2_data.py --input-dir data/v2_synthetic --db-url "sqlite:///data/v2_fraudshield.db" --batch-size 10000 --replace
rm -rf data/v2_synthetic  # CSVs are only an intermediate step

echo "== Forensic scenario ledger (seed 303)"
python scripts/build_forensic_ledger.py --ledger demo --db data/v3_forensic_scenarios.db --csv-dir data/v3_forensic/demo
rm -rf data/v3_forensic  # CSVs and the evaluation roles table are not needed by the server

echo "== Verification"
# Tests use temporary databases; they write, so run them outside the production write lock.
# The AI analyst is forced off here: the build must never call Gemini or spend quota (the tests mock it anyway).
GEMINI_ANALYST_ENABLED=false ENVIRONMENT=development python -m pytest -q backend/tests/test_product_integrity.py backend/tests/test_v2_investigation.py backend/tests/test_v2_ai_analyst.py backend/tests/test_v3_dynamic_intelligence.py ml/tests/test_account_model_audit.py
(cd backend && GEMINI_ANALYST_ENABLED=false ENVIRONMENT=production python - <<'PY'
from fastapi.testclient import TestClient
from app.main import create_app

c = TestClient(create_app())
h = c.get("/health").json()
s = c.get("/api/v2/models/status").json()
assert h["write_access"] == "disabled_no_key_configured" or h["write_access"] == "api_key_required", h
assert s["inference_ready"] is True, s.get("status_detail")
assert s["account_model"]["version"] == "v2-account-2.0.0", s["account_model"]["version"]
assert c.get("/api/cases/FS-2001").status_code == 200
assert c.get("/api/v2/accounts/ACC-000003/ml-assessment").json()["risk_score"] == 71.3
inv = c.post("/api/v2/investigations", json={"account_id": "ACC-000001"})
assert inv.status_code == 200, inv.text
assert inv.json()["data_source"]["is_synthetic"] is True and inv.json()["model_available"] is True
assert inv.json()["ai_analysis"]["state"] == "disabled", "build-time check must not call Gemini"
ds = {d["dataset_id"]: d for d in c.get("/api/v2/datasets").json()}
assert ds["forensic-scenarios"]["available"] is True, ds["forensic-scenarios"]
dyn = c.post("/api/v2/dynamic-investigations", json={"account_id": "ACC-000001"})
assert dyn.status_code == 200, dyn.text
assert dyn.json()["victim_assessment"]["status"] == "potential_victim" and dyn.json()["automatic_actions_taken"] == []
assert dyn.json()["model_metadata"]["transaction_model"]["available"] is True
assert dyn.json()["investigation"]["ai_analysis"]["state"] == "disabled", "build-time check must not call Gemini"
import google.genai  # the AI analyst's SDK is installed
print("startup check passed:", h["write_access"], s["account_model"]["version"])
PY
)
