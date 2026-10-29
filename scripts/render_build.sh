#!/usr/bin/env bash
# Render build for the FastAPI backend. Run from the repository root.
#
# 1. Install pinned dependencies.
# 2. Fetch and checksum-verify the model binaries (git-ignored; published as release assets).
# 3. Regenerate the synthetic V2 account ledger from its fixed seed (the 190 MB SQLite file is not in git).
# 4. Verify: the FS-2001 sample case still matches the ledger, the account model loads, and the app starts.
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

echo "== Verification"
# Tests use temporary databases; they write, so run them outside the production write lock.
ENVIRONMENT=development python -m pytest -q backend/tests/test_product_integrity.py ml/tests/test_account_model_audit.py
(cd backend && ENVIRONMENT=production python - <<'PY'
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
print("startup check passed:", h["write_access"], s["account_model"]["version"])
PY
)
