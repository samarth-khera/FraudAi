"""Tests for global audit trail and CSV export endpoints."""

from __future__ import annotations


def test_get_global_audit_events_default(client):
    res = client.get("/api/audit")
    assert res.status_code == 200
    data = res.json()
    assert "total_count" in data
    assert "filtered_count" in data
    assert "events" in data
    assert "summary" in data
    assert "integrity_status" in data

    assert data["total_count"] >= 1
    assert data["integrity_status"]["storage_backend"] == "SQLite Relational (audit_events)"
    assert data["integrity_status"]["append_only_enforced"] is True
    assert data["integrity_status"]["cryptographic_signatures"] is False
    assert data["integrity_status"]["server_timestamps"] is True


def test_get_global_audit_filter_by_case(client):
    res = client.get("/api/audit?case_id=FS-1042")
    assert res.status_code == 200
    data = res.json()
    for e in data["events"]:
        assert e["case_id"] == "FS-1042"


def test_get_global_audit_filter_by_category(client):
    res_reviews = client.get("/api/audit?category=reviews")
    assert res_reviews.status_code == 200
    data = res_reviews.json()
    for e in data["events"]:
        assert "review" in e["action"].lower()

    res_traces = client.get("/api/audit?category=traces")
    assert res_traces.status_code == 200
    for e in res_traces.json()["events"]:
        assert "trace" in e["action"].lower()


def test_get_global_audit_pagination(client):
    res = client.get("/api/audit?skip=0&limit=2")
    assert res.status_code == 200
    data = res.json()
    assert data["limit"] == 2
    assert len(data["events"]) <= 2


def test_get_global_audit_search(client):
    res = client.get("/api/audit?search=FS-1042")
    assert res.status_code == 200
    data = res.json()
    assert data["total_count"] >= 1


def test_export_audit_events_csv(client):
    res = client.get("/api/audit/export.csv")
    assert res.status_code == 200
    assert "text/csv" in res.headers.get("content-type", "")
    assert "attachment; filename=" in res.headers.get("content-disposition", "")
    text = res.text
    assert "Event ID,Timestamp (UTC),Case ID,Action,Performed By,Entity Type,Entity ID,Details JSON" in text
