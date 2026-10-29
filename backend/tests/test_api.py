"""API schema and error handling tests."""

from __future__ import annotations

from tests.conftest import tx


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "fraudshield-ai-backend",
                        "phase": "1-synthetic", "synthetic_data": True}


def test_list_cases(client):
    body = client.get("/api/cases").json()
    by_id = {c["case_id"]: c for c in body["cases"]}
    assert {"FS-1042", "FS-2001"} <= set(by_id)
    c = by_id["FS-1042"]
    assert c["reported_amount"] == 50000
    assert set(c) == {"case_id", "reported_origin_transaction_id", "reported_amount", "currency",
                      "reported_at", "investigation_status", "description", "updated_at",
                      "account_dataset", "dataset_note", "review_progress"}
    # FS-1042 accounts (V001, A100, ...) exist only in the case records.
    assert c["account_dataset"] == "case_ledger"
    assert by_id["FS-2001"]["account_dataset"] == "v2_synthetic_ledger"


def test_get_case(client):
    r = client.get("/api/cases/FS-1042")
    assert r.status_code == 200
    assert r.json()["reported_origin_transaction_id"] == "T001"


def test_case_not_found_error_schema(client):
    for path in ["", "/transactions", "/graph", "/trace"]:
        r = client.get(f"/api/cases/NOPE{path}")
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "case_not_found"


def test_transactions(client):
    body = client.get("/api/cases/FS-1042/transactions").json()
    assert body["count"] == 7
    ids = [t["transaction_id"] for t in body["transactions"]]
    assert ids == [f"T00{i}" for i in range(1, 8)]
    t = body["transactions"][0]
    assert {"timestamp", "sender_account_id", "receiver_account_id", "amount", "currency",
            "transaction_type", "attributed_amount", "attribution_basis"} <= set(t)


def test_graph_schema(client):
    body = client.get("/api/cases/FS-1042/graph").json()
    assert [n["id"] for n in body["nodes"]] == ["V001", "A100", "B200", "C300", "D400", "E500", "F600", "G700"] \
        or {n["id"] for n in body["nodes"]} == {"V001", "A100", "B200", "C300", "D400", "E500", "F600", "G700"}
    assert len(body["edges"]) == 7
    e = {x["id"]: x for x in body["edges"]}
    assert (e["T003"]["source"], e["T003"]["target"], e["T003"]["amount"]) == ("B200", "C300", 30000)
    node = next(n for n in body["nodes"] if n["id"] == "C300")
    assert node["review_state"] == "under_review" and node["hop_count"] == 2
    assert body["meta"]["edge_count"] == 7 and "disclaimer" in body


def test_trace_schema(client):
    body = client.get("/api/cases/FS-1042/trace").json()
    assert set(body) >= {"case_id", "summary", "linked_accounts", "traced_transactions", "paths",
                         "warnings", "disclaimer"}
    s = body["summary"]
    assert s["traceable_amount"] == 50000 and s["gross_observed_transaction_value"] == 175000
    assert len(body["linked_accounts"]) == 7 and len(body["paths"]) == 3
    acct = body["linked_accounts"][0]
    assert set(acct) >= {"exposure", "review", "connection_type", "hop_count", "path_ids"}
    assert acct["review"]["automated_action_taken"] == "none"


def test_trace_depth_param(client):
    body = client.get("/api/cases/FS-1042/trace?max_depth=1").json()
    assert body["summary"]["truncated"] is True
    assert len(body["linked_accounts"]) == 2


def test_invalid_depth_validation_error(client):
    r = client.get("/api/cases/FS-1042/trace?max_depth=-1")
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    assert client.get("/api/cases/FS-1042/trace?max_depth=abc").status_code == 422


def test_unknown_route_error_shape(client):
    r = client.get("/api/nothing")
    assert r.status_code == 404 and "error" in r.json()


def test_missing_origin_returns_409(custom_client):
    c = custom_client([tx("T999", 0, "V", "A", 100)])
    r = c.get("/api/cases/FS-TEST/trace")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "origin_transaction_unavailable"
    assert c.get("/api/cases/FS-TEST/graph").status_code == 409


def test_api_with_cycle(custom_client):
    c = custom_client([tx("T001", 0, "V", "A", 100, 100), tx("T002", 1, "A", "B", 100, 100),
                       tx("T003", 2, "B", "A", 100, 100)])
    body = c.get("/api/cases/FS-TEST/graph").json()
    assert body["meta"]["cycles_detected"] is True
    assert any(e["is_cycle_closing"] for e in body["edges"])
