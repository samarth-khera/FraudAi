"""QA remediation (2026-11-02): QA-04 (case GETs are compute-only; trace paths are stored only by the authorised review
write) and QA-14 (a non-ASCII API key header is a 401, never a 500)."""

from __future__ import annotations

import hashlib
from datetime import timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, text

from app.db.models import AuditEventModel, Base, TransactionModel
from tests.test_case_management import db_client, test_db  # noqa: F401 - pytest fixtures

CASE = "FS-1042"


def snapshot(engine) -> dict[str, str]:
    """Digest of every row of every table, so any write (insert, update or delete) shows up."""
    out = {}
    with engine.connect() as conn:
        for table in Base.metadata.sorted_tables:
            rows = conn.execute(text(f'SELECT * FROM "{table.name}"')).fetchall()
            out[table.name] = hashlib.sha256(repr(sorted(map(repr, rows))).encode()).hexdigest()
    return out


def test_case_views_never_write(db_client, test_db):  # noqa: F811
    _, engine = test_db
    before = snapshot(engine)
    # Alternating depths used to force a DELETE + INSERT and a new audit row on every request.
    for depth in (3, 10, 3, 50, 0):
        for part in ("trace", "graph", "transactions", "accounts"):
            r = db_client.get(f"/api/cases/{CASE}/{part}?max_depth={depth}")
            assert r.status_code == 200, (part, depth, r.text)
    assert db_client.get(f"/api/cases/{CASE}").status_code == 200
    assert snapshot(engine) == before, "a GET changed the database"
    actions = [e["action"] for e in db_client.get(f"/api/cases/{CASE}/audit-trail").json()["events"]]
    assert "trace_paths_persisted" not in actions


def _trace_only_account(db_client, test_db) -> str:  # noqa: F811
    """Adds a transfer from the end of the case's trace to a new account that has no link to the case except that
    transfer, and returns the new account's ID."""
    Session, _ = test_db
    trace = db_client.get(f"/api/cases/{CASE}/trace?max_depth=50").json()
    in_trace = {a for p in trace["paths"] for a in p["account_ids"]}
    path = max(trace["paths"], key=lambda p: p["hop_count"])
    last_tx = path["transaction_ids"][-1]
    with Session() as s:
        t = s.scalar(select(TransactionModel).where(TransactionModel.transaction_id == last_tx))
        new = "QA04-TRACE-ONLY"
        from app.db.models import AccountModel
        s.add(AccountModel(account_id=new, label="Trace-only account", role="unknown", is_synthetic=True))
        s.add(TransactionModel(
            transaction_id="QA04-TX-1", timestamp=t.timestamp + timedelta(minutes=20), sender_account_id=t.receiver_account_id,
            receiver_account_id=new, amount=Decimal(str(round(float(t.amount) * 0.5, 2))), currency=t.currency,
            transaction_type=t.transaction_type,
        ))
        s.commit()
    after = db_client.get(f"/api/cases/{CASE}/trace?max_depth=50").json()
    assert new not in in_trace and new in {a for p in after["paths"] for a in p["account_ids"]}, "precondition: traced"
    return new


def test_review_of_a_trace_only_account_works_without_a_prior_page_view(db_client, test_db):  # noqa: F811
    Session, engine = test_db
    account = _trace_only_account(db_client, test_db)
    before = snapshot(engine)
    r = db_client.put(f"/api/cases/{CASE}/accounts/{account}/review",
                      json={"review_state": "under_review", "reviewer_id": "qa-tester"})
    assert r.status_code == 200, r.text
    assert snapshot(engine) != before
    with Session() as s:
        actions = [a for (a,) in s.execute(select(AuditEventModel.action).where(AuditEventModel.case_id == CASE))]
    assert "trace_paths_persisted" in actions and "account_review_recorded" in actions


def test_unrelated_account_is_still_out_of_scope(db_client):  # noqa: F811
    r = db_client.put(f"/api/cases/{CASE}/accounts/ACC-000001/review", json={"review_state": "under_review", "reviewer_id": "x"})
    assert r.status_code == 404 and r.json()["error"]["code"] in {"account_not_found", "account_not_in_case_scope"}


def test_production_without_a_key_refuses_review_writes_and_stores_nothing(db_client, test_db, monkeypatch):  # noqa: F811
    _, engine = test_db
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("ADMIN_API_KEY", raising=False)
    before = snapshot(engine)
    r = db_client.put(f"/api/cases/{CASE}/accounts/A100/review", json={"review_state": "under_review", "reviewer_id": "x"})
    assert r.status_code in (401, 403, 503)
    for part in ("trace", "graph", "transactions"):
        assert db_client.get(f"/api/cases/{CASE}/{part}").status_code == 200
    assert snapshot(engine) == before


# ---------------------------------------------------------------- QA-14
@pytest.mark.parametrize("header", [{"X-API-Key": "clé-ünïcödé"}, {"Authorization": "Bearer ключ"}, {"X-API-Key": "ÿ" * 40}])
def test_non_ascii_api_key_is_unauthorised_not_a_server_error(db_client, test_db, monkeypatch, header):  # noqa: F811
    _, engine = test_db
    monkeypatch.setenv("ADMIN_API_KEY", "correct-horse-battery-staple-0123456789")
    before = snapshot(engine)
    # httpx encodes header values as latin-1 or UTF-8 bytes; Starlette decodes them as latin-1 either way.
    raw = {k: v.encode("utf-8") for k, v in header.items()}
    r = db_client.put(f"/api/cases/{CASE}/accounts/A100/review", json={"review_state": "under_review", "reviewer_id": "x"}, headers=raw)
    assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
    assert snapshot(engine) == before
