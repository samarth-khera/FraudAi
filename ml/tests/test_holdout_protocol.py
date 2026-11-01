"""The hold-out protocol must never recompute on the same ledger once code has changed (no tuning against it)."""
from __future__ import annotations

import json

from ml.forensics import holdout_evaluation as H


def test_same_manifest_returns_stored_result_without_recomputing(tmp_path, monkeypatch, capsys):
    rep = tmp_path / "holdout.json"
    rep.write_text(json.dumps({"manifest": H.manifest(), "summary": {"stored": True}}))
    monkeypatch.setattr(H, "REPORT", rep)
    monkeypatch.setattr("sys.argv", ["holdout_evaluation"])
    assert H.main() == 0
    assert "not recomputed" in capsys.readouterr().out


def test_changed_code_is_refused_on_a_used_holdout(tmp_path, monkeypatch, capsys):
    m = H.manifest()
    some = next(iter(m["files"]))
    m["files"][some] = "0" * 64
    m["sha256"] = "changed"
    rep = tmp_path / "holdout.json"
    rep.write_text(json.dumps({"manifest": m, "summary": {}}))
    monkeypatch.setattr(H, "REPORT", rep)
    monkeypatch.setattr("sys.argv", ["holdout_evaluation"])
    assert H.main() == 2
    out = capsys.readouterr().out
    assert "REFUSED" in out and some in out


def test_manifest_covers_the_decision_code_and_served_models():
    files = H.manifest()["files"]
    for must in ("backend/app/intelligence/roles.py", "backend/app/intelligence/engine.py",
                 "backend/app/services/v2/graph_tracer.py", "ml/artifacts/v3/account_model/model.json",
                 "ml/artifacts/v3/transaction_model/model.json"):
        assert must in files
